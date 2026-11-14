import { db, HttpError, now, one, rows, sql, uid } from './server';
import { originalPdf, pdfResponse, readPrivatePdf } from './private-pdf';
import type { User } from './domain';
import type { BulkShipment, BulkShipmentMatch, PrintPage, PrintPlan } from './printing-types';
import type { getFile } from './server';

type File = Awaited<ReturnType<typeof getFile>>;

// Use the same page selection for display, PDF output, and the atomic issuance
// check. A changed tracking number stays held until explicitly reviewed.
const PAGE_STATE = `
  SELECT p.page,
    CASE WHEN json_array_length(p.data,'$.refs')=1 THEN json_extract(p.data,'$.refs[0]') END AS ref,
    json_extract(p.data,'$.tracking') AS tracking,
    json_extract(p.data,'$.carrier') AS carrier,
    json_extract(p.data,'$.role') AS role,
    EXISTS(SELECT 1 FROM file_page_exclusions x WHERE x.file_id=p.file_id AND x.page=p.page) AS excluded,
    (SELECT json_object(
      'state',CASE WHEN s.tracking=coalesce(o.tracking,'') THEN s.state ELSE 'tracking_review' END,
      'actor',s.actor_name,'actorId',s.actor_id,'at',s.changed_at)
      FROM occurrences o JOIN shipment_print_controls s ON s.brand_id=o.brand_id AND s.ref=o.ref
      WHERE o.file_id=p.file_id AND o.page=p.page AND s.expires_at>? AND s.state<>'cleared'
      AND (s.tracking=coalesce(o.tracking,'') OR NOT EXISTS (
        SELECT 1 FROM shipment_print_controls c WHERE c.brand_id=o.brand_id AND c.ref=o.ref
        AND c.tracking=coalesce(o.tracking,'') AND c.state='cleared' AND c.expires_at>s.changed_at AND c.expires_at>?
      ))
      ORDER BY (s.tracking=coalesce(o.tracking,'')) DESC, (s.state='shipped') DESC, s.changed_at DESC LIMIT 1
    ) AS hold
  FROM pages p WHERE p.file_id=?`;

const MATCH_BATCH = `
  NOT EXISTS(SELECT page FROM eligible EXCEPT SELECT value FROM json_each(?))
  AND NOT EXISTS(SELECT value FROM json_each(?) EXCEPT SELECT page FROM eligible)`;

const FILE_CURRENT = "id=? AND brand_id=? AND status='ready' AND processed_at IS ? AND expires_at>?";
const fileVersion = (file: File, time: string) => [file.id, file.brand_id, file.processed_at, time];

// Choose a verified source for each Ref, and detect conflicting labels even in
// retained copies with unresolved brand findings. Only complete labels qualify.
const BULK_MATCHES = `
  WITH input(brand_id, at, orders) AS (VALUES (?,?,?)),
  wanted AS (
    SELECT json_extract(value,'$.ref') AS ref, json_extract(value,'$.tracking') AS expected
    FROM input, json_each(orders)
  ),
  labels AS (
    SELECT o.ref, coalesce(o.tracking,'') AS tracking, f.id AS file_id,
      NOT EXISTS(SELECT 1 FROM findings i WHERE i.file_id=f.id
        AND i.status='open' AND i.kind IN ('brand_unknown','brand_mismatch')) AS verified,
      f.expires_at
    FROM input JOIN wanted w
    JOIN occurrences o ON o.brand_id=input.brand_id AND o.ref=w.ref AND o.page_role='label'
    JOIN files f ON f.id=o.file_id AND f.brand_id=o.brand_id AND f.status='ready' AND f.expires_at>input.at
    JOIN pages p ON p.file_id=o.file_id AND p.page=o.page AND json_array_length(p.data,'$.refs')=1
  ),
  ranked AS (
    SELECT *, row_number() OVER (PARTITION BY ref ORDER BY verified DESC, expires_at DESC, file_id) AS priority
    FROM labels
  ),
  matches AS (
    SELECT w.ref, w.expected, l.tracking, l.file_id,
      CASE
        WHEN l.ref IS NULL THEN 'unavailable'
        WHEN NOT l.verified THEN 'brand_review'
        WHEN EXISTS(SELECT 1 FROM occurrences o
          JOIN files f ON f.id=o.file_id AND f.brand_id=o.brand_id AND f.status='ready' AND f.expires_at>input.at
          JOIN pages p ON p.file_id=o.file_id AND p.page=o.page
          WHERE o.brand_id=input.brand_id AND o.ref=w.ref AND json_array_length(p.data,'$.refs')>1)
          THEN 'page_review'
        WHEN EXISTS(SELECT 1 FROM labels other WHERE other.ref=w.ref AND other.tracking<>l.tracking)
          THEN 'tracking_review'
        WHEN s.state='shipped' THEN 'shipped'
        WHEN s.state='reserved' THEN 'reserved'
        WHEN EXISTS(SELECT 1 FROM shipment_print_controls other
          WHERE other.brand_id=input.brand_id AND other.ref=w.ref AND other.tracking<>l.tracking
          AND other.state<>'cleared' AND other.expires_at>input.at)
          THEN 'tracking_review'
        ELSE 'eligible'
      END AS state
    FROM input JOIN wanted w LEFT JOIN ranked l ON l.ref=w.ref AND l.priority=1
    LEFT JOIN shipment_print_controls s ON s.brand_id=input.brand_id AND s.ref=w.ref
      AND s.tracking=l.tracking AND s.expires_at>input.at
  )`;

