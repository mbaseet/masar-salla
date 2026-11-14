import { PDFiumDocument, PDFiumModule } from '@hyzyla/pdfium/dist/index.esm.browser.js';

type InstanceCallback = (instance: WebAssembly.Instance, module: WebAssembly.Module) => void;
type PDFium = Awaited<ReturnType<typeof PDFiumModule>> & {
  _FPDF_CreateNewDocument(): number;
  _FPDF_ImportPagesByIndex(destination: number, source: number, indices: number, count: number, at: number): number;
  _FPDF_SaveAsCopy(document: number, writer: number, flags: number): number;
};

export async function withPdf<T>(
  engine: WebAssembly.Module, writer: WebAssembly.Module,
  input: ReadableStream<Uint8Array>, size: number,
  use: (document: {
    count: number;
    text: (page: number) => string;
    preview: (page: number, maxSize?: number) => ReturnType<ReturnType<PDFiumDocument['getPage']>['render']>;
    copy: (pages: number[]) => { stream: ReadableStream<Uint8Array>; size: number };
  }) => Promise<T> | T,
): Promise<T> {
  let table: WebAssembly.Table | undefined;
  let writerSlot: number | undefined;
  const module = await PDFiumModule({
    // The package declaration describes the callback loosely. Emscripten calls it
    // with a function that receives the instance and compiled module.
    instantiateWasm: ((imports: WebAssembly.Imports, ready: InstanceCallback) => {
      const instance = new WebAssembly.Instance(engine, imports);
      table = instance.exports.__indirect_function_table as WebAssembly.Table;
      ready(instance, engine);
      return instance.exports;
    }) as unknown as NonNullable<Parameters<typeof PDFiumModule>[0]['instantiateWasm']>,
  }) as PDFium;
  const { malloc, free } = module.wasmExports;
  module._FPDF_InitLibraryWithConfig({
    version: 2, m_pIsolate: null, m_pUserFontPaths: null, m_v8EmbedderSlot: 0, m_pPlatform: null,
  });
  let buffer = 0;
  let document: PDFiumDocument | undefined;
  try {
    buffer = malloc(size);
    if (!buffer) throw new Error('PDF buffer allocation failed');
    const reader = input.getReader();
    let offset = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        if (offset + chunk.value.length > size) throw new Error('PDF size changed');
        module.HEAPU8.set(chunk.value, buffer + offset);
        offset += chunk.value.length;
      }
      if (offset !== size) throw new Error('PDF input ended early');
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    const handle = module._FPDF_LoadMemDocument(buffer, size, 0);
    if (!handle) throw new Error('PDFium could not open the PDF');
    document = new PDFiumDocument({ module, documentIdx: handle, documentPtr: buffer });
    buffer = 0; // Ownership moved to PDFiumDocument.

    function preview(page: number, maxSize = 260) {
      const sourcePage = document!.getPage(page - 1);
      const { originalWidth, originalHeight } = sourcePage.getOriginalSize();
      return sourcePage.render({ scale: Math.min(3, maxSize / Math.max(originalWidth, originalHeight)) });
    }
    function text(page: number) {
      const sourcePage = document!.getPage(page - 1);
      try {
        return sourcePage.getText();
      } finally {
        module._FPDF_ClosePage((sourcePage as unknown as { pageIdx: number }).pageIdx);
      }
    }
    function copy(pages: number[]) {
      if (!table || !pages.length) throw new Error('PDF output has no pages');
      const output = module._FPDF_CreateNewDocument();
      if (!output) throw new Error('Could not create PDF output');
      let indices = 0;
      let descriptor = 0;
      try {
        indices = malloc(pages.length * 4);
        descriptor = malloc(8);
        if (!indices || !descriptor) throw new Error('PDF output allocation failed');
        module.HEAP32.set(pages.map(page => page - 1), indices / 4);
        if (!module._FPDF_ImportPagesByIndex(output, handle, indices, pages.length, 0)) {
          throw new Error('PDFium could not copy pages');
        }
        // PDFium hands out small blocks. Coalesce them to avoid thousands of
        // retained allocations when exporting long batches.
        const blocks: Uint8Array<ArrayBuffer>[] = [];
        let block = new Uint8Array(256 * 1024);
        let position = 0;
        let length = 0;
        const callback = new WebAssembly.Instance(writer, {
          env: { write: (_self: number, pointer: number, count: number) => {
            let source = pointer;
            let remaining = count;
            while (remaining > 0) {
              const bytes = Math.min(remaining, block.length - position);
              block.set(module.HEAPU8.subarray(source, source + bytes), position);
              position += bytes;
              source += bytes;
              remaining -= bytes;
              if (position === block.length) {
                blocks.push(block);
                block = new Uint8Array(256 * 1024);
                position = 0;
              }
            }
            length += count;
            return 1;
          } },
        }).exports.write;
        const slot = writerSlot ??= table.grow(1);
        table.set(slot, callback);
        try {
          module.HEAP32.set([1, slot], descriptor / 4);
          // FPDF_NO_INCREMENTAL. The copy has no incremental source revision.
          if (!module._FPDF_SaveAsCopy(output, descriptor, 2)) throw new Error('PDFium could not save pages');
        } finally {
          table.set(slot, null);
        }
        if (position) blocks.push(block.subarray(0, position));
        let next = 0;
        return {
          size: length,
          stream: new ReadableStream<Uint8Array>({
            pull(controller) {
              if (next === blocks.length) controller.close();
              else controller.enqueue(blocks[next++]);
            },
          }),
        };
      } finally {
        if (indices) free(indices);
        if (descriptor) free(descriptor);
        module._FPDF_CloseDocument(output);
      }
    }
    return await use({ count: document.getPageCount(), text, preview, copy });
  } finally {
    if (document) document.destroy();
    if (buffer) free(buffer);
    module._FPDF_DestroyLibrary();
  }
}
