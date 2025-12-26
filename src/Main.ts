import * as Utils from "./Utils.ts";
import {catchError, formatNumber, AsyncCallGate} from "./Utils.ts";
import InternalAudioPlayer from "./InternalAudioPlayer.js";
import * as SpecAverage from "./SpecAverage.ts";
import * as DomUtils from "./DomUtils.ts";
import * as AudioUtils from "./AudioUtils.ts";
import * as WavFileEncoder from "wav-file-encoder";
import * as DialogManager from "dialog-manager";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as FunctionCurveEditor from "function-curve-editor";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions";
import * as Fft from "dsp-collection/signal/Fft";
// import * as Resampling from "dsp-collection/signal/Resampling";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as FirFilterWin from "dsp-collection/filter/FirFilterWin";
import * as SpecFilt from "dsp-collection/filter/SpecFilt";
import {FilterCurveFunction} from "dsp-collection/filter/SpecFilt";
import ComplexArray from "dsp-collection/math/ComplexArray";

var audioPlayer:                       InternalAudioPlayer;
var spectrumCurveStepWidth:            number = 50;                  // step width in Hz for spectrum curve frequency coordinate points that will be copied to clipboard
var amplitudeCurveStepWidthMs:         number = 20;                  // step width in ms for amplitude curve

// GUI components:
var inputSignalViewerWidget:           FunctionCurveViewer.Widget;
var inputSpectrumViewerWidget:         FunctionCurveViewer.Widget;
var filterViewerWidget:                FunctionCurveViewer.Widget;
var filterEditorWidget:                FunctionCurveEditor.Widget;
var outputSpectrumViewerWidget:        FunctionCurveViewer.Widget;
var outputSignalViewerWidget:          FunctionCurveViewer.Widget;

// Input signal:
var inputSignalValid:                  boolean = false;
var inputSignal:                       Float32Array;                 // input signal samples
var inputSignalStart:                  number;                       // sample position of start of selected segment
var inputSignalEnd:                    number;                       // sample position of end of selected segment
var inputSampleRate:                   number;
var inputFileName:                     string;
var inputFileF0:                       number;                       // fundamental frequency associated with input file or 0

// Input spectrum:
var inputSpectrumValid:                boolean = false;
var inputSpectrumAmplitudes:           Float64Array;                 // linear Amplitudes
var inputSpectrumPhases:               Float64Array;
var inputSpectrumScalingFactor:        number;

// Filter:
var filterEditorWidgetKnotsAmplScale:  string|undefined = undefined;
var filterEditorWidgetLoaded:          boolean = false;

// Output spectrum:
var outputSpectrumValid:               boolean = false;
var outputSpectrumAmplitudes:          Float64Array;                 // linear Amplitudes
var outputSpectrumPhases:              Float64Array;
var outputSpectrumScalingFactor:       number;

// Output signal:
var outputSignalValid:                 boolean = false;
var outputSignal:                      Float64Array;
var outputSampleRate:                  number;
var outputFileName:                    string;

//--- Signal viewers -----------------------------------------------------------

function loadSignalViewer (widget: FunctionCurveViewer.Widget, signal: ArrayLike<number>, sampleRate: number) {
   const viewerFunction = FunctionCurveViewer.createViewerFunctionForArray(signal, {scalingFactor: sampleRate});
   const yRange = 1.2;
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:   viewerFunction,
      xMin:             0,
      xMax:             signal.length / sampleRate,
      yMin:             -yRange,
      yMax:             yRange,
      gridEnabled:      true,
      primaryZoomMode:  FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:        "s",
      focusShield:      true,
      copyEventHandler: signalViewer_clipboardCopyEventHandler };
   widget.setViewerState(viewerState); }

function inputSignalViewer_segmentChange() {
   const vState = inputSignalViewerWidget.getViewerState();
   if (vState.segmentSelected) {
      const x1 = Math.round(vState.segmentStart * inputSampleRate);
      const x2 = Math.round(vState.segmentEnd   * inputSampleRate);
      inputSignalStart = Math.max(0, Math.min(inputSignal.length, x1));
      inputSignalEnd   = Math.max(0, Math.min(inputSignal.length, x2)); }
    else {
      inputSignalStart = 0;
      inputSignalEnd = inputSignal.length; }
   setInputSignalInfo();
   refreshMainGui(); }

//--- Copy to clipboard --------------------------------------------------------

interface Point {x: number; y: number}

function formatCoordinateValue (v: number) {
   const v2 = Math.round(v * 1E6) / 1E6;
   let s = String(v2);
   if (s.length > 8) {
      s = v.toFixed(2); }
   return s; }

