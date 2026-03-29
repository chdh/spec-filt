// Decoder for a custom JSON file format used to store audio and other signals.

// We use an experimental JSON file format to read special signal curves in the same way as we read standard audio files.
// This file format can be expanded in the future to support additional import capabilities for tools that process audio signals.
//
// The current file format uses interpolation knots (points with x/y coordinates) to define a signal curve.
//
// Example:
//
// {
//    "sampleRate": 44100,
//    "knots": [[0, 0], [0.025, 0.1], [0.05, 0.3], [0.075, 0.25], [0.1, -0.1], [0.125, 0]]
// }

import {createInterpolatorWithFallback} from "commons-math-interpolation";

// Returns true if the passed file data looks like a supported file.
export function isLikelyASupportedFile (fileData: ArrayBufferView | ArrayBuffer) : boolean {
   let a: Uint8Array;
   if (fileData instanceof ArrayBuffer) {
      a = new Uint8Array(fileData); }
    else {
      a = new Uint8Array(fileData.buffer, fileData.byteOffset, fileData.byteLength); }
   if (a.length < 10) {
      return false; }
   let p1 = (a[0] == 0xEF && a[1] == 0xBB && a[2] == 0xBF) ? 3 : 0;            // skip UTF-8 BOM
   while (p1 < a.length && a[p1] <= 0x20) {                                    // skip blanks, tabs, EOL, etc.
      p1++; }
   if (p1 >= a.length || a[p1] != 0x7B) {                                      // first char must be "{"
      return false; }
   let p2 = a.length - 1;
   while (p2 > p1 && a[p2] <= 0x20) {                                          // skip blanks, tabs, EOL etc. at end
      p2--; }
   if (p2 <= p1 || a[p2] != 0x7D) {                                            // last char must be "{"
      return false; }
   return true; }

export interface SignalData {
   signal:                   Float32Array;
   sampleRate:               number; }

export function decodeFile (fileData: ArrayBufferView | ArrayBuffer) : SignalData {
   const textDecoder = new TextDecoder();
   const json = textDecoder.decode(fileData);
   const rootObj = JSON.parse(json);
   if (typeof rootObj != "object") {
      throw new Error("Invalid JSON format for signal file."); }
   const sampleRate = rootObj.sampleRate ?? 44100;
   if (typeof sampleRate != "number" || sampleRate <= 0) {
      throw new Error("Invalid sample rate in signal file."); }
   const knots = rootObj.knots;
   if (!validateKnots(knots)) {
      throw new Error("Missing or invalid knots array in signal file."); }
   const signal = createSignalFromKnots(knots, sampleRate);
   return {signal, sampleRate}; }

function validateKnots (knots: any) : boolean {
   if (!Array.isArray(knots)) {
      return false; }
   for (const knot of knots) {
      if (!Array.isArray(knot) || knot.length != 2 || !Number.isFinite(knot[0]) || !Number.isFinite(knot[1])) {
         return false; }}
   return true; }

function createSignalFromKnots (knots: number[][], sampleRate: number) : Float32Array {
   const xVals = knots.map(knot => knot[0]);
   const yVals = knots.map(knot => knot[1]);
   const f = createInterpolatorWithFallback("akima", xVals, yVals);
   const xMax = xVals.length > 0 ? xVals[xVals.length - 1] : 0;
   const n = xMax * sampleRate;
   const signal = new Float32Array(n);
   for (let p = 0; p < n; p++) {
      const x = p / sampleRate;
      const y = f(x);
      signal[p] = y; }
   return signal; }
