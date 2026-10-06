import { env } from 'cloudflare:workers';
import { getIdentity } from './auth-context';
import { DEFAULT_COLUMNS, analyzePages, type PageRecord, type Brand, type User, type FileCard } from './domain';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const now = () => new Date().toISOString();
export const uid = () => crypto.randomUUID();
export function db(): D1Database { if(!env.DB) throw new HttpError(503,'قاعدة البيانات غير متاحة الآن. حاول مرة أخرى.'); return env.DB; }
export function bucket(): R2Bucket { if(!env.BUCKET) throw new HttpError(503,'تخزين الملفات غير متاح الآن. حاول مرة أخرى.'); return env.BUCKET; }
export function sql(query: string, ...args: unknown[]) { return db().prepare(query).bind(...args); }
export async function rows<T>(query: string, ...args: unknown[]) { return (await sql(query,...args).all<T>()).results; }
export async function one<T>(query: string, ...args: unknown[]) { return await sql(query,...args).first<T>(); }
export const addDays = (start: string, days: number) => new Date(new Date(start).getTime()+days*86400000).toISOString();
export function auditStatement(user: User, action:string, detail:unknown, brandId:string|null=null,fileId:string|null=null) {
  return sql('INSERT INTO audit (id,brand_id,file_id,action,actor_id,actor_name,detail,created_at) VALUES (?,?,?,?,?,?,?,?)',uid(),brandId,fileId,action,user.id,user.name,JSON.stringify(detail),now());
}
export async function currentUser(): Promise<User> {
  const identity = getIdentity();
  if(!identity) throw new HttpError(401,'سجل الدخول للمتابعة.');
  const email=identity.email.toLowerCase().trim();
  // Verified email links existing records without changing IDs referenced by audit history.
  let user=await one<User>('SELECT * FROM users WHERE email=?',email);
  const adminEmail=import.meta.env.DEV?'admin@masar.test':env.INITIAL_ADMIN_EMAIL?.trim().toLowerCase();
  if(!user && adminEmail && email===adminEmail) {
    await sql("INSERT OR IGNORE INTO users (id,email,name,role,active,created_at) SELECT ?,?,?,'admin',1,? WHERE NOT EXISTS (SELECT 1 FROM users)",uid(),email,identity.name,now()).run();
    user=await one<User>('SELECT * FROM users WHERE email=?',email);
  }
  if(!user || !user.active) throw new HttpError(403,'حسابك غير مضاف إلى الفريق. اطلب من المدير إضافتك.');
  // Seed only the known brand; never seed customer files or invented operational activity.
  if(user.role==='admin') await sql('INSERT OR IGNORE INTO brands (id,name,color,identifiers,columns,retention_days,archive_days,index_days,created_at) VALUES (?,?,?,?,?,30,7,0,?)','wassan','وسن','#177e78',JSON.stringify(['Wasn Saudi','wasnbrand.com','وسن','اليقاظة']),JSON.stringify(DEFAULT_COLUMNS),now()).run();
  return user;
}
export function requireAdmin(user: User) { if(user.role!=='admin') throw new HttpError(403,'هذا الإجراء متاح للمدير فقط.'); }
export function checkOrigin(request: Request) {
  const origin=request.headers.get('origin');
  if(origin && origin!==new URL(request.url).origin) throw new HttpError(403,'مصدر الطلب غير مسموح.');
  if(request.headers.get('sec-fetch-site')==='cross-site') throw new HttpError(403,'مصدر الطلب غير مسموح.');
}
export async function getBrands(): Promise<Brand[]> {
  const data=await rows<Omit<Brand,'identifiers'|'columns'> & {identifiers:string;columns:string}>('SELECT * FROM brands ORDER BY created_at');
  return data.map(b=>({...b,identifiers:JSON.parse(b.identifiers),columns:JSON.parse(b.columns)}));
}
export const CARD_SELECT=`SELECT f.*,
  (SELECT CASE WHEN sum(o.quantity=1)=sum(o.quantity>=2) THEN count(*) ELSE min(sum(o.quantity=1),sum(o.quantity>=2)) END FROM occurrences o WHERE o.file_id=f.id AND o.page_role='label' AND o.quantity IS NOT NULL AND f.bucket='mixed') AS quantity_attention,
  (SELECT count(*) FROM findings i WHERE i.file_id=f.id AND i.status='open' AND (i.related_file_id IS NULL OR EXISTS (SELECT 1 FROM files related WHERE related.id=i.related_file_id AND related.expires_at>strftime('%Y-%m-%dT%H:%M:%fZ','now')))) AS open_issues,
  (SELECT count(*) FROM notes n WHERE n.brand_id=f.brand_id AND (n.file_id=f.id OR (n.ref IS NOT NULL AND EXISTS(SELECT 1 FROM occurrences o WHERE o.file_id=f.id AND o.ref=n.ref)))) AS note_count,
  (SELECT count(DISTINCT n.ref) FROM notes n WHERE n.brand_id=f.brand_id AND n.ref IS NOT NULL AND EXISTS(SELECT 1 FROM occurrences o WHERE o.file_id=f.id AND o.ref=n.ref)) AS attention_orders
  FROM files f`;