function encodeCoordinateList (points: Point[]) : string {
   let s: string = "";
   for (const point of points) {
      if (s.length > 0) {
         s += ", "; }
      s += "[" + formatCoordinateValue(point.x) + ", " + formatCoordinateValue(point.y) + "]"; }
   return s; }

function getAvgSpectrumPoints (spectrum: Float64Array, scalingFactor: number, stepWidth: number, maxFreq: number) : Point[] {
   const points: Point[] = [];
   for (let x = stepWidth; x < maxFreq; x += stepWidth) {
      const i = Math.round(x * scalingFactor);
      if (i <= 0 || i >= spectrum.length) {
         continue; }
      const y = spectrum[i];
      if (isFinite(y)) {
         points.push({x, y}); }}
   return points; }

function genSpectrumCurveDataString() : string {
   const maxFreq = DomUtils.getValueNum("maxDisplayFreq");
   const avgSpectrumLog = createSpectrumAverage_uip(inputSpectrumAmplitudes, inputSpectrumScalingFactor);
   if (!avgSpectrumLog) {
      throw new Error("No average spectrum."); }
   const points = getAvgSpectrumPoints(avgSpectrumLog, inputSpectrumScalingFactor, spectrumCurveStepWidth, maxFreq);
   return encodeCoordinateList(points); }

async function copySpectrumCurveButton_click() {
   if (!inputSpectrumValid) {
      return; }
   const newStepWidth = await DomUtils.promptNumber("Copy smoothed spectrum curve coordinates to clipboard", "Step width [Hz]", spectrumCurveStepWidth);
   if (!newStepWidth) {
      return; }
   spectrumCurveStepWidth = newStepWidth;
   const s = genSpectrumCurveDataString();
   await navigator.clipboard.writeText(s);
   DialogManager.showToast({msgText: "Spectrum curve copied to clipboard."}); }

function spectrumViewer_clipboardCopyEventHandler (event: ClipboardEvent) {
   if (!event.clipboardData) {
      return; }
   event.preventDefault();
   const s = genSpectrumCurveDataString();
   event.clipboardData.setData("text", s); }

function getAmplitudeCurvePoints (origSignal: Float32Array, sampleRate: number, stepWidth: number) : Point[] {
   const rmsSignal = origSignal.map(x => x * x);                               // signal energy
   const duration = rmsSignal.length / sampleRate;
   const stepToMinFactor = 3;                                                  // heuristic factor, we want minimal distortion from f0*2 but maximal resolution per step
   const firstMinFrequency = 1 / stepWidth * stepToMinFactor;
   const normFirstMinFreq = firstMinFrequency / sampleRate;
   const iirKernel = FirFilterWin.createFilterKernel({windowFunctionId: "blackman", normFirstMinFreq});
   const points: Point[] = [];
   for (let t = stepWidth / 2; t <= duration - stepWidth / 2; t += stepWidth) {
      const p = Math.round(t * sampleRate);
      const v = FirFilterWin.applyFirKernelAt(rmsSignal, p, iirKernel);
      const y = DspUtils.convertPowerToDb(v);
      if (isFinite(y)) {
         points.push({x: t, y}); }}
   return points; }

function genAmplitudeCurveDataString() {
   const inputSignalSel = inputSignal.subarray(inputSignalStart, inputSignalEnd);
   const points = getAmplitudeCurvePoints(inputSignalSel, inputSampleRate, amplitudeCurveStepWidthMs / 1000);
   return encodeCoordinateList(points); }

async function copyAmplitudeCurveButton_click() {
   if (!inputSignalValid) {
      return; }
   const newStepWidth = await DomUtils.promptNumber("Copy amplitude curve coordinates to clipboard", "Step width [ms]", amplitudeCurveStepWidthMs);
   if (!newStepWidth) {
      return; }
   amplitudeCurveStepWidthMs = newStepWidth;
   const s = genAmplitudeCurveDataString();
   await navigator.clipboard.writeText(s);
   DialogManager.showToast({msgText: "Amplitude curve copied to clipboard."}); }

function signalViewer_clipboardCopyEventHandler (event: ClipboardEvent) {
   if (!event.clipboardData) {
      return; }
   event.preventDefault();
   const s = genAmplitudeCurveDataString();
   event.clipboardData.setData("text", s); }

//--- Spectrum viewer ----------------------------------------------------------

