export type Role = 'admin' | 'operator';
export type Stage = 'awaiting' | 'printed' | 'prepared' | 'shipped' | 'archive' | string;
export type Bucket = 'single' | 'multiple' | 'mixed' | 'unknown';
export type Column = { id: string; name: string; color: string };
export type Brand = { id: string; name: string; color: string; identifiers: string[]; columns: Column[]; retention_days: number; archive_days: number; index_days: number };
export type User = { id: string; email: string; name: string; role: Role; active: number };
export type PageRecord = { page: number; refs: string[]; tracking: string | null; quantity: number | null; carrier: 'Aymakan' | 'RedBox' | 'DHL' | 'Unknown'; sourceDate: string | null; dateType: 'order' | 'label' | 'carrier' | null; role: 'label' | 'support' | 'unknown'; brands: string[]; matches: string[] };
export type FindingInput = { kind: string; page: number | null; ref: string | null; message: string; relatedFileId?: string; relatedPage?: number };
export type Finding = FindingInput & { id: string; file_id: string; status: string; resolution_note: string | null; related_file_id: string | null; related_page: number | null; related_name?: string; related_uploaded_at?: string; created_at: string; resolved_at?: string };
export type FileCard = { id: string; brand_id: string; name: string; size: number; hash: string | null; status: string; stage: string; bucket: Bucket; detected_brand_id: string | null; page_count: number; waybill_count: number; carriers: string[]; uploaded_at: string; expires_at: string; printed_at: string | null; shipped_at: string | null; changed_version: number; ack_version: number; open_issues: number; note_count: number; attention_orders: number; reviewed_at: string | null };
export type Note = { id: string; ref: string | null; type: string; body: string; actor_name: string; created_at: string };
export type Audit = { id: string; action: string; actor_name: string; detail: string; created_at: string; file_id: string | null; file_name?: string };
export type Occurrence = { file_id: string; brand_id: string; page: number; ref: string; tracking: string | null; quantity: number | null; carrier: string; source_date: string | null; date_type: string | null; page_role: string; name?: string; stage?: string; uploaded_at?: string; brand_name?: string; historical?: boolean };
export type FileDetail = { file: FileCard; findings: Finding[]; notes: Note[]; orders: Occurrence[]; audit: Audit[] };
export const DEFAULT_COLUMNS: Column[] = [
  { id: 'awaiting', name: 'بانتظار الطباعة', color: '#397bca' },
  { id: 'printed', name: 'تمت الطباعة', color: '#8058b9' },
  { id: 'prepared', name: 'تم التجهيز', color: '#d28b16' },
  { id: 'shipped', name: 'تم الشحن', color: '#168876' },
  { id: 'archive', name: 'الأرشيف', color: '#778399' },
];
export const BUCKET_NAMES: Record<Bucket, string> = { single: 'حبة واحدة', multiple: 'حبتان أو أكثر', mixed: 'كميات مختلطة', unknown: 'غير محدد' };
export const RESOLUTION_NAMES: Record<string, string> = { confirmed_error: 'خطأ مؤكد', false_alarm: 'إنذار غير صحيح', voided: 'ملغي / غير مستخدم' };
export const NOTE_NAMES: Record<string, string> = { cancelled: 'إلغاء', changed: 'تعديل', other: 'ملاحظة' };
export const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function normalize(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/[\u064b-\u065f\u0670\u0640]/g, '').replace(/[إأآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/[^\p{L}\p{N}.]+/gu, ' ').trim().replace(/\s+/g, ' ');
}
export function normalizeRef(value: string): string {
  return value.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632)).replace(/[۰-۹]/g, c => String(c.charCodeAt(0) - 1776)).replace(/\s+/g, '').trim();
}
export function matchIdentifiers(text: string, brands: Pick<Brand, 'id' | 'identifiers'>[]) {
  const haystack = ` ${normalize(text)} `;
  const hits = brands.flatMap(brand => brand.identifiers.filter(term => {
    const key = normalize(term);
    if (key.length < 2) return false;
    return haystack.includes(` ${key} `) || (key.includes('.') && haystack.includes(key));
  }).map(term => ({ brandId: brand.id, term })));
  return { brands: [...new Set(hits.map(h => h.brandId))], matches: [...new Set(hits.map(h => h.term))] };
}
export function detectPage(raw: string, page: number, brands: Pick<Brand, 'id' | 'identifiers'>[]): PageRecord {
  const text = raw.replace(/[٠-٩]/g, c => String(c.charCodeAt(0) - 1632));
  const carrier = /redbox/i.test(text) ? 'RedBox' : /\bAY\d{8,}\b|8001111028/.test(text) ? 'Aymakan' : /DHL|EXPRESS WORLDWIDE/.test(text) ? 'DHL' : 'Unknown';
  const refs = [...new Set([...text.matchAll(/\bRef\s*\.?\s*(?:No\.?\s*[:#]?|[:#])\s*([0-9]+)/gi)].map(m => m[1]))];
  const quantityMatch = carrier === 'RedBox' ? /\bQuantity\s*:\s*(\d+)/i.exec(text) : carrier === 'Aymakan' ? /\bItems\s*:\s*(\d+)/i.exec(text) : null;
  const quantity = quantityMatch && Number(quantityMatch[1]) > 0 ? Number(quantityMatch[1]) : null;
  const trackingMatch = carrier === 'RedBox' ? /\bTrk\s*#\s*(\d+)/i.exec(text) : carrier === 'Aymakan' ? /\b(AY\d{8,})\b/.exec(text) : /\bWAYBILL[ \t]+([0-9][0-9 ]+)/.exec(text);
  const date = carrier === 'RedBox' ? /Order date:[ \t]*([^\r\n]+)/i.exec(text)?.[1] : carrier === 'Aymakan' ? /Date:[ \t]*(\d{2}\/\d{2}\/\d{4})/.exec(text)?.[1] : /\b(\d{4}-\d{2}-\d{2})\b/.exec(text)?.[1];
  // Limit brand recognition to sender/product areas: a recipient's name/address is not brand evidence.
  const sender = /\b(?:From|Shipper)(?:[ \t]*:|[ \t]*\r?\n)([\s\S]*?)(?:\b(?:To|Receiver)(?:[ \t]*:|[ \t]*\r?\n)|$)/i.exec(text)?.[1] ?? '';
  const description = /Description\s*:?\s*([^\r\n]+)/i.exec(text)?.[1] ?? '';
  const found = matchIdentifiers(`${sender}\n${description}`, brands);
  return { page, refs, tracking: trackingMatch?.[1].replace(/\s/g, '') ?? null, quantity, carrier, sourceDate: date?.trim().slice(0, 100) ?? null, dateType: date ? carrier === 'RedBox' ? 'order' : carrier === 'DHL' ? 'label' : 'carrier' : null, role: carrier === 'Unknown' ? 'unknown' : /\*WAYBILL DOC\*/.test(text) ? 'support' : 'label', ...found };
}
export function analyzePages(pages: PageRecord[], brandId: string, expectedBucket?: Bucket | null) {
  const findings: FindingInput[] = [];
  const labels = pages.filter(p => p.role === 'label');
  const quantities = labels.map(p => p.quantity);
  const known = quantities.filter((q): q is number => q !== null);
  const hasSingle = known.some(q => q === 1), hasMultiple = known.some(q => q >= 2);
  const bucket: Bucket = hasSingle && hasMultiple ? 'mixed' : quantities.length === 0 || known.length !== quantities.length ? 'unknown' : hasSingle ? 'single' : 'multiple';
  const brandIds = [...new Set(pages.flatMap(p => p.brands))];
  const detectedBrandId = brandIds.length === 1 ? brandIds[0] : null;
  for (const p of pages) {
    const ref = p.refs.length === 1 ? p.refs[0] : null;
    if (p.carrier === 'Unknown' || p.refs.length !== 1) findings.push({ kind: 'unreadable', page: p.page, ref, message: p.carrier === 'Unknown' ? 'تصميم شركة الشحن غير معروف؛ تحتاج الصفحة إلى مراجعة.' : p.refs.length === 0 ? 'لم يتم العثور على رقم الطلب.' : `تحتوي الصفحة على أكثر من رقم طلب: ${p.refs.join('، ')}` });
    if (!p.tracking) findings.push({ kind: 'tracking_unknown', page: p.page, ref, message: 'لم يتم العثور على رقم تتبع واضح.' });
    if (p.role === 'label' && p.quantity === null) findings.push({ kind: 'quantity_unknown', page: p.page, ref, message: 'عدد المنتجات غير موجود؛ عدد الطرود لا يحدد كمية الطلب.' });
    if (p.role === 'label' && p.brands.length === 0) findings.push({ kind: 'brand_unknown', page: p.page, ref, message: 'لم تُطابق الصفحة كلمات التعريف لأي علامة. أكد العلامة بعد المراجعة.' });
    if (p.brands.length > 1 || (p.brands.length === 1 && p.brands[0] !== brandId)) findings.push({ kind: 'brand_mismatch', page: p.page, ref, message: p.brands.length > 1 ? 'تطابق الصفحة أكثر من علامة؛ راجع كلمات التعريف.' : 'تطابق الصفحة علامة أخرى غير اللوحة الحالية.' });
    if (p.role === 'label' && p.quantity !== null && (bucket === 'mixed' || (expectedBucket === 'single' && p.quantity !== 1) || (expectedBucket === 'multiple' && p.quantity < 2))) findings.push({ kind: 'bucket_mismatch', page: p.page, ref, message: `كمية الطلب ${p.quantity}؛ الملف لا يطابق مجموعة كمية واحدة.` });
    if (p.role === 'support' && !labels.some(l => l.refs.length === 1 && l.refs[0] === ref && l.tracking === p.tracking && l.carrier === p.carrier)) findings.push({ kind: 'orphan_document', page: p.page, ref, message: 'مستند مرافق بدون ملصق شحن مطابق في هذا الملف.' });
  }
  const byRef = new Map<string, PageRecord[]>();
  for (const p of pages) for (const ref of p.refs) byRef.set(ref, [...(byRef.get(ref) ?? []), p]);
  for (const [ref, occurrences] of byRef) {
    const primary = occurrences.filter(p => p.role !== 'support');
    for (const p of primary.slice(1)) findings.push({ kind: 'duplicate_order', page: p.page, ref, relatedPage: primary[0].page, message: `يتكرر الطلب داخل الملف في الصفحتين ${primary[0].page} و${p.page}.` });
    const supports = occurrences.filter(p => p.role === 'support');
    for (const p of supports.slice(1)) findings.push({ kind: 'duplicate_document', page: p.page, ref, relatedPage: supports[0].page, message: 'يتكرر المستند المرافق لنفس الطلب داخل الملف.' });
  }
  return { bucket, detectedBrandId, mixedBrands: brandIds.length > 1, pageCount: pages.length, waybillCount: labels.length, carriers: [...new Set(pages.map(p => p.carrier))], findings };
}
export function parseRefList(text: string) {
  return [...new Set(text.split(/[\s,،;؛]+/).map(normalizeRef).filter(Boolean))];
}