export function hydrateFile<T extends Omit<FileCard,'carriers'> & {carriers: string | string[]}>(f:T) { return {...f,carriers:typeof f.carriers==='string'?JSON.parse(f.carriers) as string[]:f.carriers}; }
export async function getFile(id: string) {
  await upgradeFileChecks(id);
  const file=await one<FileCard & {object_key:string;created_by:string}>(`${CARD_SELECT} WHERE f.id=? AND f.expires_at>?`,id,now());
  if(!file) throw new HttpError(404,'الملف غير موجود أو انتهت مدة الاحتفاظ به.');
  return hydrateFile(file);
}
// Upgrade existing cards using saved minimal evidence and filenames; never rewrite originals.
export async function upgradeFileChecks(id?:string) {
  const pending=await rows<{id:string;name:string;brand_id:string}>(`SELECT f.id,f.name,f.brand_id FROM files f WHERE f.status='ready' AND f.expires_at>? ${id?'AND f.id=?':''} AND NOT EXISTS (SELECT 1 FROM settings s WHERE s.key='checks_v2:' || f.id) LIMIT 20`,now(),...(id?[id]:[]));
  if(!pending.length)return;
  const brands=await getBrands();
  for(const f of pending){
    const pages=(await rows<{data:string}>('SELECT data FROM pages WHERE file_id=? ORDER BY page',f.id)).map(p=>JSON.parse(p.data) as PageRecord);
    const result=analyzePages(pages,f.brand_id,null,f.name,brands);
    const manualBrand=await one("SELECT id FROM findings WHERE file_id=? AND kind='brand_unknown' AND status<>'open' LIMIT 1",f.id);
    const checks=result.findings.filter(i=>['brand_unknown','brand_mismatch','bucket_mismatch'].includes(i.kind)&&!(i.kind==='brand_unknown'&&manualBrand));
    const entries=checks.map(i=>({...i,fingerprint:[f.id,i.kind,i.ref??'',i.page??'','',''].join('|')}));
    await db().batch([
      sql("DELETE FROM findings WHERE file_id=? AND status='open' AND kind IN ('brand_unknown','brand_mismatch','bucket_mismatch')",f.id),
      sql("INSERT OR IGNORE INTO findings (id,fingerprint,file_id,kind,ref,page,message,status,created_at) SELECT json_extract(value,'$.fingerprint'),json_extract(value,'$.fingerprint'),?,json_extract(value,'$.kind'),json_extract(value,'$.ref'),json_extract(value,'$.page'),json_extract(value,'$.message'),'open',? FROM json_each(?)",f.id,now(),JSON.stringify(entries)),
      sql('UPDATE files SET detected_brand_id=? WHERE id=?',result.detectedBrandId,f.id),
      sql("INSERT OR IGNORE INTO settings (key,value) VALUES (?, '1')",`checks_v2:${f.id}`),
    ]);
  }
}
export async function maintenance(force=false) {
  const timestamp=now();
  const next=await one<{value:string}>("SELECT value FROM settings WHERE key='maintenance_next'");
  if(!force && next && next.value>timestamp) return {expired:0,archived:0,running:false};
  await sql('INSERT OR IGNORE INTO settings (key,value) VALUES (\'maintenance_lease\',\'1970-01-01\')').run();
  const lease=await one<{value:string}>('UPDATE settings SET value=? WHERE key=\'maintenance_lease\' AND value<? RETURNING value',new Date(Date.now()+300000).toISOString(),timestamp);
  if(!lease) return {expired:0,archived:0,running:true};
  const expired=await rows<{id:string;object_key:string;brand_id:string;name:string;uploaded_at:string;stage:string;status:string;index_days:number}>('SELECT f.*, b.index_days FROM files f JOIN brands b ON b.id=f.brand_id WHERE f.expires_at<=? LIMIT 100',timestamp);
  let removed=0;
  for(const f of expired) {
    if(f.status!=='deleting' && f.index_days>0 && addDays(f.uploaded_at,f.index_days)>timestamp) await sql('INSERT OR IGNORE INTO order_index (id,brand_id,ref,file_name,page,uploaded_at,stage,expires_at) SELECT id,brand_id,ref,?,page,?,?,? FROM occurrences WHERE file_id=?',f.name,f.uploaded_at,f.stage,addDays(f.uploaded_at,f.index_days),f.id).run();
    await bucket().delete(f.object_key);
    await db().batch([sql('DELETE FROM notes WHERE file_id=?',f.id),sql('DELETE FROM audit WHERE file_id=?',f.id),sql('DELETE FROM findings WHERE related_file_id=?',f.id),sql('DELETE FROM files WHERE id=?',f.id)]);
    removed++;
  }
  await db().batch([sql('DELETE FROM order_index WHERE expires_at<=?',timestamp),sql("DELETE FROM settings WHERE key LIKE 'checks_v2:%' AND NOT EXISTS (SELECT 1 FROM files f WHERE 'checks_v2:' || f.id=settings.key)"),sql('DELETE FROM notes WHERE ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM occurrences o JOIN files f ON f.id=o.file_id WHERE o.ref=notes.ref AND o.brand_id=notes.brand_id AND f.expires_at>?)',timestamp),sql('DELETE FROM audit WHERE file_id IS NULL AND created_at<?',addDays(timestamp,-30))]);
  const candidates=await rows<{id:string;brand_id:string}>(`SELECT f.id,f.brand_id FROM files f JOIN brands b ON b.id=f.brand_id WHERE f.stage='shipped' AND f.shipped_at IS NOT NULL AND b.archive_days>0 AND julianday(?) - julianday(f.shipped_at)>=b.archive_days AND f.expires_at>? AND f.changed_version=f.ack_version AND NOT EXISTS (SELECT 1 FROM findings i WHERE i.file_id=f.id AND i.status='open')`,timestamp,timestamp);
  if(candidates.length) await db().batch(candidates.flatMap(f=>[sql("UPDATE files SET stage='archive' WHERE id=? AND stage='shipped'",f.id),auditStatement({id:'system',name:'النظام',email:'',role:'admin',active:1},'auto_archive',{},f.brand_id,f.id)]));
  await db().batch([sql("INSERT INTO settings (key,value) VALUES ('maintenance_next',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",new Date(Date.now()+(expired.length===100?0:3600000)).toISOString()),sql("UPDATE settings SET value='1970-01-01' WHERE key='maintenance_lease'")]);
  return {expired:removed,archived:candidates.length,running:false,more:expired.length===100};
}