// Load spectrum amplitude viewer.
function loadSpectrumViewer (widget: FunctionCurveViewer.Widget, spectrum: Float64Array, scalingFactor: number) {
   const amplitudeScale = DomUtils.getValue("amplitudeScale");
   let spectrum2: Float64Array;
   let yMin: number = 0;
   let yMax: number;
   let yAxisUnit: string|undefined = undefined;
   switch (amplitudeScale) {
      case "log": {
         spectrum2 = spectrum.map(DspUtils.convertAmplitudeToDb);
         yMin = -100;
         yMax = -0;
         yAxisUnit = "dB";
         break; }
      case "lin": {
         spectrum2 = spectrum;
         yMax = 0.1;
         break; }
      case "pwr": {
         spectrum2 = spectrum.map(x => x * x);
         yMax = 0.01;
         break; }
      default: throw new Error("Invalid amplitudeScale."); }
   const spectrumFunction = FunctionCurveViewer.createViewerFunctionForArray(spectrum2, {scalingFactor, nearestNeighbor: true});
   const averagingFunction = createSpectrumAveragingFunction(spectrum, amplitudeScale, scalingFactor);
   const viewerFunction = (x: number, sampleWidth: number, channel: number) => {
      switch (channel) {
         case 0:  return averagingFunction ? averagingFunction(x, sampleWidth, 0) : undefined;
         case 1:  return spectrumFunction(x, sampleWidth, 0);
         default: throw new Error(); }};
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:   viewerFunction,
      channels:         2,
      xMin:             0,
      xMax:             DomUtils.getValueNum("maxDisplayFreq"),
      yMin,
      yMax,
      gridEnabled:      true,
      primaryZoomMode:  FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:        "Hz",
      yAxisUnit,
      focusShield:      true,
      copyEventHandler: spectrumViewer_clipboardCopyEventHandler };
   widget.setViewerState(viewerState); }

function createSpectrumAverage_uip (spectrum: Float64Array, scalingFactor: number) {
   const averagingMode = DomUtils.getValue("averagingMode");
   const averagingWidth = Math.round(DomUtils.getValueNum("averagingWidth") * scalingFactor);
   const averagingWindowFunctionId = DomUtils.getValue("averagingWindowFunction");
   const averagingWidth2 = Math.round(DomUtils.getValueNum("averagingWidth2") * scalingFactor);
   const averagingWindowFunctionId2 = DomUtils.getValue("averagingWindowFunction2");
   return SpecAverage.createSpectrumAverage(spectrum, scalingFactor, averagingMode, averagingWidth, averagingWindowFunctionId, averagingWidth2, averagingWindowFunctionId2); }

function createSpectrumAveragingFunction (spectrum: Float64Array, amplitudeScale: string, scalingFactor: number) : FunctionCurveViewer.ViewerFunction | undefined {
   const avgSpectrumLog = createSpectrumAverage_uip(spectrum, scalingFactor);
   if (!avgSpectrumLog) {
      return undefined; }
   let out: Float64Array;
   switch (amplitudeScale) {
      case "log": {
         out = avgSpectrumLog;
         break; }
      case "lin": {
         out = avgSpectrumLog.map(DspUtils.convertDbToAmplitude);
         break; }
      case "pwr": {
         out = avgSpectrumLog.map(DspUtils.convertDbToPower);
         break; }
      default: throw new Error("Invalid amplitudeScale."); }
   return FunctionCurveViewer.createViewerFunctionForArray(out, {scalingFactor, nearestNeighbor: true, average: true}); }

//--- Load audio file ----------------------------------------------------------

async function loadAudioFileData (fileData: ArrayBuffer, fileName: string, f0: number = 0) {
   const audioData = await AudioUtils.decodeAudioFileData(fileData);
   inputSignal = audioData.channelData[0];                 // only the first channel is used
   inputSignalStart = 0;
   inputSignalEnd = inputSignal.length;
   inputSampleRate = audioData.sampleRate;
   inputFileName = fileName;
   inputFileF0 = f0;
   inputSignalValid = true;
   loadSignalViewer(inputSignalViewerWidget, inputSignal, inputSampleRate);
   setInputSignalInfo();
   inputSpectrumValid = false;
   outputSpectrumValid = false;
   outputSignalValid = false;
   refreshMainGui(); }

async function loadFileFromUrl (url: string) : Promise<ArrayBuffer> {
   const response = await fetch(url, {mode: "cors", credentials: "include"}); // (server must send "Access-Control-Allow-Origin" header field or have same origin)
   if (!response.ok) {
      throw new Error("Request failed for " + url); }
   return await response.arrayBuffer(); }

async function loadAudioFileFromUrl (url: string, f0: number) {
   const fileData = await loadFileFromUrl(url);
   const fileName = url.substring(url.lastIndexOf("/") + 1);
   await loadAudioFileData(fileData, fileName, f0); }

async function loadLocalAudioFile (file: File) {
   const fileData = await file.arrayBuffer();
   await loadAudioFileData(fileData, file.name); }

function loadLocalAudioFileButton_click() {
   audioPlayer.stop();
   Utils.openFileOpenDialog((file: File) => catchError(loadLocalAudioFile, file)); }

