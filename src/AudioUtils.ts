import * as WavFileDecoder from "wav-file-decoder";
import * as JsonSignalFileDecoder from "./JsonSignalFileDecoder.ts";

const offlineAudioContext = new OfflineAudioContext(1, 1, 44100);

export interface AudioFileData {
   channelData:              Float32Array[];
   sampleRate:               number; }

export async function decodeAudioFileData (fileData: ArrayBuffer) : Promise<AudioFileData> {
   if (WavFileDecoder.isWavFile(fileData)) {
      return WavFileDecoder.decodeWavFile(fileData); }
    else if (JsonSignalFileDecoder.isLikelyASupportedFile(fileData)) {
      const signalData = JsonSignalFileDecoder.decodeFile(fileData);
      return {channelData: [signalData.signal], sampleRate: signalData.sampleRate}; }
    else {
      const audioBuffer = await offlineAudioContext.decodeAudioData(fileData); // problem: resamples the audio signal
      const channelData: Float32Array[] = new Array(audioBuffer.numberOfChannels);
      for (let channelNo = 0; channelNo < audioBuffer.numberOfChannels; channelNo++) {
         channelData[channelNo] = audioBuffer.getChannelData(channelNo); }
      return {channelData, sampleRate: audioBuffer.sampleRate}; }}

export function removeDcOffset <T extends Float32Array|Float64Array> (a0: T) : T {
   const a = <Float32Array>a0;
   if (a.length == 0) {
      return <T>a; }
   const dcValue = a.reduce((acc, x) => acc + x, 0) / a.length;
   return <T>a.map(x => x - dcValue); }

// If `targetRms` and `targetMaxAbs` are both set (i.e. `>0`), adjust RMS and prevent clipping.
// If only `targetMaxAbs` is set, adjust maximum to target.
export function normalizeSignalLevel <T extends Float32Array|Float64Array> (a0: T, targetRms: number, targetMaxAbs: number) : T {
   const a = <Float32Array>a0;
   if (a.length == 0) {
      return <T>a; }
   let r = 1;
   if (targetRms > 0) {
      const rms = Math.sqrt(a.reduce((acc, x) => acc + x**2, 0) / a.length);
      r = targetRms / rms; }
   if (targetMaxAbs > 0) {
      const maxAbs = a.reduce((max, x) => Math.max(max, Math.abs(x)), 0);
      if (targetRms > 0 && r * maxAbs >= targetMaxAbs || targetRms <= 0) {
         r = targetMaxAbs / maxAbs; }}
   return <T>a.map(x => x * r); }
