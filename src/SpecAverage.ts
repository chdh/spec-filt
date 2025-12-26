// Averaging of the spectrum-

import * as FirFilterWin from "dsp-collection/filter/FirFilterWin";
import * as SpecFilt from "dsp-collection/filter/SpecFilt";
import * as DspUtils from "dsp-collection/utils/DspUtils";
import * as MathUtils from "dsp-collection/math/MathUtils";

function filterArray (signal: Float64Array, filterSpec: FirFilterWin.FilterSpec) : Float64Array {
   if (filterSpec.windowFunctionId == "none") {
      return signal; }
   return FirFilterWin.filterArray(signal, filterSpec); }

// SMA linear - Simple moving average over the linear spectral pressure amplitude values.
function createSpectrumAverage_smaLin (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 2) {
      return undefined; }
   const averagedSpectrum = MathUtils.simpleMovingAverage(spectrum, averagingWidth);
   return averagedSpectrum.map(DspUtils.convertAmplitudeToDb); }

// SMA power - Simple moving average over the linear spectral power values.
function createSpectrumAverage_smaPwr (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 2) {
      return undefined; }
   const spectrumSqr = spectrum.map(x => x * x);
   const averagedSpectrumSqr = MathUtils.simpleMovingAverage(spectrumSqr, averagingWidth);
   return averagedSpectrumSqr.map(DspUtils.convertPowerToDb); }

// SMA log - Simple moving average over the logarithmic spectral amplitude values.
function createSpectrumAverage_smaLog (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 2) {
      return undefined; }
   const spectrumLog = spectrum.map(DspUtils.convertAmplitudeToDb);
   return MathUtils.simpleMovingAverage(spectrumLog, averagingWidth); }

// TMA linear - Triangular moving average over the linear spectral pressure amplitude values.
function createSpectrumAverage_tmaLin (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 4) {
      return undefined; }
   const averagedSpectrum = MathUtils.triangularMovingAverage(spectrum, averagingWidth);
   return averagedSpectrum.map(DspUtils.convertAmplitudeToDb); }

// TMA power - Triangular moving average over the linear spectral power values.
function createSpectrumAverage_tmaPwr (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 4) {
      return undefined; }
   const spectrumSqr = spectrum.map(x => x * x);
   const averagedSpectrumSqr = MathUtils.triangularMovingAverage(spectrumSqr, averagingWidth);
   return averagedSpectrumSqr.map(DspUtils.convertPowerToDb); }

// TMA log - Triangular moving average over the logarithmic spectral amplitude values.
function createSpectrumAverage_tmaLog (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 4) {
      return undefined; }
   const spectrumLog = spectrum.map(DspUtils.convertAmplitudeToDb);
   return MathUtils.triangularMovingAverage(spectrumLog, averagingWidth); }

// SMA power + 2x SMA log.
// The first SMA is performed on the power amplitudes.
// The second and third SMA is performed on the log amplitudes.
function createSpectrumAverage_smaPwrLog2 (spectrum: Float64Array, averagingWidth: number) : Float64Array | undefined {
   if (averagingWidth < 8) {
      return undefined; }
   const spectrumSqr = spectrum.map(x => x * x);                                                   // power values
   const averagedSpectrumSqr = MathUtils.simpleMovingAverage(spectrumSqr, averagingWidth);         // first SMA (power values)
   const specLog1 = averagedSpectrumSqr.map(DspUtils.convertPowerToDb);                            // convert to log
   const averagingWidth2 = Math.round(averagingWidth / 2);
// const averagingWidth2 = Math.round(averagingWidth / 2 / Math.sqrt(2));
   const specLog2 = MathUtils.simpleMovingAverage(specLog1, averagingWidth2);                      // second SMA (log values)
   const averagingWidth3 = Math.round(averagingWidth2 / 2);
// const averagingWidth3 = averagingWidth2;
   return MathUtils.simpleMovingAverage(specLog2, averagingWidth3); }                              // third SMA (log values)

// FIR LP filter over the linear spectral pressure amplitude values.
function createSpectrumAverage_firLpLin (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string) : Float64Array {
   const out1 = filterArray(spectrum, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});
   const out2 = out1.map((x) => Math.max(0, x));                                                   // clip because "flat top" window can produce negative values
   const out3 = out2.map(DspUtils.convertAmplitudeToDb);
   return out3; }

// FIR LP filter over the linear spectral power values.
function createSpectrumAverage_firLpPwr (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string) : Float64Array {
   const spectrumSqr = spectrum.map(x => x * x);                                                   // power values
   const out1 = filterArray(spectrumSqr, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});
   const out2 = out1.map((x) => Math.max(0, x));                                                   // clip because "flat top" window can produce negative values
   const out3 = out2.map(DspUtils.convertPowerToDb);
   return out3; }