function getInputSignalSelection() {
   return inputSignal.subarray(inputSignalStart, inputSignalEnd); }

function isInputSignalWhole() {
   return inputSignalStart == 0 && inputSignalEnd == inputSignal.length; }

//--- FFT ----------------------------------------------------------------------

function loadInputSpectrumViewer() {
   loadSpectrumViewer(inputSpectrumViewerWidget, inputSpectrumAmplitudes, inputSpectrumScalingFactor); }

function fftButton_click() {
   let inputSignalLen = inputSignalEnd - inputSignalStart;
   if (inputSignalLen % 4 != 0 && inputSignalLen > 4096) {                     // 4 is used because the FFT may be applied a second time when smoothing the spectrum
      const reducedInputSignalLen = Math.floor(inputSignalLen / 4) * 4;
      console.log(`Note: The input signal length is reduced from ${inputSignalLen} to ${reducedInputSignalLen} to make it a multiple of 4 for allowing faster FFT processing.`);
      inputSignalLen = reducedInputSignalLen; }
   const inputSignalSel = inputSignal.subarray(inputSignalStart, inputSignalStart + inputSignalLen);
   const windowFunctionId = DomUtils.getValue("windowFunction");
   const windowedSignal = (windowFunctionId == "rect") ? inputSignalSel : WindowFunctions.applyWindowById(inputSignalSel, windowFunctionId);
   const spectrum = Fft.fftRealSpectrum(windowedSignal);
   inputSpectrumAmplitudes = spectrum.getAbsArray();
   inputSpectrumPhases = spectrum.getArgArray();
   inputSpectrumScalingFactor = inputSignalLen / inputSampleRate;
   inputSpectrumValid = true;
   loadInputSpectrumViewer();
   outputSpectrumValid = false;
   outputSignalValid = false;
   updateSpectralProcessing(); }

//--- Spectral processing ------------------------------------------------------

function genFilterCurveFunction() : FilterCurveFunction {
   const filterType = DomUtils.getValue("filterType");
   switch (filterType) {
      case "curve": {
         const amplitudeScale = DomUtils.getValue("amplitudeScale");
         const filterCurveFunction = filterEditorWidget.getFunction();
         switch (amplitudeScale) {
            case "log": {
               return (frequency: number) => DspUtils.convertDbToAmplitude(filterCurveFunction(frequency)); }
            case "lin": {
               return filterCurveFunction; }
            case "pwr": {
               return (frequency: number) => Math.sqrt(Math.max(0,filterCurveFunction(frequency))); }
            default: throw new Error("Invalid amplitudeScale."); }}
      default: {
         const filterFreq1 = DomUtils.getValueNum("filterFreq1");
         const filterFreq2 = DomUtils.getValueNum("filterFreq2");
         const smoothingWidth = DomUtils.getValueNum("filterSmoothingWidth");
         return SpecFilt.getFilterCurveFunction(<SpecFilt.FilterType>filterType, filterFreq1, filterFreq2, smoothingWidth); }}}

function loadFilterCurveViewer() {
   const amplitudeScale = DomUtils.getValue("amplitudeScale");
   const filterCurveFunction = genFilterCurveFunction();
   let viewerFunction: (x: number) => number;
   let yMin: number = 0;
   let yMax: number;
   let yAxisUnit: string|undefined = undefined;
   switch (amplitudeScale) {
      case "log": {
         viewerFunction = (frequency: number) => {
            const lin = filterCurveFunction(frequency);
            const log = DspUtils.convertAmplitudeToDb(lin);
            return Math.max(-95, log); };
         yMin = -100;
         yMax = 10;
         yAxisUnit = "dB";
         break; }
      case "lin": {
         viewerFunction = filterCurveFunction;
         yMax = 1.2;
         break; }
      case "pwr": {
         viewerFunction = (frequency: number) => filterCurveFunction(frequency) ** 2;
         yMax = 1.5;
         break; }
      default: throw new Error("Invalid amplitudeScale."); }
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:  viewerFunction,
      xMin:            0,
      xMax:            DomUtils.getValueNum("maxDisplayFreq"),
      yMin,
      yMax,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit,
      focusShield:     true };
   filterViewerWidget.setViewerState(viewerState); }

