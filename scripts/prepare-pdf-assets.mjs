import { mkdir, copyFile, readFile, writeFile } from 'node:fs/promises';

const source = 'node_modules/@hyzyla/pdfium/dist';
await mkdir('public/pdf', { recursive: true });
await mkdir('build/pdf-engine', { recursive: true });
await copyFile(`${source}/pdfium.wasm`, 'public/pdf/pdfium.wasm');
await copyFile(`${source}/index.esm.browser.js`, 'public/pdf/pdfium.js');

// PDFium saves through an FPDF_FILEWRITE callback. Reserve one extra function-table
// slot in the server build so the callback never replaces a PDFium function.
const wasm = await readFile(`${source}/pdfium.wasm`);
function readUnsigned(bytes, offset) {
  let value = 0;
  for (let shift = 0; shift <= 28; shift += 7) {
    const byte = bytes[offset++];
    value += (byte & 127) * 2 ** shift;
    if (!(byte & 128)) return [value, offset];
  }
  throw new Error('Invalid PDFium WASM integer');
}
function unsigned(value) {
  const bytes = [];
  while (value >= 128) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  return Buffer.from([...bytes, value]);
}
let offset = 8;
let patched = false;
while (offset < wasm.length) {
  const section = wasm[offset++];
  const lengthOffset = offset;
  const [size, start] = readUnsigned(wasm, offset);
  offset = start + size;
  if (section !== 4) continue;
  const [count, element] = readUnsigned(wasm, start);
  if (count !== 1 || wasm[element] !== 0x70 || wasm[element + 1] !== 1) {
    throw new Error('Unexpected PDFium WASM table layout');
  }
  const [minimum, maximumOffset] = readUnsigned(wasm, element + 2);
  const [maximum, end] = readUnsigned(wasm, maximumOffset);
  if (minimum !== maximum || end !== offset) throw new Error('Unexpected PDFium WASM table bounds');
  const table = Buffer.concat([wasm.subarray(start, maximumOffset), unsigned(maximum + 1)]);
  await writeFile('build/pdf-engine/pdfium.wasm', Buffer.concat([
    wasm.subarray(0, lengthOffset),
    unsigned(table.length),
    table,
    wasm.subarray(offset),
  ]));
  patched = true;
  break;
}
if (!patched) throw new Error('PDFium WASM table not found');

// (module (import "env" "write" (func (param i32 i32 i32) (result i32)))
//   (export "write" (func 0)))
await writeFile('build/pdf-engine/writer.wasm', Buffer.from(
  '0061736d0100000001080160037f7f7f017f020d0103656e7605777269746500000709010577726974650000',
  'hex',
));
console.log('PDF engine assets prepared.');