export function bulkShipmentMatches(brandId: string, refs: string[]) {
  return rows<BulkShipmentMatch>(`${BULK_MATCHES} SELECT ref,tracking,state FROM matches`,
    brandId, now(), JSON.stringify(refs.map(ref => ({ref}))));
}

export async function shipOrdersTogether(brandId: string, orders: BulkShipment[], user: User) {
  const time = now();
  const entries = JSON.stringify(orders);
  const operation = uid();
  // Audit entries record the validated selection for the other statements in
  // the same D1 transaction. A stale selection inserts no entries or holds.
  const audited = `SELECT a.file_id AS file_id, value AS ref FROM audit a, json_each(a.detail,'$.refs')
    WHERE a.id >= ? AND a.id < ? AND a.action='bulk_shipped'`;
  const auditRange = [`${operation}:`, `${operation};`];
  const [logged, shipped] = await db().batch([
    sql(`${BULK_MATCHES}
      INSERT INTO audit (id,brand_id,file_id,action,actor_id,actor_name,detail,created_at)
      SELECT ? || ':' || m.file_id,input.brand_id,m.file_id,'bulk_shipped',?,?,
        json_object('count',count(*),'refs',json_group_array(m.ref)),input.at
      FROM matches m, input WHERE m.state='eligible'
        AND NOT EXISTS(SELECT 1 FROM matches WHERE state NOT IN ('eligible','shipped') OR tracking IS NOT expected)
      GROUP BY m.file_id`,brandId,time,entries,operation,user.id,user.name),
    sql(`WITH selected AS (${audited})
      INSERT INTO shipment_print_controls
        (brand_id,ref,tracking,state,source_file_id,actor_id,actor_name,changed_at,expires_at)
      SELECT f.brand_id,s.ref,json_extract(order_entry.value,'$.tracking'),'shipped',f.id,?,?,?,f.expires_at
      FROM selected s JOIN files f ON f.id=s.file_id
      JOIN json_each(?) order_entry ON json_extract(order_entry.value,'$.ref')=s.ref
      WHERE true
      ON CONFLICT(brand_id,ref,tracking) DO UPDATE SET state=excluded.state,
        source_file_id=excluded.source_file_id,actor_id=excluded.actor_id,actor_name=excluded.actor_name,
        changed_at=excluded.changed_at,expires_at=excluded.expires_at`,...auditRange,user.id,user.name,time,entries),
    sql(`WITH selected AS (${audited})
      UPDATE files SET changed_version=changed_version+1 WHERE brand_id=? AND expires_at>? AND printed_at IS NOT NULL
      AND EXISTS(SELECT 1 FROM occurrences o JOIN selected s ON s.ref=o.ref WHERE o.file_id=files.id)`,
      ...auditRange,brandId,time),
  ]);
  if (!logged.meta.changes) {
    const current = await bulkShipmentMatches(brandId, orders.map(order => order.ref));
    const shippedTracks = new Map(current.filter(match => match.state === 'shipped').map(match => [match.ref,match.tracking]));
    if (orders.every(order => shippedTracks.get(order.ref) === order.tracking)) return {shipped:0};
    throw new HttpError(409,'تغيّرت حالة طلب من القائمة. أعد فحص القائمة وراجع النتائج قبل المحاولة مرة أخرى.');
  }
  return {shipped:shipped.meta.changes};
}