function updateFilterEditorWidget (reset: boolean) {
   const amplitudeScale = DomUtils.getValue("amplitudeScale");
   if (!reset && filterEditorWidgetLoaded && amplitudeScale == filterEditorWidgetKnotsAmplScale) {
      return; }
   const oldKnots = filterEditorWidget.getEditorState().knots;
   let knots: FunctionCurveEditor.Point[];
   if (oldKnots.length == 0 || !filterEditorWidgetKnotsAmplScale) {
      knots = [];
      for (let x = 0; x <= 4500; x += 500) {
         knots.push({x, y: amplitudeScale == "log" ? 0 : 1}); }}
    else {
       knots = convertKnotsAmplitudeScale(oldKnots, filterEditorWidgetKnotsAmplScale, amplitudeScale); }
   let yMin: number = 0;
   let yMax: number;
   let yAxisUnit: string|undefined = undefined;
   switch (amplitudeScale) {
      case "log": {
         yMin = -100;
         yMax = 30;
         yAxisUnit = "dB";
         break; }
      case "lin": {
         yMax = 10;
         break; }
      case "pwr": {
         yMax = 100;
         break; }
      default: throw new Error("Invalid amplitudeScale."); }
   const editorState : Partial<FunctionCurveEditor.EditorState> = {
      knots:           knots,
      xMin:            0,
      xMax:            DomUtils.getValueNum("maxDisplayFreq"),
      yMin,
      yMax,
      extendedDomain:  true,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit,
      focusShield:     true };
   filterEditorWidget.setEditorState(editorState);
   filterEditorWidgetKnotsAmplScale = amplitudeScale;
   filterEditorWidgetLoaded = true; }

function convertKnotsAmplitudeScale (oldKnots: FunctionCurveEditor.Point[], oldAmplitudeScale: string, newAmplitudeScale: string) : FunctionCurveEditor.Point[] {
   if (oldAmplitudeScale == newAmplitudeScale) {
      return oldKnots; }
   let oldKnotsLin: FunctionCurveEditor.Point[];
   switch (oldAmplitudeScale) {
      case "log": {
         oldKnotsLin = oldKnots.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: DspUtils.convertDbToAmplitude(p.y)}));
         break; }
      case "lin": {
         oldKnotsLin = oldKnots;
         break; }
      case "pwr": {
         oldKnotsLin = oldKnots.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: Math.sqrt(Math.max(0,p.y))}));
         break; }
      default: throw new Error("Invalid amplitudeScale."); }
   switch (newAmplitudeScale) {
      case "log": {
         return oldKnotsLin.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: Math.max(-100, DspUtils.convertAmplitudeToDb(Math.max(0, p.y)))})); }
      case "lin": {
         return oldKnotsLin; }
      case "pwr": {
         return oldKnotsLin.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: p.y ** 2})); }
      default: throw new Error("Invalid amplitudeScale."); }}

function refreshFilterGui() {
   const filterType = DomUtils.getValue("filterType");
   const isBand = filterType == "BP" || filterType == "BS";
   const isCurve = filterType == "curve";
   DomUtils.showElement("filterFreq1Field", !isCurve);
   DomUtils.showElement("filterFreq2Field", isBand);
   DomUtils.showElement("filterSmoothingWidthField", !isCurve);
   DomUtils.setText("filterFreq1Label", isBand ? "Frequency 1:" : "Frequency:");
   DomUtils.showElement("filterViewerFrame", !isCurve);
   const filterEditorWasAlreadyVisible = DomUtils.isElementVisible("filterEditorFrame");
   DomUtils.showElement("filterEditorFrame", isCurve);
   DomUtils.showElement("filterEditorButtons", isCurve);
   if (isCurve) {
      updateFilterEditorWidget(!filterEditorWasAlreadyVisible); }
    else {
      loadFilterCurveViewer(); }}

function genRandomArray (n: number, minValue: number, maxValue: number) : Float64Array {
   const a = new Float64Array(n);
   for (let i = 0; i < n; i++) {
      a[i] = minValue + Math.random() * (maxValue - minValue); }
   return a; }

function genAlternatingValuesArray (n: number, v1: number, v2: number) : Float64Array {
   const a = new Float64Array(n);
   for (let i = 0; i < n; i++) {
      a[i] = (i % 2 == 0) ? v1 : v2; }
   return a; }

function loadOutputSpectrumViewer() {
   loadSpectrumViewer(outputSpectrumViewerWidget, outputSpectrumAmplitudes, outputSpectrumScalingFactor); }

// This does not yet work!
function scaleSpectrum (inAmplitudes: Float64Array, inPhases: Float64Array, scalingFactor: number) {
   const n = Math.round(inAmplitudes.length * scalingFactor);
   const outAmplitudes = new Float64Array(n);
   const outPhases     = new Float64Array(n);
// Resampling.resampleNearestNeighbor(inAmplitudes, outAmplitudes, true);
// Resampling.resampleLinear(inAmplitudes, outAmplitudes, true);
// Resampling.resampleNearestNeighbor(inPhases, outPhases, true);
   for (let ip = 0; ip < inAmplitudes.length; ip++) {
      const op = Math.round(ip * scalingFactor);
      if (op < n) {
         outAmplitudes[op] = inAmplitudes[ip];
//       outPhases[op] = inPhases[ip];
         outPhases[op] = inPhases[ip] * Math.sqrt(scalingFactor);
         }}
   return [outAmplitudes, outPhases]; }

