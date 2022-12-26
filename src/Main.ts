import * as Utils from "./Utils.js";
import {catchError, formatNumber, AsyncCallGate} from "./Utils.js";
import InternalAudioPlayer from "./InternalAudioPlayer.js";
import * as DomUtils from "./DomUtils.js";
import * as AudioUtils from "./AudioUtils.js";
import * as WavFileEncoder from "wav-file-encoder";
import * as FunctionCurveViewer from "function-curve-viewer";
import * as FunctionCurveEditor from "function-curve-editor";
import * as WindowFunctions from "dsp-collection/signal/WindowFunctions.js";
import * as Fft from "dsp-collection/signal/Fft.js";
// import * as Resampling from "dsp-collection/signal/Resampling.js";
import * as DspUtils from "dsp-collection/utils/DspUtils.js";
import * as MathUtils from "dsp-collection/math/MathUtils.js";
import * as SpecFilt from "dsp-collection/filter/SpecFilt.js";
import {FilterCurveFunction} from "dsp-collection/filter/SpecFilt.js";
import ComplexArray from "dsp-collection/math/ComplexArray.js";

var audioPlayer:                       InternalAudioPlayer;

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

// Input spectrum:
var inputSpectrumValid:                boolean = false;
var inputSpectrumAmplitudes:           Float64Array;                 // linear Amplitudes
var inputSpectrumPhases:               Float64Array;
var inputSpectrumScalingFactor:        number;

// Filter:
var filterEditorWidgetKnotsAreLog:     boolean = false;
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
      viewerFunction:  viewerFunction,
      xMin:            0,
      xMax:            signal.length / sampleRate,
      yMin:            -yRange,
      yMax:            yRange,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:       "s",
      focusShield:     true };
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

//--- Spectrum viewers ---------------------------------------------------------

// Load spectrum amplitude viewer.
function loadSpectrumViewer (widget: FunctionCurveViewer.Widget, spectrum: Float64Array, scalingFactor: number) {
   const scaleIsLog = DomUtils.getValue("amplitudeScale") == "log";
   const spectrum2 = scaleIsLog ? spectrum.map(DspUtils.convertAmplitudeToDb) : spectrum;
   const spectrumFunction = FunctionCurveViewer.createViewerFunctionForArray(spectrum2, {scalingFactor, nearestNeighbor: true});
   const averagingWidth = Math.round(DomUtils.getValueNum("averagingWidth") * scalingFactor);
   let averagingFunction: FunctionCurveViewer.ViewerFunction | undefined = undefined;
   if (averagingWidth >= 2) {
      const averagedSpectrum = MathUtils.movingAverage(spectrum, averagingWidth);
      const averagedSpectrum2 = scaleIsLog ? averagedSpectrum.map(DspUtils.convertAmplitudeToDb) : averagedSpectrum;
      averagingFunction = FunctionCurveViewer.createViewerFunctionForArray(averagedSpectrum2, {scalingFactor, nearestNeighbor: true, average: true}); }
   const viewerFunction = (x: number, sampleWidth: number, channel: number) => {
      switch (channel) {
         case 0:  return averagingFunction ? averagingFunction(x, sampleWidth, 0) : undefined;
         case 1:  return spectrumFunction(x, sampleWidth, 0);
         default: throw new Error(); }};
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:  viewerFunction,
      channels:        2,
      xMin:            0,
      xMax:            DomUtils.getValueNum("maxDisplayFreq"),
      yMin:            scaleIsLog ? -100 : 0,
      yMax:            scaleIsLog ? 0 : 0.2,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit:       scaleIsLog ? "dB" : undefined,
      focusShield:     true };
   widget.setViewerState(viewerState); }

//--- Load audio file ----------------------------------------------------------

