// Text is transient in this worker. Only the caller's minimal parsed fields are sent to the API.
import { PDFiumLibrary } from '/pdf/pdfium.js';
let engine;
self.onmessage = async ({data}) => {
  let document;
  try {
    engine ??= await PDFiumLibrary.init({wasmUrl:'/pdf/pdfium.wasm'});
    document = await engine.loadDocument(new Uint8Array(data.bytes));
    const total = document.getPageCount();
    if (!total || total > 10000) throw new Error('عدد الصفحات غير مدعوم (الحد الأقصى ١٠٬٠٠٠ صفحة).');
    for (let index=0;index<total;index++) {
      let page,text='';
      try { page=document.getPage(index); text=page.getText(); }
      catch { /* Preserve an unreadable page instead of silently skipping it. */ }
      finally {
        // Pinned PDFium wrapper 2.1.13 has no public text-page disposal method.
        // Release the native page handle after text extraction to bound memory.
        if(page)page.module._FPDF_ClosePage(page.pageIdx);
      }
      self.postMessage({kind:'page',page:index+1,total,text});
    }
    self.postMessage({kind:'done',total});
  } catch(error) { self.postMessage({kind:'error',message:error instanceof Error ? error.message : 'تعذر قراءة الملف.'}); }
  finally { document?.destroy(); }
};