function performSpectralProcessing() {
   const specProc = DomUtils.getValue("specProc");
   switch (specProc) {
      case "filter": {
         const filterCurveFunction = genFilterCurveFunction();
         outputSpectrumAmplitudes    = SpecFilt.applyFilterCurveFunction(inputSpectrumAmplitudes, inputSpectrumScalingFactor, filterCurveFunction);
         outputSpectrumPhases        = inputSpectrumPhases;
         outputSpectrumScalingFactor = inputSpectrumScalingFactor;
         break; }
      case "scaleTime":                                    // does not work
      case "transpose": {                                  // does not work
         const specScalingFactor = DomUtils.getValueNum("specScalingFactor");
         [outputSpectrumAmplitudes, outputSpectrumPhases] = scaleSpectrum(inputSpectrumAmplitudes, inputSpectrumPhases, specScalingFactor);
         outputSpectrumScalingFactor = (specProc == "scaleTime") ? inputSpectrumScalingFactor * specScalingFactor : inputSpectrumScalingFactor;
         break; }
      case "phasesRand": {
         outputSpectrumAmplitudes    = inputSpectrumAmplitudes.slice();
         outputSpectrumPhases        = genRandomArray(inputSpectrumPhases.length, - Math.PI, Math.PI);
         outputSpectrumScalingFactor = inputSpectrumScalingFactor;
         break; }
      case "phasesNeg": {
         outputSpectrumAmplitudes    = inputSpectrumAmplitudes.slice();
         outputSpectrumPhases        = new Float64Array(inputSpectrumPhases.length);
         for (let i = 0; i < inputSpectrumPhases.length; i++) {
            outputSpectrumPhases[i] = -inputSpectrumPhases[i]; }
         outputSpectrumScalingFactor = inputSpectrumScalingFactor;
         break; }
      case "phasesAlt": {
         outputSpectrumAmplitudes    = inputSpectrumAmplitudes.slice();
         outputSpectrumPhases        = genAlternatingValuesArray(inputSpectrumPhases.length, Math.PI / 2, -Math.PI / 2);
         outputSpectrumScalingFactor = inputSpectrumScalingFactor;
         break; }
      default: {
         throw new Error("Unsupported specProc code."); }}
   outputSpectrumValid = true; }

function updateSpectralProcessing() {
   refreshFilterGui();
   if (inputSpectrumValid) {
      performSpectralProcessing();
      loadOutputSpectrumViewer();
      outputSignalValid = false; }
   refreshMainGui(); }

const updateSpectralProcessingCallGate = new AsyncCallGate();

function updateSpectralProcessingAsync() {
   updateSpectralProcessingCallGate.call(updateSpectralProcessing); }

//--- IFFT ---------------------------------------------------------------------

function ifftButton_click() {
   outputSampleRate = DomUtils.getValueNum("outputSampleRate");
   const outputStretchFactor = DomUtils.getValueNum("outputStretchFactor");
   let outputSignalLen = Math.round(outputSpectrumScalingFactor * outputSampleRate * outputStretchFactor);
   if (outputSignalLen % 2 == 1 && outputSignalLen > 4096) {
      console.log(`Note: The output signal length is reduced from ${outputSignalLen} to ${outputSignalLen - 1} to make it even and thus allowing faster FFT processing.`);
      outputSignalLen--; }
   const spectrum = ComplexArray.fromPolar(outputSpectrumAmplitudes, outputSpectrumPhases);
   outputSignal = Fft.iFftRealHalf(spectrum, outputSignalLen);
   outputFileName = Utils.removeFileNameExtension(inputFileName) + "-filtered.wav";
   outputSignalValid = true;
   loadSignalViewer(outputSignalViewerWidget, outputSignal, outputSampleRate);
   refreshMainGui(); }

async function ifftAndPlayButton_click() {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   ifftButton_click();
   await playOutputButton_click(); }

//------------------------------------------------------------------------------

function setInputSignalInfo() {
   const t = (p: number) => (p / inputSampleRate).toFixed(3) + " s";
   let s: string;
   if (!inputSignalValid) {
      s = ""; }
    else if (isInputSignalWhole()) {
      s = `Whole sound: ${t(inputSignalEnd)} = ${formatNumber(inputSignalEnd)} samples`; }
    else {
      s = `Selected: ${t(inputSignalStart)} - ${t(inputSignalEnd)} = ${t(inputSignalEnd - inputSignalStart)} = ${formatNumber(inputSignalEnd - inputSignalStart)} samples`; }
   DomUtils.setText("inputSignalSelectionInfo", s);
   DomUtils.setText("inputSignalSampleRate", `Sample Rate: ${formatNumber(inputSampleRate)}`); }