function auditChange(user: User, action: string, detail: unknown, file: File) {
  return sql(`INSERT INTO audit (id,brand_id,file_id,action,actor_id,actor_name,detail,created_at)
    SELECT ?,?,?,?,?,?,?,? WHERE changes()>0`,
  uid(), file.brand_id, file.id, action, user.id, user.name, JSON.stringify(detail), now());
}

async function getPageStates(file: File, time: string) {
  return rows<Omit<PrintPage, 'excluded' | 'shipment'> & { excluded: number; hold: string | null }>(
    PAGE_STATE + ' ORDER BY p.page', time, time, file.id);
}

export async function getPrintPlan(file: File, user: User): Promise<PrintPlan> {
  const [pages, batch] = await Promise.all([
    getPageStates(file, now()),
    one<{ id: string; pages: string }>('SELECT id,pages FROM file_print_batches WHERE file_id=?', file.id),
  ]);
  const printable = pages.filter(p => !p.excluded && !p.hold).map(p => p.page);
  return {
    pages: pages.map(({ hold, excluded, ...page }) => {
      const shipment = hold ? JSON.parse(hold) as NonNullable<PrintPage['shipment']> & { actorId: string } : null;
      return { ...page, excluded: !!excluded, shipment: shipment && {
        state: shipment.state, actor: shipment.actor, at: shipment.at,
        canOpen: shipment.state === 'reserved' && shipment.actorId === user.id,
        canRelease: shipment.state === 'reserved' && (shipment.actorId === user.id || user.role === 'admin'),
      } };
    }),
    printable: printable.length,
    canExportOriginal: user.role === 'admin',
    batch: batch && { id: batch.id, current: batch.pages===JSON.stringify(printable) },
  };
}

function ready(file: File) {
  if (file.status !== 'ready') throw new HttpError(409, 'انتظر اكتمال قراءة صفحات الملف.');
}

async function renderPages(file: File, pages: number[]) {
  return readPrivatePdf(file.object_key, document => {
    if (document.count !== file.page_count) throw new HttpError(409, 'تغيّر عدد صفحات الملف. أعد الفحص ثم حاول مرة أخرى.');
    return document.copy(pages);
  });
}

export async function previewPage(file: File, page: number) {
  ready(file);
  const [selected] = await rows<{excluded:number;hold:string|null}>(
    `SELECT excluded,hold FROM (${PAGE_STATE}) WHERE page=?`,now(),now(),file.id,page);
  if (!selected || selected.excluded || selected.hold) {
    throw new HttpError(409,'هذه الصفحة خارج نسخة الطباعة.');
  }
  return readPrivatePdf(file.object_key,document=>document.preview(page));
}

export async function issueBatch(file: File, user: User, inline: boolean) {
  ready(file);
  const pages = (await getPageStates(file, now())).filter(page => !page.excluded && !page.hold).map(page => page.page);
  if (!pages.length) throw new HttpError(409, 'لا توجد صفحات متبقية للطباعة في هذا الملف.');
  const output = pages.length === file.page_count
    ? await originalPdf(file.object_key).then(object => ({ stream: object.body, size: object.size }))
    : await renderPages(file, pages);
  const time = now();
  const selected = JSON.stringify(pages);
  const batch = uid();
  // The PDF is prepared first. The final database write recomputes eligibility
  // inside the same transaction that records the copy, before any bytes are sent.
  let issued: D1Result;
  try {
    [issued] = await db().batch([
      sql(`WITH page_state AS (${PAGE_STATE}),
        eligible AS (SELECT page FROM page_state WHERE excluded=0 AND hold IS NULL)
        INSERT INTO file_print_batches (file_id,id,pages,issued_at)
        SELECT id,?,?,? FROM files WHERE ${FILE_CURRENT} AND ${MATCH_BATCH}
        ON CONFLICT(file_id) DO UPDATE SET id=excluded.id,pages=excluded.pages,issued_at=excluded.issued_at`,
        time, time, file.id, batch, selected, time, ...fileVersion(file,time), selected, selected),
      auditChange(user, 'batch_issued', { pages: pages.length, skipped: file.page_count-pages.length }, file),
      sql(`INSERT INTO batch_print_refs (file_id,brand_id,ref,expires_at,version)
        SELECT b.file_id,o.brand_id,o.ref,f.expires_at,b.issued_at || ':' || b.id FROM file_print_batches b
        JOIN files f ON f.id=b.file_id JOIN occurrences o ON o.file_id=b.file_id
        WHERE b.file_id=? AND b.id=? AND o.page IN (SELECT value FROM json_each(b.pages))
        ON CONFLICT(file_id,brand_id,ref) DO UPDATE SET version=excluded.version,expires_at=excluded.expires_at`,file.id,batch),
    ]);
  } catch (error) {
    await output.stream.cancel().catch(() => {});
    throw error;
  }
  if (!issued.meta.changes) {
    await output.stream.cancel().catch(() => {});
    throw new HttpError(409, 'تغيّرت الصفحات المتاحة أثناء تجهيز النسخة. حدّث الملف وحاول مرة أخرى.');
  }
  return pdfResponse(output.stream,output.size,`${file.name.replace(/\.pdf$/i,'')} - للطباعة.pdf`,inline);
}