async function loadAudioFileData (fileData: ArrayBuffer, fileName: string) {
   const audioData = await AudioUtils.decodeAudioFileData(fileData);
   inputSignal = audioData.channelData[0];                 // only the first channel is used
   inputSignalStart = 0;
   inputSignalEnd = inputSignal.length;
   inputSampleRate = audioData.sampleRate;
   inputFileName = fileName;
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

async function loadAudioFileFromUrl (url: string) {
   const fileData = await loadFileFromUrl(url);
   const fileName = url.substring(url.lastIndexOf("/") + 1);
   await loadAudioFileData(fileData, fileName); }

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
   if (inputSignalLen % 2 == 1 && inputSignalLen > 4096) {
      console.log(`Note: The input signal length is reduced from ${inputSignalLen} to ${inputSignalLen - 1} to make it even and thus allowing faster FFT processing.`);
      inputSignalLen--; }
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
         const scaleIsLog = DomUtils.getValue("amplitudeScale") == "log";
         const filterCurveFunction = filterEditorWidget.getFunction();
         if (scaleIsLog) {
            return (frequency: number) => DspUtils.convertDbToAmplitude(filterCurveFunction(frequency)); }
          else {
            return filterCurveFunction; }}
      default: {
         const filterFreq1 = DomUtils.getValueNum("filterFreq1");
         const filterFreq2 = DomUtils.getValueNum("filterFreq2");
         const smoothingWidth = DomUtils.getValueNum("filterSmoothingWidth");
         return SpecFilt.getFilterCurveFunction(<SpecFilt.FilterType>filterType, filterFreq1, filterFreq2, smoothingWidth); }}}

function loadFilterCurveViewer() {
   const scaleIsLog = DomUtils.getValue("amplitudeScale") == "log";
   const filterCurveFunction = genFilterCurveFunction();
   let viewerFunction: (x: number) => number;
   if (scaleIsLog) {
      viewerFunction = (frequency: number) => {
         const lin = filterCurveFunction(frequency);
         const log = DspUtils.convertAmplitudeToDb(lin);
         return Math.max(-95, log); }; }
    else {
      viewerFunction = filterCurveFunction; }
   const viewerState : Partial<FunctionCurveViewer.ViewerState> = {
      viewerFunction:  viewerFunction,
      xMin:            0,
      xMax:            DomUtils.getValueNum("maxDisplayFreq"),
      yMin:            scaleIsLog ? -100 : 0,
      yMax:            scaleIsLog ? 10 : 1.2,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveViewer.ZoomMode.x,
      xAxisUnit:       "Hz",
      yAxisUnit:       scaleIsLog ? "dB" : undefined,
      focusShield:     true };
   filterViewerWidget.setViewerState(viewerState); }

function updateFilterEditorWidget (reset: boolean) {
   const scaleIsLog = DomUtils.getValue("amplitudeScale") == "log";
   if (!reset && filterEditorWidgetLoaded && scaleIsLog == filterEditorWidgetKnotsAreLog) {
      return; }
   const oldKnots = filterEditorWidget.getEditorState().knots;
   let knots: FunctionCurveEditor.Point[];
   if (oldKnots.length == 0) {
      knots = [];
      for (let x = 0; x <= 4500; x += 500) {
         knots.push({x, y: scaleIsLog ? 0 : 1}); }}
    else if (scaleIsLog == filterEditorWidgetKnotsAreLog) {
      knots = oldKnots; }
    else if (scaleIsLog) {
      knots = oldKnots.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: Math.max(-100, DspUtils.convertAmplitudeToDb(Math.max(0, p.y)))})); }
    else {
      knots = oldKnots.map((p: FunctionCurveEditor.Point) => ({x: p.x, y: DspUtils.convertDbToAmplitude(p.y)})); }
   const editorState = <FunctionCurveEditor.EditorState>{
      knots:           knots,
      xMin:            0,
      xMax:            DomUtils.getValueNum("maxDisplayFreq"),
      yMin:            scaleIsLog ? -100 : 0,
      yMax:            scaleIsLog ? 30 : 1.5,
      extendedDomain:  true,
      relevantXMin:    0,
      gridEnabled:     true,
      primaryZoomMode: FunctionCurveEditor.ZoomMode.x,
      focusShield:     true };
   filterEditorWidget.setEditorState(editorState);
   filterEditorWidgetKnotsAreLog = scaleIsLog;
   filterEditorWidgetLoaded = true; }