function refreshSpectrumAndFilterDisplay() {
   refreshFilterGui();
   if (!inputSpectrumViewerWidget.disabled) {
      loadInputSpectrumViewer(); }
   if (!outputSpectrumViewerWidget.disabled) {
      loadOutputSpectrumViewer(); }}

function refreshMainGui() {
   const playButtonText = audioPlayer.isPlaying() ? "Stop" : "Play";
   inputSignalViewerWidget.disabled = !inputSignalValid;
   inputSpectrumViewerWidget.disabled = !inputSpectrumValid;
   outputSpectrumViewerWidget.disabled = !outputSpectrumValid;
   outputSignalViewerWidget.disabled = !outputSignalValid;
   const inputSignalAvailable = !!inputSignalValid && inputSignalEnd > inputSignalStart;
   DomUtils.enableElement("playInputButton", inputSignalAvailable);
   DomUtils.setText("playInputButton", playButtonText);
   DomUtils.enableElement("saveInputWavFileButton", inputSignalAvailable);
   DomUtils.enableElement("fftButton", inputSignalAvailable);
   DomUtils.enableElement("ifftButton", outputSpectrumValid);
   DomUtils.enableElement("ifftAndPlayButton", outputSpectrumValid);
   DomUtils.setText("ifftAndPlayButton", audioPlayer.isPlaying() ? "Stop" : "iFFT + Play");
   DomUtils.enableElement("playOutputButton", outputSignalValid);
   DomUtils.setText("playOutputButton", playButtonText);
   DomUtils.enableElement("saveOutputWavFileButton", outputSignalValid);
   const specProc = DomUtils.getValue("specProc");
   DomUtils.showElement("filterParms", specProc == "filter");
   DomUtils.showElement("filterParms2", specProc == "filter");
   DomUtils.showElement("specScalingFactorField", specProc == "scaleTime" || specProc == "transpose");
   const averagingMode = DomUtils.getValue("averagingMode");
   DomUtils.showElement("averagingWindowFunctionField", averagingMode.startsWith("firLp"));
   const lpWin2 = averagingMode == "firLpLinLin" || averagingMode == "firLpPwrPwr" || averagingMode == "firLpPwrLog";
   DomUtils.showElement("averagingWidth2Field", lpWin2);
   DomUtils.showElement("averagingWindowFunction2Field", lpWin2); }

async function genericPlayButton_click (signal: ArrayLike<number>, sampleRate: number) {
   if (audioPlayer.isPlaying()) {
      audioPlayer.stop();
      return; }
   await audioPlayer.playSamples(signal, sampleRate); }

async function playInputButton_click() {
   await genericPlayButton_click(getInputSignalSelection(), inputSampleRate); }

async function playOutputButton_click() {
   await genericPlayButton_click(outputSignal, outputSampleRate); }

function saveWavFile (signal: ArrayLike<number>, sampleRate: number, fileName: string) {
   audioPlayer.stop();
   const wavFileData = WavFileEncoder.encodeWavFile2([signal], sampleRate, WavFileEncoder.WavFileType.float32);
   Utils.openSaveAsDialog(wavFileData, fileName, "audio/wav", "wav", "WAV audio file"); }

function saveInputWavFileButton_click() {
   const fileName = Utils.removeFileNameExtension(inputFileName) + (isInputSignalWhole() ? "" : "-sel") + ".wav";
   saveWavFile(getInputSignalSelection(), inputSampleRate, fileName); }

function saveOutputWavFileButton_click() {
   saveWavFile(outputSignal, outputSampleRate, outputFileName); }

