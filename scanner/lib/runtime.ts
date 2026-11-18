export interface ScannerEnv {
  DB: D1Database;
  ASSETS: Fetcher;
  SCANNER_BRAND_ID: string;
  SCANNER_BRAND_NAME: string;
  SCANNER_BRANDS?: unknown;
  SCANNER_ACCESS_CODE?: string;
  SCANNER_DEMO?: string;
  SALLA_MERCHANT_ID?: string;
  SALLA_WEBHOOK_SECRET?: string;
  SALLA_CLIENT_ID?: string;
  SALLA_CLIENT_SECRET?: string;
  SALLA_TOKEN_KEY?: string;
}

export class ScannerError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export const seconds = () => Math.floor(Date.now() / 1000);
export const utf8 = new TextEncoder();
export const hex = (data: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(data), value => value.toString(16).padStart(2,'0')).join('');
export const digest = async (value: string) => hex(await crypto.subtle.digest('SHA-256', utf8.encode(value)));
export const randomToken = () => hex(crypto.getRandomValues(new Uint8Array(32)));
export const query = (env: ScannerEnv, statement: string, ...params: (string | number | null)[]) =>
  env.DB.prepare(statement).bind(...params);

export function localDemo(env: ScannerEnv, url: URL) {
  return env.SCANNER_DEMO === 'true' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
}

export async function readText(request: Request, limit: number) {
  const reader = request.body?.getReader();
  if (!reader) throw new ScannerError(400,'invalid_request','الطلب غير صالح.');
  const decoder = new TextDecoder('utf-8', {fatal:true});
  let length = 0;
  let result = '';
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return result + decoder.decode();
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new ScannerError(413,'request_too_large','الطلب أكبر من الحد المسموح.');
      }
      result += decoder.decode(value,{stream:true});
    }
  } finally {
    reader.releaseLock();
  }
}

export function parseJson(text: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(text);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string,unknown>;
  } catch { /* Return the same validation error for malformed or non-object bodies. */ }
  throw new ScannerError(400,'invalid_request','الطلب غير صالح.');
}

export function sameOrigin(request: Request, url: URL) {
  if (request.headers.get('origin') !== url.origin) {
    throw new ScannerError(403,'invalid_origin','افتح الماسح من رابط مسار.');
  }
}

export const json = (body: unknown, status = 200, headers?: HeadersInit) =>
  Response.json(body, {status, headers});