function refreshFilterGui() {
   const filterType = DomUtils.getValue("filterType");
   const isBand = filterType == "BP" || filterType == "BS";
   const isCurve = filterType == "curve";
   DomUtils.showElement("filterFreq1", !isCurve);
   DomUtils.showElement("filterFreq2", isBand);
   DomUtils.showElement("filterSmoothingWidth", !isCurve);
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
   DomUtils.showElement("specScalingFactor", specProc == "scaleTime" || specProc == "transpose"); }

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
   if (audioFileUrl) {
      await loadAudioFileFromUrl(audioFileUrl); }}

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
   const windowFunctionSelect = <HTMLSelectElement>document.getElementById("windowFunction")!;
   for (const d of WindowFunctions.windowFunctionIndex) {
      const selected = d.id == "rect";
      windowFunctionSelect.add(new Option(d.name, d.id, selected, selected)); }
   DomUtils.addClickEventListener("loadLocalAudioFileButton", loadLocalAudioFileButton_click);
   DomUtils.addClickEventListener("playInputButton", playInputButton_click);
   DomUtils.addClickEventListener("saveInputWavFileButton", saveInputWavFileButton_click);
   DomUtils.addClickEventListener("fftButton", fftButton_click);
   DomUtils.addClickEventListener("ifftButton", ifftButton_click);
   DomUtils.addClickEventListener("ifftAndPlayButton", ifftAndPlayButton_click);
   DomUtils.addClickEventListener("playOutputButton", playOutputButton_click);
   DomUtils.addClickEventListener("saveOutputWavFileButton", saveOutputWavFileButton_click);
   DomUtils.addClickEventListener("functionCurveViewerHelpButton", functionCurveViewerHelpButton_click);
   DomUtils.addClickEventListener("functionCurveEditorHelpButton", functionCurveEditorHelpButton_click);
   inputSignalViewerWidget.addEventListener("segmentchange", () => catchError(inputSignalViewer_segmentChange));
   DomUtils.addChangeEventListener("amplitudeScale", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("averagingWidth", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("maxDisplayFreq", refreshSpectrumAndFilterDisplay);
   DomUtils.addChangeEventListener("specProc", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterType", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterFreq1", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterFreq2", updateSpectralProcessing);
   DomUtils.addChangeEventListener("filterSmoothingWidth", updateSpectralProcessing);
   filterEditorWidget.addEventListener("change", () => catchError(updateSpectralProcessingAsync));
   DomUtils.restoreValueNum("averagingWidth", 100);
   DomUtils.restoreValueNum("maxDisplayFreq", 5500);
   DomUtils.restoreValueNum("filterFreq1", 1000);
   DomUtils.restoreValueNum("filterFreq2", 2000);
   DomUtils.restoreValueNum("filterSmoothingWidth", 100);
   DomUtils.restoreValueNum("outputSampleRate", 44100);
   DomUtils.addValueNumSaver("averagingWidth");
   DomUtils.addValueNumSaver("maxDisplayFreq");
   DomUtils.addValueNumSaver("filterFreq1");
   DomUtils.addValueNumSaver("filterFreq2");
   DomUtils.addValueNumSaver("filterSmoothingWidth");
   DomUtils.addValueNumSaver("outputSampleRate");
   DomUtils.addNumericFieldFormatSwitcher("maxDisplayFreq");
   DomUtils.addNumericFieldFormatSwitcher("filterFreq1");
   DomUtils.addNumericFieldFormatSwitcher("filterFreq2");
   DomUtils.addNumericFieldFormatSwitcher("outputSampleRate");
   refreshFilterGui();
   await processUrlParameters();
   refreshMainGui(); }

document.addEventListener("DOMContentLoaded", () => catchError(startup));