// FIR LP flter over the logarithmic spectral amplitude values.
function createSpectrumAverage_firLpLog (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string) : Float64Array {
   const spectrumLog = spectrum.map(DspUtils.convertAmplitudeToDb);
   return filterArray(spectrumLog, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth}); }

// Dual FIR LP filter (2x linear).
function createSpectrumAverage_firLpLinLin (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string, averagingWidth2: number, averagingWindowFunctionId2: string) : Float64Array {
   const a1 = spectrum;                                                                                // linear amplitude values
   const a2 = filterArray(a1, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});   // first filter, linear values
   const a3 = filterArray(a2, {windowFunctionId: averagingWindowFunctionId2, width: averagingWidth2}); // second filter, linear values
   const a4 = a3.map((x) => Math.max(0, x));                                                           // clip because "flat top" window can produce negative values
   const a5 = a4.map(DspUtils.convertAmplitudeToDb);
   return a5; }

// Dual FIR LP filter (2x power).
function createSpectrumAverage_firLpPwrPwr (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string, averagingWidth2: number, averagingWindowFunctionId2: string) : Float64Array {
   const a1 = spectrum.map(x => x * x);                                                                // power values
   const a2 = filterArray(a1, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});   // first filter, power values
   const a3 = filterArray(a2, {windowFunctionId: averagingWindowFunctionId2, width: averagingWidth2}); // second filter, power values
   const a4 = a3.map((x) => Math.max(0, x));                                                           // clip because "flat top" window can produce negative values
   const a5 = a4.map(DspUtils.convertPowerToDb);
   return a5; }

// Dual FIR LP filter (1x power + 1x log).
function createSpectrumAverage_firLpPwrLog (spectrum: Float64Array, averagingWidth: number, averagingWindowFunctionId: string, averagingWidth2: number, averagingWindowFunctionId2: string) : Float64Array {
   const a1 = spectrum.map(x => x * x);                                                                // power values
   const a2 = filterArray(a1, {windowFunctionId: averagingWindowFunctionId, width: averagingWidth});   // first filter, power values
   const a3 = a2.map((x) => Math.max(0, x));                                                           // clip because "flat top" window can produce negative values
   const a4 = a3.map(DspUtils.convertPowerToDb);
   const a5 = a4.map((x) => Math.max(-100, x));                                                        // clip dB values to -100. dB Values can be very low negative and that would disturb the following filter.
   const a6 = filterArray(a5, {windowFunctionId: averagingWindowFunctionId2, width: averagingWidth2}); // second filter, log values
   return a6; }

// Spectral LP filter over the linear spectral pressure amplitude values.
// This method does not produce a useful result.
function createSpectrumAverage_specLpLin (spectrum: Float64Array, scalingFactor: number, averagingWidth: number) : Float64Array | undefined {
   const a1 = spectrum;
   const a2 = trimAndFadeSpectrum(a1, scalingFactor);
   const smoothingFactor = 0.2;                                                                    // factor for LP filter -6dB smoothing width (= 1/2 of total smoothing width)
   const lpFilterCutoffNormBase = 1 / averagingWidth;
   const lpFilterSmoothingWidthNorm = lpFilterCutoffNormBase * smoothingFactor;
   const lpFilterCutoffNorm = lpFilterCutoffNormBase + lpFilterSmoothingWidthNorm;                 // move LP filter cutoff up to avoid smoothing within LP passband
   const a3 = SpecFilt.filterSignal(a2, SpecFilt.FilterType.lowPass, lpFilterCutoffNorm, 0, lpFilterSmoothingWidthNorm);
   const a4 = a3.map((x) => Math.max(0, x));                                                       // clip because spectral filtering can produce negative values
   const a5 = a4.map(DspUtils.convertAmplitudeToDb);
   return a5; }

// Spectral LP filter over the spectral power amplitude values.
// This method does not produce a useful result.
function createSpectrumAverage_specLpPwr (spectrum: Float64Array, scalingFactor: number, averagingWidth: number) : Float64Array | undefined {
   const a1 = spectrum.map(x => x * x);                                                            // power values
   const a2 = trimAndFadeSpectrum(a1, scalingFactor);
   const smoothingFactor = 0.2;                                                                    // factor for LP filter -6dB smoothing width (= 1/2 of total smoothing width)
   const lpFilterCutoffNormBase = 1 / averagingWidth;
   const lpFilterSmoothingWidthNorm = lpFilterCutoffNormBase * smoothingFactor;
   const lpFilterCutoffNorm = lpFilterCutoffNormBase + lpFilterSmoothingWidthNorm;                 // move LP filter cutoff up to avoid smoothing within LP passband
   const a3 = SpecFilt.filterSignal(a2, SpecFilt.FilterType.lowPass, lpFilterCutoffNorm, 0, lpFilterSmoothingWidthNorm);
   const a4 = a3.map((x) => Math.max(0, x));                                                       // clip because spectral filtering can produce negative values
   const a5 = a4.map(DspUtils.convertPowerToDb);
   return a5; }