function functionCurveViewerHelpButton_click() {
   const t = document.getElementById("functionCurveViewerHelpText")!;
   t.innerHTML = inputSignalViewerWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

function functionCurveEditorHelpButton_click() {
   const t = document.getElementById("functionCurveEditorHelpText")!;
   t.innerHTML = filterEditorWidget.getFormattedHelpText();
   t.classList.toggle("hidden"); }

async function processUrlParameters() {
   const parmsString = window.location.hash.substring(1);
   const usp = new URLSearchParams(parmsString);
   const defaultAudioFile = (window.location.protocol != "file:") ? "testSound1.wav" : undefined;
   const audioFileUrl = usp.get("file") ?? defaultAudioFile;
   const f0 = Number(usp.get("f0") ?? "0");
   if (audioFileUrl) {
      await loadAudioFileFromUrl(audioFileUrl, f0); }}

function polulateWindowFunctionSelect (elementId: string, defaultWindowFunctionId: string, addNone = false) {
   const selectElement = <HTMLSelectElement>document.getElementById(elementId)!;
   for (const d of WindowFunctions.windowFunctionIndex) {
      const selected = d.id == defaultWindowFunctionId;
      selectElement.add(new Option(d.name, d.id, selected, selected)); }
   if (addNone) {
      selectElement.add(new Option("none", "none")); }}

async function startup() {
   audioPlayer = new InternalAudioPlayer();
   audioPlayer.addEventListener("stateChange", refreshMainGui);
   const inputSignalViewerCanvas    = <HTMLCanvasElement>document.getElementById("inputSignalViewerCanvas")!;
   const inputSpectrumViewerCanvas  = <HTMLCanvasElement>document.getElementById("inputSpectrumViewerCanvas")!;
   const filterViewerCanvas         = <HTMLCanvasElement>document.getElementById("filterViewerCanvas")!;
   const filterEditorCanvas         = <HTMLCanvasElement>document.getElementById("filterEditorCanvas")!;
   const outputSpectrumViewerCanvas = <HTMLCanvasElement>document.getElementById("outputSpectrumViewerCanvas")!;
   const outputSignalViewerCanvas   = <HTMLCanvasElement>document.getElementById("outputSignalViewerCanvas")!;
   inputSignalViewerWidget    = new FunctionCurveViewer.Widget(inputSignalViewerCanvas);
   inputSpectrumViewerWidget  = new FunctionCurveViewer.Widget(inputSpectrumViewerCanvas);
   filterViewerWidget         = new FunctionCurveViewer.Widget(filterViewerCanvas);
   filterEditorWidget         = new FunctionCurveEditor.Widget(filterEditorCanvas);
   outputSpectrumViewerWidget = new FunctionCurveViewer.Widget(outputSpectrumViewerCanvas);
   outputSignalViewerWidget   = new FunctionCurveViewer.Widget(outputSignalViewerCanvas);
   polulateWindowFunctionSelect("windowFunction", "rect");
   polulateWindowFunctionSelect("averagingWindowFunction", "blackman", true);
   polulateWindowFunctionSelect("averagingWindowFunction2", "hann", true);
   DomUtils.addClickEventListener("loadLocalAudioFileButton", loadLocalAudioFileButton_click);
   DomUtils.addClickEventListener("playInputButton", playInputButton_click);
   DomUtils.addClickEventListener("saveInputWavFileButton", saveInputWavFileButton_click);
   DomUtils.addClickEventListener("fftButton", fftButton_click);
   DomUtils.addClickEventListener("copySpectrumCurveButton", copySpectrumCurveButton_click);
   DomUtils.addClickEventListener("ifftButton", ifftButton_click);
   DomUtils.addClickEventListener("ifftAndPlayButton", ifftAndPlayButton_click);
   DomUtils.addClickEventListener("playOutputButton", playOutputButton_click);
   DomUtils.addClickEventListener("saveOutputWavFileButton", saveOutputWavFileButton_click);
   DomUtils.addClickEventListener("functionCurveViewerHelpButton", functionCurveViewerHelpButton_click);
   DomUtils.addClickEventListener("functionCurveEditorHelpButton", functionCurveEditorHelpButton_click);
   DomUtils.addClickEventListener("copyAmplitudeCurveButton", copyAmplitudeCurveButton_click);
   inputSignalViewerWidget.addEventListener("segmentchange", () => catchError(inputSignalViewer_segmentChange));
   DomUtils.addChangeEventListener("amplitudeScale", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("maxDisplayFreq", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingMode", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingMode", refreshMainGui);
   DomUtils.addChangeEventListener("averagingWidth", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingWidth2", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingWindowFunction", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingWindowFunction2", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("specProc", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterType", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterFreq1", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterFreq2", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterSmoothingWidth", updateSpectralProcessing);
   filterEditorWidget.addEventListener("change", () => catchError(updateSpectralProcessingAsync));
   DomUtils.addNumericFieldFormatSwitcher("maxDisplayFreq");
   DomUtils.addNumericFieldFormatSwitcher("filterFreq1");
   DomUtils.addNumericFieldFormatSwitcher("filterFreq2");
   DomUtils.addNumericFieldFormatSwitcher("outputSampleRate");
   refreshFilterGui();
   await processUrlParameters();
   if (inputFileF0 > 0) {                                  // F0 value received in Link from ZHCorpus
      DomUtils.setValueNum("averagingWidth", inputFileF0);
      DomUtils.setValueNum("averagingWidth2", inputFileF0 * 2); }
   refreshMainGui(); }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