export async function confirmBatch(file: File, user: User, batchId: string) {
  ready(file);
  const time = now();
  const [confirmed] = await db().batch([
    sql(`WITH page_state AS (${PAGE_STATE}),
      eligible AS (SELECT page FROM page_state WHERE excluded=0 AND hold IS NULL)
      UPDATE files SET stage='printed',printed_at=?,shipped_at=NULL
      WHERE ${FILE_CURRENT}
      AND EXISTS(SELECT 1 FROM file_print_batches b WHERE b.file_id=files.id AND b.id=?
        AND NOT EXISTS(SELECT page FROM eligible EXCEPT SELECT value FROM json_each(b.pages))
        AND NOT EXISTS(SELECT value FROM json_each(b.pages) EXCEPT SELECT page FROM eligible))
      AND NOT EXISTS(SELECT 1 FROM findings i WHERE i.file_id=files.id AND i.status='open'
        AND (i.related_file_id IS NULL OR EXISTS(SELECT 1 FROM files related WHERE related.id=i.related_file_id AND related.expires_at>?)))`,
      time,time,file.id,time,...fileVersion(file,time),batchId,time),
    auditChange(user,'printed',{},file),
  ]);
  if (!confirmed.meta.changes) throw new HttpError(409,'راجع التنبيهات وافتح نسخة الطباعة الحالية قبل التأكيد.');
}

export async function changePageExclusion(file: File, user: User, page: number, exclude: boolean) {
  ready(file);
  const time = now();
  const [changed] = await db().batch([
    exclude
      ? sql(`INSERT OR IGNORE INTO file_page_exclusions (file_id,page)
        SELECT id,? FROM files WHERE ${FILE_CURRENT} AND EXISTS(SELECT 1 FROM pages p WHERE p.file_id=files.id AND p.page=?)`,
        page,...fileVersion(file,time),page)
      : sql(`DELETE FROM file_page_exclusions WHERE file_id=? AND page=?
        AND EXISTS(SELECT 1 FROM files WHERE ${FILE_CURRENT})`,file.id,page,...fileVersion(file,time)),
    auditChange(user,exclude?'page_excluded':'page_restored',{page},file),
    sql('UPDATE files SET changed_version=changed_version+1 WHERE id=? AND printed_at IS NOT NULL AND changes()>0',file.id),
  ]);
  if (!changed.meta.changes) throw new HttpError(409,'تغيّرت حالة الصفحة. حدّث الملف ثم حاول مرة أخرى.');
}

type Label = { page: number; ref: string; tracking: string; carrier: string };

async function selectLabel(file: File, page: number): Promise<Label> {
  ready(file);
  const label = await one<Label>(`SELECT label.page,label.ref,coalesce(label.tracking,'') AS tracking,label.carrier
    FROM pages p JOIN occurrences selected ON selected.file_id=p.file_id AND selected.page=p.page
    JOIN occurrences label ON label.file_id=p.file_id AND label.ref=selected.ref AND label.carrier=selected.carrier
      AND label.tracking IS selected.tracking AND label.page_role='label'
    JOIN pages lp ON lp.file_id=label.file_id AND lp.page=label.page
    WHERE p.file_id=? AND p.page=? AND json_array_length(p.data,'$.refs')=1
      AND json_array_length(lp.data,'$.refs')=1
      AND (selected.page_role='support' OR label.page=selected.page)
    ORDER BY label.page LIMIT 1`,file.id,page);
  if (!label) throw new HttpError(409,'اختر صفحة بوليصة مرتبطة بطلب واضح أولًا.');
  return label;
}

