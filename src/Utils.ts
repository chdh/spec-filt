const dummyResolvedPromise = Promise.resolve();
const numberFormat = new Intl.NumberFormat("en-US");

export function nextTick (callback: () => void) {
   void dummyResolvedPromise.then(callback); }

export function formatNumber (n: number | undefined, includeSign: boolean = false) : string {
   if (n === undefined || !isFinite(n)) {
      return ""; }
   const plusSign = (includeSign && n > 0) ? "+" : "";
   return plusSign + numberFormat.format(n).replace(/,/g, "\u202F"); }

// Returns undefined if the string does not contain a valid number.
export function decodeNumber (s: string) : number | undefined {
   if (!s) {
      return undefined; }
   const n = Number(s.replace(/[\u{2000}-\u{20FF}]/gu, ""));
   return isFinite(n) ? n : undefined; }

export function catchError (f: Function, ...args: any[]) {
   void catchErrorAsync(f, ...args); }

async function catchErrorAsync (f: Function, ...args: any[]) {
   try {
      const r = f(...args);
      if (r instanceof Promise) {
         await r; }}
    catch (error) {
      console.log(error);
      alert("Error: " + error); }}

export function openFileOpenDialog (callback: (file: File) => void) {
   if ((<any>window).showOpenFilePicker) {
      openFileOpenDialog_new().then(callback, (e) => console.log(e)); }
    else {
      openFileOpenDialog_old(callback); }}

async function openFileOpenDialog_new() : Promise<File> {
   const pickerOpts = {};
   const fileHandle: FileSystemFileHandle = (await (<any>window).showOpenFilePicker(pickerOpts))[0];
   const file = await fileHandle.getFile();
   return file; }

function openFileOpenDialog_old (callback: (file: File) => void) {
   const element: HTMLInputElement = document.createElement("input");
   element.type = "file";
   element.addEventListener("change", () => {
      if (element.files && element.files.length == 1) {
         callback(element.files[0]); }});
   const clickEvent = new MouseEvent("click");
   element.dispatchEvent(clickEvent);
   (<any>document).dummyFileOpenElementHolder = element; } // to prevent garbage collection

export function openSaveAsDialog (data: ArrayBuffer, fileName: string, mimeType: string, fileNameExtension: string, fileTypeDescription: string) {
   if ((<any>window).showSaveFilePicker) {
      catchError(openSaveAsDialog_new, data, fileName, mimeType, fileNameExtension, fileTypeDescription); }
    else {
      openSaveAsDialog_old(data, fileName, mimeType); }}

async function openSaveAsDialog_new (data: ArrayBuffer, fileName: string, mimeType: string, fileNameExtension: string, fileTypeDescription: string) {
   const fileTypeDef: any = {};
   fileTypeDef[mimeType] = ["." + fileNameExtension];
   const pickerOpts = {
      suggestedName: fileName,
      types: [{
         description: fileTypeDescription,
         accept: fileTypeDef }]};
   let fileHandle: FileSystemFileHandle;
   try {
      fileHandle = await (<any>window).showSaveFilePicker(pickerOpts); }
    catch (e) {
      if (e.name == "AbortError") {
         return; }
      throw e; }
   const stream /* : FileSystemWritableFileStream */ = await (<any>fileHandle).createWritable();
   await stream.write(data);
   await stream.close(); }

function openSaveAsDialog_old (data: ArrayBuffer, fileName: string, mimeType: string) {
   const blob = new Blob([data], {type: mimeType});
   const url = URL.createObjectURL(blob);
   const element = document.createElement("a");
   element.href = url;
   element.download = fileName;
   const clickEvent = new MouseEvent("click");
   element.dispatchEvent(clickEvent);
   setTimeout(() => URL.revokeObjectURL(url), 60000);
   (<any>document).dummySaveAsElementHolder = element; }   // to prevent garbage collection

export function removeFileNameExtension (s: string) : string {
   const p = s.lastIndexOf(".");
   return (p > 0) ? s.substring(0, p) : s; }

export function getFileNameExtension (s: string) : string | undefined {
   const p = s.lastIndexOf(".");
   return (p > 0) ? s.substring(p + 1) : undefined; }
