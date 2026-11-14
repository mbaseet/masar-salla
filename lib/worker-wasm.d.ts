declare module '*.wasm' {
  const module: WebAssembly.Module;
  export default module;
}

declare module '@hyzyla/pdfium/dist/index.esm.browser.js' {
  export { PDFiumDocument, PDFiumModule } from '@hyzyla/pdfium';
}
