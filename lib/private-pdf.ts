import type { withPdf } from './pdf-engine';
import { bucket, HttpError } from './server';

export async function originalPdf(key: string) {
  const object = await bucket().get(key);
  if (!object) throw new HttpError(404, 'ملف PDF غير متاح.');
  return object;
}

export async function readPrivatePdf<T>(key: string, use: Parameters<typeof withPdf<T>>[4]) {
  const object = await originalPdf(key);
  try {
    // Opening the board and listing files do not need to load the PDF engine.
    const [{ withPdf: processPdf }, engine, writer] = await Promise.all([
      import('./pdf-engine'),
      import('../build/pdf-engine/pdfium.wasm'),
      import('../build/pdf-engine/writer.wasm'),
    ]);
    return await processPdf(engine.default, writer.default, object.body, object.size, use);
  } catch (error) {
    if (error instanceof HttpError) throw error;
    console.error('PDF processing failed', error instanceof Error ? error.message : 'Unknown error');
    throw new HttpError(422, 'تعذر تجهيز صفحات PDF. أعد المحاولة أو راجع الملف المرفوع.');
  }
}

export function pdfResponse(stream: ReadableStream<Uint8Array>, size: number, name: string, inline = false) {
  return new Response(stream, { headers: {
    'Content-Type': 'application/pdf',
    'Content-Length': String(size),
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="waybills.pdf"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': 'sandbox',
  } });
}