async function labelPages(file: File, label: Label) {
  const support = await rows<{page: number}>(`SELECT DISTINCT page FROM occurrences
    WHERE file_id=? AND ref=? AND carrier=? AND coalesce(tracking,'')=? AND page_role='support' ORDER BY page`,
    file.id,label.ref,label.carrier,label.tracking);
  return [label.page,...support.map(p=>p.page)].sort((a,b)=>a-b);
}

const PRIOR_COPY = `
  SELECT max(version) FROM (
    SELECT version FROM batch_print_refs WHERE brand_id=? AND ref=? AND expires_at>?
    UNION ALL
    SELECT a.created_at || ':' || a.id FROM occurrences o JOIN files f ON f.id=o.file_id
      JOIN audit a ON a.file_id=f.id
      WHERE o.brand_id=? AND o.ref=? AND f.expires_at>? AND a.action IN ('downloaded','original_exported')
    UNION ALL
    SELECT f.printed_at || ':' || f.id FROM occurrences o JOIN files f ON f.id=o.file_id
      WHERE o.brand_id=? AND o.ref=? AND f.expires_at>? AND f.printed_at IS NOT NULL
      AND NOT EXISTS(SELECT 1 FROM file_print_batches b WHERE b.file_id=f.id)
  )`;

export async function shipmentAction(file: File, user: User, input: {
  page: number; action: 'reserve'|'ship'|'release'|'clear_tracking'; priorCopy?: string; expectedAt?: string;
}) {
  const label = await selectLabel(file,input.page);
  if (input.action==='clear_tracking' && !label.tracking) {
    throw new HttpError(409,'رقم التتبع غير متاح. تحقق من البوليصة مع الفريق قبل السماح بطباعتها.');
  }
  const time = now();
  const key = [file.brand_id,label.ref,label.tracking];
  const current = await one<{state:string;actor_id:string}>(`SELECT state,actor_id FROM shipment_print_controls
    WHERE brand_id=? AND ref=? AND tracking=? AND expires_at>?`,...key,time);
  if (input.action === 'release') {
    const [released] = await db().batch([
      sql(`DELETE FROM shipment_print_controls WHERE brand_id=? AND ref=? AND tracking=? AND state='reserved'
        AND expires_at>? AND changed_at=? AND (actor_id=? OR ?='admin') AND EXISTS(SELECT 1 FROM files WHERE ${FILE_CURRENT})`,
        ...key,time,input.expectedAt??'',user.id,user.role,...fileVersion(file,time)),
      auditChange(user,'early_released',{ref:label.ref,page:label.page},file),
    ]);
    if (!released.meta.changes) throw new HttpError(409,'لا يمكن إرجاع هذه البوليصة. راجع حالتها مع من بدأ الشحن.');
    return { ok: true };
  }

  const state = input.action === 'clear_tracking' ? 'cleared' : input.action === 'ship' ? 'shipped' : 'reserved';
  const prior = [file.brand_id,label.ref,time,file.brand_id,label.ref,time,file.brand_id,label.ref,time];
  const priorVersion = () => one<{ version: string | null }>(`SELECT (${PRIOR_COPY}) AS version`,...prior);
  if (state === 'reserved') {
    const previous = (await priorVersion())?.version ?? null;
    if (previous && previous !== input.priorCopy) return { reconcile: previous };
  }

  const [changed] = await db().batch([
    sql(`INSERT INTO shipment_print_controls
      (brand_id,ref,tracking,state,source_file_id,actor_id,actor_name,changed_at,expires_at)
      SELECT brand_id,?,?,?,?,?,?,?,expires_at FROM files WHERE ${FILE_CURRENT}
      AND NOT EXISTS(SELECT 1 FROM findings WHERE file_id=files.id AND status='open' AND kind IN ('brand_unknown','brand_mismatch'))
      AND (?<>'reserved' OR NOT EXISTS(SELECT 1 FROM file_page_exclusions x WHERE x.file_id=files.id AND x.page=?))
      AND (
        (?='cleared' AND EXISTS(SELECT 1 FROM shipment_print_controls s WHERE s.brand_id=files.brand_id AND s.ref=? AND s.tracking<>? AND s.state<>'cleared' AND s.expires_at>?))
        OR (?<>'cleared' AND (
          NOT EXISTS(SELECT 1 FROM shipment_print_controls s WHERE s.brand_id=files.brand_id AND s.ref=? AND s.tracking<>? AND s.state<>'cleared' AND s.expires_at>?)
          OR EXISTS(SELECT 1 FROM shipment_print_controls c WHERE c.brand_id=files.brand_id AND c.ref=? AND c.tracking=? AND c.state IN ('cleared','reserved') AND c.expires_at>?)
        ))
      )
      AND (?<>'reserved' OR (${PRIOR_COPY}) IS ?)
      ON CONFLICT(brand_id,ref,tracking) DO UPDATE SET state=excluded.state,
        source_file_id=excluded.source_file_id,actor_id=excluded.actor_id,actor_name=excluded.actor_name,
        changed_at=excluded.changed_at,expires_at=excluded.expires_at
      WHERE shipment_print_controls.expires_at<=?
        OR (shipment_print_controls.state='cleared' AND excluded.state<>'cleared')
        OR (shipment_print_controls.state='reserved' AND excluded.state='shipped' AND shipment_print_controls.changed_at=?)`,
      label.ref,label.tracking,state,file.id,user.id,user.name,time,...fileVersion(file,time),
      state,label.page,state,label.ref,label.tracking,time,state,label.ref,label.tracking,time,label.ref,label.tracking,time,
      state,...prior,input.priorCopy??null,time,input.expectedAt??''),
    auditChange(user, state==='shipped'?'early_shipped':state==='reserved'?'early_reserved':'tracking_cleared',
      {ref:label.ref,page:label.page,priorCopy:!!input.priorCopy},file),
    sql(`UPDATE files SET changed_version=changed_version+1 WHERE printed_at IS NOT NULL
      AND brand_id=? AND expires_at>? AND changes()>0
      AND EXISTS(SELECT 1 FROM occurrences o WHERE o.file_id=files.id AND o.ref=?)`,file.brand_id,time,label.ref),
  ]);
  if (!changed.meta.changes) {
    if (state === 'reserved') {
      const previous = (await priorVersion())?.version ?? null;
      if (previous && previous !== input.priorCopy) return {reconcile:previous};
    }
    if (state === 'shipped' && current?.state === 'shipped') return {ok:true};
    throw new HttpError(409,'تغيّرت حالة البوليصة أو تحتاج إلى مراجعة العلامة أو رقم التتبع. حدّث الملف وحاول مرة أخرى.');
  }
  return {ok:true};
}

