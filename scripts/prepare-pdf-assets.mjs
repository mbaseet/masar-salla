import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('public/pdf', { recursive: true });
await copyFile('node_modules/@hyzyla/pdfium/dist/pdfium.wasm','public/pdf/pdfium.wasm');
await copyFile('node_modules/@hyzyla/pdfium/dist/index.esm.browser.js','public/pdf/pdfium.js');
console.log('PDF engine assets prepared.');