// Spectral LP filter over the logarithmic spectral amplitude values.
function createSpectrumAverage_specLpLog (spectrum: Float64Array, _scalingFactor: number, averagingWidth: number) : Float64Array | undefined {
// const a1 = trimAndFadeSpectrum(spectrum, scalingFactor);
   const a1 = spectrum.map(DspUtils.convertAmplitudeToDb);
   const a2 = a1.map((x) => Math.max(-100, x));
   const smoothingFactor = 0.1;                                                                    // factor for LP filter -6dB smoothing width (= 1/2 of total smoothing width)
   const lpFilterCutoffNormBase = 1 / averagingWidth;
   const lpFilterSmoothingWidthNorm = lpFilterCutoffNormBase * smoothingFactor;
   const lpFilterCutoffNorm = lpFilterCutoffNormBase + lpFilterSmoothingWidthNorm;                 // move LP filter cutoff up to avoid smoothing within LP passband
   const a3 = SpecFilt.filterSignal(a2, SpecFilt.FilterType.lowPass, lpFilterCutoffNorm, 0, lpFilterSmoothingWidthNorm);
   return a3; }

// #param spectrum
//    Linear spectrum amplitudes.
// @returns
//    Log spectrum amplitudes.
export function createSpectrumAverage (spectrum: Float64Array, scalingFactor: number, averagingMode: string, averagingWidth: number, averagingWindowFunctionId: string, averagingWidth2: number, averagingWindowFunctionId2: string) : Float64Array | undefined {
   switch (averagingMode) {
      case "smaLin":      return createSpectrumAverage_smaLin(spectrum, averagingWidth);
      case "smaPwr":      return createSpectrumAverage_smaPwr(spectrum, averagingWidth);
      case "smaLog":      return createSpectrumAverage_smaLog(spectrum, averagingWidth);
      case "tmaLin":      return createSpectrumAverage_tmaLin(spectrum, averagingWidth);
      case "tmaPwr":      return createSpectrumAverage_tmaPwr(spectrum, averagingWidth);
      case "tmaLog":      return createSpectrumAverage_tmaLog(spectrum, averagingWidth);
      case "smaPwrLog2":  return createSpectrumAverage_smaPwrLog2(spectrum, averagingWidth);
      case "firLpLin":    return createSpectrumAverage_firLpLin(spectrum, averagingWidth, averagingWindowFunctionId);
      case "firLpPwr":    return createSpectrumAverage_firLpPwr(spectrum, averagingWidth, averagingWindowFunctionId);
      case "firLpLog":    return createSpectrumAverage_firLpLog(spectrum, averagingWidth, averagingWindowFunctionId);
      case "firLpLinLin": return createSpectrumAverage_firLpLinLin(spectrum, averagingWidth, averagingWindowFunctionId, averagingWidth2, averagingWindowFunctionId2);
      case "firLpPwrPwr": return createSpectrumAverage_firLpPwrPwr(spectrum, averagingWidth, averagingWindowFunctionId, averagingWidth2, averagingWindowFunctionId2);
      case "firLpPwrLog": return createSpectrumAverage_firLpPwrLog(spectrum, averagingWidth, averagingWindowFunctionId, averagingWidth2, averagingWindowFunctionId2);
      case "specLpLin":   return createSpectrumAverage_specLpLin(spectrum, scalingFactor, averagingWidth);
      case "specLpPwr":   return createSpectrumAverage_specLpPwr(spectrum, scalingFactor, averagingWidth);
      case "specLpLog":   return createSpectrumAverage_specLpLog(spectrum, scalingFactor, averagingWidth);
      default:            return undefined; }}

function trimAndFadeSpectrum (a: Float64Array, scalingFactor: number) : Float64Array {
   const maxFreq = 8000;
// const n1 = maxFreq * scalingFactor;
// const n2 = Math.floor(n1 / 2) * 2;                                                              // round length to multiple of 2 for optimal FFT
// const a1 = a.subarray(0, n2);                                                                   // reduce spectrum extension for speed optimization
// -> The problem with this trimming of the spectrum is, that it reduces the frequency resolution of the secondary FFT.
   const a1 = a;

   const fadingFunc = SpecFilt.getFilterCurveFunction(SpecFilt.FilterType.bandPass, 50, maxFreq - 100, 25);
   const a2 = SpecFilt.applyFilterCurveFunction(a1, scalingFactor, fadingFunc);                    // apply "fading" on the spectrum to dampen unwanted FFT artifacts
   return a2; }