export async function issueEarlyLabel(file: File, user: User, page: number) {
  const label = await selectLabel(file,page);
  const reservation = `SELECT 1 FROM shipment_print_controls s JOIN files f ON f.brand_id=s.brand_id
    WHERE f.id=? AND f.status='ready' AND f.processed_at IS ? AND f.expires_at>? AND s.ref=? AND s.tracking=?
    AND s.state='reserved' AND s.actor_id=? AND s.expires_at>?`;
  const reservationArgs = () => [file.id,file.processed_at,now(),label.ref,label.tracking,user.id,now()];
  if (!await one(reservation,...reservationArgs())) {
    throw new HttpError(409,'فتح البوليصة متاح لمن بدأ شحنها المنفصل قبل تأكيد الشحن.');
  }
  const output = await renderPages(file,await labelPages(file,label));
  let issued: D1Result;
  try {
    issued = await sql(`INSERT INTO audit (id,brand_id,file_id,action,actor_id,actor_name,detail,created_at)
      SELECT ?,?,?,'early_label_issued',?,?,?,? WHERE EXISTS(${reservation})`,
      uid(),file.brand_id,file.id,user.id,user.name,JSON.stringify({ref:label.ref,page:label.page}),now(),...reservationArgs()).run();
  } catch (error) {
    await output.stream.cancel().catch(()=>{});
    throw error;
  }
  if (!issued.meta.changes) {
    await output.stream.cancel().catch(()=>{});
    throw new HttpError(409,'تغيّرت حالة الشحن. حدّث الملف وحاول مرة أخرى.');
  }
  return pdfResponse(output.stream,output.size,`waybill-${label.ref}.pdf`,true);
}
