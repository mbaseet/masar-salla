import { createHash, timingSafeEqual } from 'node:crypto';
import { env } from 'cloudflare:workers';
import { z } from 'zod';
import { analyzePages, DEFAULT_COLUMNS, MAX_FILE_BYTES, normalize, normalizeRef, parseRefList, type Brand, type PageRecord, type User, type FindingInput } from '@/lib/domain';
import { currentUser,requireAdmin,checkOrigin,db,bucket,sql,rows,one,now,uid,addDays,getBrands,getFile,CARD_SELECT,hydrateFile,auditStatement,maintenance,upgradeFileChecks,HttpError } from '@/lib/server';

export const dynamic='force-dynamic';
const pageSchema=z.object({page:z.number().int().min(1).max(10000),refs:z.array(z.string().regex(/^\d{1,40}$/)).max(20),tracking:z.string().max(100).nullable(),quantity:z.number().int().min(1).max(100000).nullable(),carrier:z.enum(['Aymakan','RedBox','DHL','Unknown']),sourceDate:z.string().max(100).nullable(),dateType:z.enum(['order','carrier','label']).nullable(),role:z.enum(['label','support','unknown']),brands:z.array(z.string().max(100)).max(20),matches:z.array(z.string().max(150)).max(50)});
const brandSchema=z.object({name:z.string().trim().min(1).max(80),color:z.string().regex(/^#[0-9a-f]{6}$/i),identifiers:z.array(z.string().trim().min(2).max(150)).max(100),columns:z.array(z.object({id:z.string().regex(/^[a-z0-9_-]{1,50}$/),name:z.string().trim().min(1).max(60),color:z.string().regex(/^#[0-9a-f]{6}$/i)})).min(5).max(15),retention_days:z.number().int().min(1).max(90),archive_days:z.number().int().min(0).max(90),index_days:z.union([z.literal(0),z.literal(90)])});
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
async function body(request:Request) { if(Number(request.headers.get('content-length')??0)>8*1024*1024) throw new HttpError(413,'الطلب أكبر من الحد المسموح.'); return request.json(); }
async function processFile(id:string,pages:PageRecord[],user:User,expectedBucket?:'single'|'multiple'|null) {
  const file=await getFile(id);
  if(!file.hash) throw new HttpError(409,'انتظر اكتمال رفع الملف أولًا.');
  if(pages.some((p,i)=>p.page!==i+1)) throw new HttpError(400,'يجب فحص جميع الصفحات بترتيبها دون تخطي أي صفحة.');
  const allBrands=await getBrands(); const ids=new Set(allBrands.map(b=>b.id));
  if(pages.some(p=>p.brands.some(id=>!ids.has(id)))) throw new HttpError(400,'تغيرت إعدادات العلامات؛ أعد فحص الملف.');
  const claim=await one<{id:string}>("UPDATE files SET status='processing',processed_at=? WHERE id=? AND (status IN ('uploaded','ready') OR (status='processing' AND processed_at<?)) RETURNING id",now(),id,new Date(Date.now()-300000).toISOString());
  if(!claim) throw new HttpError(409,'الملف قيد الفحص بالفعل. انتظر قليلًا.');
  const result=analyzePages(pages,file.brand_id,expectedBucket,file.name,allBrands);
  try {
    const statements=[sql('DELETE FROM pages WHERE file_id=?',id),sql('DELETE FROM occurrences WHERE file_id=?',id),sql("DELETE FROM findings WHERE (file_id=? OR related_file_id=?) AND status='open'",id,id)];
    for(let start=0;start<pages.length;start+=150) {
      const chunk=pages.slice(start,start+150);
      statements.push(sql("INSERT INTO pages (id,file_id,page,data) SELECT ? || ':' || json_extract(value,'$.page'),?,json_extract(value,'$.page'),value FROM json_each(?)",id,id,JSON.stringify(chunk)));
      const records=chunk.flatMap(p=>p.refs.map(ref=>({id:`${id}:${p.page}:${ref}`,page:p.page,ref,tracking:p.tracking,quantity:p.quantity,carrier:p.carrier,source_date:p.sourceDate,date_type:p.dateType,page_role:p.role})));
      statements.push(sql("INSERT INTO occurrences (id,file_id,brand_id,page,ref,tracking,quantity,carrier,source_date,date_type,page_role) SELECT json_extract(value,'$.id'),?,?,json_extract(value,'$.page'),json_extract(value,'$.ref'),json_extract(value,'$.tracking'),json_extract(value,'$.quantity'),json_extract(value,'$.carrier'),json_extract(value,'$.source_date'),json_extract(value,'$.date_type'),json_extract(value,'$.page_role') FROM json_each(?)",id,file.brand_id,JSON.stringify(records)));
    }
    for(let start=0;start<result.findings.length;start+=150) {
      const entries=result.findings.slice(start,start+150).map(f=>({...f,fingerprint:[id,f.kind,f.ref??'',f.page??'',f.relatedFileId??'',f.relatedPage??''].join('|')}));
      statements.push(sql("INSERT OR IGNORE INTO findings (id,fingerprint,file_id,kind,ref,page,related_file_id,related_page,message,status,created_at) SELECT json_extract(value,'$.fingerprint'),json_extract(value,'$.fingerprint'),?,json_extract(value,'$.kind'),json_extract(value,'$.ref'),json_extract(value,'$.page'),json_extract(value,'$.relatedFileId'),json_extract(value,'$.relatedPage'),json_extract(value,'$.message'),'open',? FROM json_each(?)",id,now(),JSON.stringify(entries)));
    }
    const timestamp=now();
    // SQLite serializes this batch: a concurrently completed upload is visible to the next one.
    statements.push(sql(`INSERT OR IGNORE INTO findings (id,fingerprint,file_id,kind,ref,page,related_file_id,related_page,message,status,created_at)
      SELECT a.id || '|cross|' || b.id,a.id || '|cross|' || b.id,a.file_id,'duplicate_order',a.ref,a.page,b.file_id,b.page,'الطلب موجود في ملف آخر لنفس العلامة.','open',?
      FROM occurrences a JOIN occurrences b ON b.brand_id=a.brand_id AND b.ref=a.ref AND b.file_id<>a.file_id JOIN files other ON other.id=b.file_id
      WHERE a.file_id=? AND a.page_role<>'support' AND b.page_role<>'support' AND other.expires_at>? AND other.status='ready'`,timestamp,id,timestamp));
    statements.push(sql(`INSERT OR IGNORE INTO findings (id,fingerprint,file_id,kind,ref,page,related_file_id,related_page,message,status,created_at)
      SELECT f.id || '|hash|' || other.id,f.id || '|hash|' || other.id,f.id,'duplicate_file',NULL,NULL,other.id,NULL,'تم رفع نفس محتوى PDF من قبل.','open',? FROM files f JOIN files other ON other.brand_id=f.brand_id AND other.hash=f.hash AND other.id<>f.id WHERE f.id=? AND other.expires_at>? AND other.status='ready'`,timestamp,id,timestamp));
    statements.push(sql(`INSERT OR IGNORE INTO findings (id,fingerprint,file_id,kind,ref,page,related_file_id,related_page,message,status,created_at)
      SELECT CASE WHEN i.kind='duplicate_file' THEN i.related_file_id || '|hash|' || i.file_id ELSE i.related_file_id || ':' || i.related_page || ':' || i.ref || '|cross|' || i.file_id || ':' || i.page || ':' || i.ref END,
      CASE WHEN i.kind='duplicate_file' THEN i.related_file_id || '|hash|' || i.file_id ELSE i.related_file_id || ':' || i.related_page || ':' || i.ref || '|cross|' || i.file_id || ':' || i.page || ':' || i.ref END,
      i.related_file_id,i.kind,i.ref,i.related_page,i.file_id,i.page,'يوجد ملف آخر يكرر هذا الطلب أو الملف.','open',? FROM findings i WHERE i.file_id=? AND i.related_file_id IS NOT NULL AND i.kind IN ('duplicate_order','duplicate_file')`,timestamp,id));
    statements.push(sql("UPDATE files SET status='ready',bucket=?,detected_brand_id=?,page_count=?,waybill_count=?,carriers=?,processed_at=?,reviewed_at=NULL WHERE id=?",result.bucket,result.detectedBrandId,result.pageCount,result.waybillCount,JSON.stringify(result.carriers),timestamp,id));
    statements.push(auditStatement(user,'processed',{pages:result.pageCount,waybills:result.waybillCount,bucket:result.bucket},file.brand_id,id));
    statements.push(sql("INSERT OR REPLACE INTO settings (key,value) VALUES (?, '1')",`checks_v2:${id}`));
    await db().batch(statements);
    return getFile(id);
  } catch(error) { await sql("UPDATE files SET status='uploaded' WHERE id=? AND status='processing'",id).run(); throw error; }
}
async function handle(request:Request) {
  try {
    const url=new URL(request.url), path=url.pathname.replace(/^\/api\//,'').split('/').map(decodeURIComponent), method=request.method;
    if(method!=='GET') checkOrigin(request);
    if(path.join('/')==='maintenance/run' && method==='POST') {
      const configured=(env as unknown as {MAINTENANCE_TOKEN?:string}).MAINTENANCE_TOKEN;
      const supplied=request.headers.get('authorization')?.replace(/^Bearer /,'')??'';
      if(!configured || !timingSafeEqual(createHash('sha256').update(configured).digest(),createHash('sha256').update(supplied).digest())) throw new HttpError(401,'غير مصرح.');
      return json(await maintenance(true));
    }
    const user=await currentUser();
    if(path[0]==='bootstrap' && method==='GET') {
      await maintenance();
      return json({user,brands:await getBrands()});
    }
    if(path[0]==='brands' && method==='POST') {
      requireAdmin(user);const input=brandSchema.parse(await body(request));
      if(new Set(input.columns.map(c=>c.id)).size!==input.columns.length || DEFAULT_COLUMNS.some(c=>!input.columns.some(x=>x.id===c.id))) throw new HttpError(400,'احتفظ بالمراحل الأساسية مع إمكانية تغيير أسمائها وترتيبها.');
      const identifierKeys=input.identifiers.map(normalize);
      if(new Set(identifierKeys).size!==identifierKeys.length) throw new HttpError(400,'توجد كلمات تعريف مكررة.');
      const existing=await getBrands(); const id=path[1]??uid();
      if(existing.some(b=>b.id!==id && b.identifiers.some(term=>identifierKeys.includes(normalize(term))))) throw new HttpError(400,'إحدى كلمات التعريف مستخدمة لعلامة أخرى. استخدم كلمة مميزة.');
      if(path[1] && !existing.some(b=>b.id===id)) throw new HttpError(404,'العلامة غير موجودة.');
      const old=existing.find(b=>b.id===id);
      if(old) {
        const removed=old.columns.filter(c=>!input.columns.some(n=>n.id===c.id));
        for(const c of removed) if(await one('SELECT id FROM files WHERE brand_id=? AND stage=? AND expires_at>? LIMIT 1',id,c.id,now())) throw new HttpError(409,'انقل الملفات من العمود قبل حذفه.');
      }
      await db().batch([sql('INSERT INTO brands (id,name,color,identifiers,columns,retention_days,archive_days,index_days,created_at) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,color=excluded.color,identifiers=excluded.identifiers,columns=excluded.columns,retention_days=excluded.retention_days,archive_days=excluded.archive_days,index_days=excluded.index_days',id,input.name,input.color,JSON.stringify(input.identifiers),JSON.stringify(input.columns),input.retention_days,input.archive_days,input.index_days,now()),auditStatement(user,old?'brand_updated':'brand_created',{name:input.name,identifiers:input.identifiers},id)]);
      // A shorter policy also applies to existing records; never extend an expired object's life.
      await sql("UPDATE files SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ',uploaded_at,? || ' days') WHERE brand_id=? AND expires_at>?",String(input.retention_days),id,now()).run();
      if(input.index_days===0) await sql('DELETE FROM order_index WHERE brand_id=?',id).run();
      return json({brands:await getBrands()});
    }
    if(path[0]==='users') {
      requireAdmin(user);
      if(method==='GET') return json({users:await rows('SELECT id,email,name,role,active,created_at FROM users ORDER BY created_at')});
      if(method==='POST') {
        const input=z.object({email:z.string().email().max(254),name:z.string().trim().min(1).max(100),role:z.enum(['admin','operator']),active:z.boolean().default(true)}).parse(await body(request));
        const email=input.email.toLowerCase().trim();
        const existing=await one<User>('SELECT * FROM users WHERE email=?',email);
        if(existing?.id===user.id && (input.role!=='admin'||!input.active)) throw new HttpError(400,'لا يمكنك إلغاء صلاحيتك الإدارية من هذا الحساب.');
        await db().batch([sql('INSERT INTO users (id,email,name,role,active,created_at) VALUES (?,?,?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active',existing?.id??`invite:${uid()}`,email,input.name,input.role,input.active?1:0,now()),auditStatement(user,'user_updated',{email,role:input.role,active:input.active})]);
        return json({ok:true});
      }
    }
    if(path[0]==='files' && !path[1]) {
      if(method==='GET') {
        await upgradeFileChecks();
        const brand=url.searchParams.get('brand');
        const files=await rows(`${CARD_SELECT} WHERE f.expires_at>? ${brand?'AND f.brand_id=?':''} ORDER BY f.uploaded_at DESC LIMIT 2000`,now(),...(brand?[brand]:[]));
        return json({files:files.map(f=>hydrateFile(f as Parameters<typeof hydrateFile>[0]))});
      }
      if(method==='POST') {
        const input=z.object({id:z.string().uuid(),brandId:z.string().max(100),name:z.string().trim().min(1).max(240),size:z.number().int().positive().max(MAX_FILE_BYTES)}).parse(await body(request));
        if(!input.name.toLowerCase().endsWith('.pdf')) throw new HttpError(400,'ارفع ملف PDF فقط.');
        const brand=(await getBrands()).find(b=>b.id===input.brandId); if(!brand) throw new HttpError(404,'اختر علامة موجودة.');
        const existing=await one<{id:string;created_by:string}>('SELECT id,created_by FROM files WHERE id=?',input.id);
        if(existing) { if(existing.created_by!==user.id) throw new HttpError(409,'معرّف الرفع مستخدم.'); return json({file:await getFile(input.id)}); }
        const time=now();
        await db().batch([sql('INSERT INTO files (id,brand_id,name,size,object_key,uploaded_at,expires_at,created_by) VALUES (?,?,?,?,?,?,?,?)',input.id,input.brandId,input.name,input.size,`waybills/${input.id}.pdf`,time,addDays(time,brand.retention_days),user.id),auditStatement(user,'upload_started',{name:input.name,size:input.size},input.brandId,input.id)]);
        return json({file:await getFile(input.id)},201);
      }
    }
    if(path[0]==='files' && path[1]) {
      const id=path[1],action=path[2];const file=await getFile(id);
      if(!action && method==='DELETE') {
        const input=z.object({confirm:z.literal(true)}).parse(await body(request));
        const claimed=await one("UPDATE files SET status='deleting',expires_at=? WHERE id=? AND (status NOT IN ('receiving','processing','deleting') OR (status IN ('receiving','processing') AND processed_at<?)) RETURNING id",now(),id,new Date(Date.now()-600000).toISOString());
        if(!claimed)throw new HttpError(409,'الملف قيد الرفع أو الفحص. انتظر اكتماله ثم احذفه.');
        try{
          await bucket().delete(file.object_key);
          await db().batch([
            sql('DELETE FROM notes WHERE file_id=?',id),sql('DELETE FROM findings WHERE related_file_id=?',id),
            sql('DELETE FROM audit WHERE file_id=?',id),sql('DELETE FROM files WHERE id=?',id),
            sql('DELETE FROM settings WHERE key=?',`checks_v2:${id}`),
            sql('DELETE FROM notes WHERE brand_id=? AND ref IS NOT NULL AND NOT EXISTS (SELECT 1 FROM occurrences o JOIN files f ON f.id=o.file_id WHERE o.ref=notes.ref AND o.brand_id=notes.brand_id AND f.expires_at>?)',file.brand_id,now()),
            auditStatement(user,'file_deleted',{name:file.name},file.brand_id),
          ]);
        }catch(error){await sql("UPDATE files SET status=?,expires_at=? WHERE id=? AND status='deleting'",file.status,file.expires_at,id).run();throw error;}
        return json({ok:true});
      }
      if(!action && method==='GET') return json({file,findings:await rows('SELECT i.*, f.name AS related_name, f.uploaded_at AS related_uploaded_at FROM findings i LEFT JOIN files f ON f.id=i.related_file_id AND f.expires_at>? WHERE i.file_id=? AND (i.related_file_id IS NULL OR f.id IS NOT NULL) ORDER BY (i.status=\'open\') DESC,i.page',now(),id),notes:await rows('SELECT * FROM notes n WHERE n.brand_id=? AND (n.file_id=? OR (n.ref IS NOT NULL AND EXISTS(SELECT 1 FROM occurrences o WHERE o.file_id=? AND o.ref=n.ref))) ORDER BY n.created_at DESC',file.brand_id,id,id),orders:await rows('SELECT * FROM occurrences WHERE file_id=? ORDER BY page,ref',id),audit:await rows('SELECT * FROM audit WHERE file_id=? ORDER BY created_at DESC LIMIT 100',id)});
      if(action==='content' && method==='PUT') {
        if(!request.body) throw new HttpError(400,'الملف فارغ.');
        const claimed=await one("UPDATE files SET status='receiving',processed_at=? WHERE id=? AND (status='uploading' OR (status='receiving' AND processed_at<?)) RETURNING id",now(),id,new Date(Date.now()-600000).toISOString()); if(!claimed) throw new HttpError(409,'تم رفع الملف بالفعل أو يجري رفعه.');
        let size=0,prefix='';const hash=createHash('sha256');
        try {
          const stream=request.body.pipeThrough(new TransformStream<Uint8Array,Uint8Array>({transform(chunk,controller){size+=chunk.byteLength;if(size>MAX_FILE_BYTES||size>file.size)throw new Error('file_limit');if(prefix.length<1024)prefix+=new TextDecoder('latin1').decode(chunk.slice(0,1024-prefix.length));hash.update(chunk);controller.enqueue(chunk);},flush(){if(size!==file.size||!prefix.includes('%PDF-'))throw new Error('invalid_pdf');}}));
          // R2 requires a known-length stream. Hash and validate without buffering 50 MB in the Worker.
          const fixed=new FixedLengthStream(file.size);
          await Promise.all([stream.pipeTo(fixed.writable),bucket().put(file.object_key,fixed.readable,{httpMetadata:{contentType:'application/pdf'}})]);
          await db().batch([sql("UPDATE files SET hash=?,status='uploaded' WHERE id=?",hash.digest('hex'),id),auditStatement(user,'uploaded',{bytes:size},file.brand_id,id)]);
          return json({ok:true});
        }catch(error){console.error('PDF storage failed',error instanceof Error?error.message:'Unknown error');await bucket().delete(file.object_key);await sql("UPDATE files SET status='uploading' WHERE id=?",id).run();throw new HttpError(400,'تعذر حفظ PDF. تأكد من حجم الملف وسلامته ثم أعد المحاولة.');}
      }
      if(action==='process' && method==='POST') {const input=z.object({pages:z.array(pageSchema).min(1).max(10000),expectedBucket:z.enum(['single','multiple']).nullable().optional()}).parse(await body(request));return json({file:await processFile(id,input.pages,user,input.expectedBucket)});}
      if(action==='download' && method==='GET') {
        const object=await bucket().get(file.object_key);if(!object)throw new HttpError(404,'لم يكتمل رفع الملف أو لم يعد متاحًا.');
        await auditStatement(user,url.searchParams.get('purpose')==='inspect'?'inspected':'downloaded',{},file.brand_id,id).run();
        return new Response(object.body,{headers:{'Content-Type':'application/pdf','Content-Length':String(object.size),'Content-Disposition':`${url.searchParams.get('inline')==='1'?'inline':'attachment'}; filename="waybills.pdf"; filename*=UTF-8''${encodeURIComponent(file.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"sandbox"}});
      }
      if(action==='move' && method==='POST') {
        const input=z.object({stage:z.string().max(50)}).parse(await body(request));const brand=(await getBrands()).find(b=>b.id===file.brand_id)!;
        if(!brand.columns.some(c=>c.id===input.stage))throw new HttpError(400,'العمود غير موجود.');
        if(input.stage==='printed')throw new HttpError(400,'استخدم تأكيد الطباعة لتسجيل من طبع الملف ووقته.');
        if(file.status!=='ready')throw new HttpError(409,'أكمل فحص الملف أولًا.');
        if(['prepared','shipped'].includes(input.stage)&&!file.printed_at)throw new HttpError(409,'أكد طباعة الملف أولًا.');
        await db().batch([sql('UPDATE files SET stage=?,shipped_at=? WHERE id=?',input.stage,input.stage==='shipped'?(file.stage==='shipped'?file.shipped_at:now()):null,id),auditStatement(user,'moved',{from:file.stage,to:input.stage},file.brand_id,id)]);return json({ok:true});
      }
      if(action==='printed' && method==='POST') {
        if(file.status!=='ready')throw new HttpError(409,'أكمل الفحص أولًا.');
        if(file.open_issues>0)throw new HttpError(409,'راجع التنبيهات وسجل معالجتها قبل تأكيد الطباعة.');
        await db().batch([sql("UPDATE files SET stage='printed',printed_at=?,shipped_at=NULL WHERE id=?",now(),id),auditStatement(user,'printed',{},file.brand_id,id)]);return json({ok:true});
      }
      if(action==='acknowledge' && method==='POST') {
        const input=z.object({version:z.number().int().nonnegative()}).parse(await body(request));
        const ack=await one('UPDATE files SET ack_version=? WHERE id=? AND changed_version=? RETURNING id',input.version,id,input.version);
        if(!ack)throw new HttpError(409,'أضيف تعديل جديد؛ راجع الملاحظات وأكد الاطلاع مرة أخرى.');
        await auditStatement(user,'acknowledged',{version:input.version},file.brand_id,id).run();return json({ok:true});
      }
      if(action==='confirm' && method==='POST') {
        const input=z.object({bucket:z.enum(['single','multiple']),note:z.string().trim().min(1).max(1000)}).parse(await body(request));
        await db().batch([sql("UPDATE findings SET status='false_alarm',resolution_note=?,resolved_by=?,resolved_at=? WHERE file_id=? AND status='open' AND kind IN ('brand_unknown','quantity_unknown')",`تأكيد يدوي: ${input.note}`,user.id,now(),id),sql('UPDATE files SET bucket=CASE WHEN bucket=\'unknown\' THEN ? ELSE bucket END,reviewed_at=? WHERE id=?',input.bucket,now(),id),auditStatement(user,'manually_confirmed',input,file.brand_id,id)]);return json({ok:true});
      }
      if(action==='brand' && method==='POST') {
        const input=z.object({brandId:z.string().max(100)}).parse(await body(request));const target=(await getBrands()).find(b=>b.id===input.brandId);if(!target)throw new HttpError(404,'العلامة غير موجودة.');
        if(file.status!=='ready')throw new HttpError(409,'أكمل فحص الملف أولًا.');
        const stored=await rows<{data:string}>('SELECT data FROM pages WHERE file_id=? ORDER BY page',id);
        const parsed=stored.map(p=>JSON.parse(p.data) as PageRecord);
        const verification=analyzePages(parsed,target.id,null,file.name,await getBrands());
        if(verification.detectedBrandId!==target.id)throw new HttpError(409,'لم توجد كلمة تعريف للعلامة المطلوبة في الملف أو اسمه. راجع العلامة أولًا.');
        await db().batch([sql("UPDATE files SET brand_id=?,expires_at=?,detected_brand_id=NULL WHERE id=?",target.id,addDays(file.uploaded_at,target.retention_days),id),sql('UPDATE notes SET brand_id=? WHERE file_id=? AND ref IS NULL',target.id,id),sql('DELETE FROM findings WHERE file_id=? OR related_file_id=?',id,id),auditStatement(user,'brand_moved',{from:file.brand_id,to:target.id},target.id,id)]);
        return json({file:await processFile(id,parsed,user)});
      }
      if(action==='notes' && method==='POST') {
        const input=z.object({ref:z.string().max(40).nullable(),type:z.enum(['cancelled','changed','other']),body:z.string().trim().min(1).max(4000)}).parse(await body(request));
        const ref=input.ref?normalizeRef(input.ref):null;
        if(ref&&!await one('SELECT id FROM occurrences WHERE file_id=? AND ref=?',id,ref))throw new HttpError(400,'رقم الطلب غير موجود في هذا الملف.');
        await db().batch([sql('INSERT INTO notes (id,brand_id,file_id,ref,type,body,created_by,actor_name,created_at) VALUES (?,?,?,?,?,?,?,?,?)',uid(),file.brand_id,ref?null:id,ref,input.type,input.body,user.id,user.name,now()),ref?sql('UPDATE files SET changed_version=changed_version+1 WHERE brand_id=? AND printed_at IS NOT NULL AND expires_at>? AND EXISTS (SELECT 1 FROM occurrences o WHERE o.file_id=files.id AND o.ref=?)',file.brand_id,now(),ref):sql('UPDATE files SET changed_version=changed_version+1 WHERE id=? AND printed_at IS NOT NULL',id),auditStatement(user,'note_added',{ref,type:input.type},file.brand_id,id)]);return json({ok:true});
      }
    }
    if(path[0]==='findings' && method==='POST') {
      const input=z.object({ids:z.array(z.string().max(500)).min(1).max(1000),status:z.enum(['confirmed_error','false_alarm','voided']),note:z.string().trim().min(1).max(2000)}).parse(await body(request));
      const matches=await rows<{id:string;file_id:string;brand_id:string}>("SELECT i.id,i.file_id,f.brand_id FROM findings i JOIN files f ON f.id=i.file_id WHERE i.id IN (SELECT value FROM json_each(?)) AND f.expires_at>? AND i.status='open'",JSON.stringify(input.ids),now());
      if(matches.length===0)throw new HttpError(409,'تمت معالجة هذه التنبيهات بالفعل.');
      await db().batch([sql("UPDATE findings SET status=?,resolution_note=?,resolved_by=?,resolved_at=? WHERE id IN (SELECT value FROM json_each(?)) AND status='open'",input.status,input.note,user.id,now(),JSON.stringify(matches.map(m=>m.id))),...([...new Set(matches.map(m=>m.file_id))].map(fileId=>auditStatement(user,'issues_resolved',{count:matches.filter(m=>m.file_id===fileId).length,status:input.status,note:input.note},matches.find(m=>m.file_id===fileId)!.brand_id,fileId)))]);return json({ok:true});
    }
    if(path[0]==='search' && (method==='GET'||method==='POST')) {
      const input=method==='POST'?z.object({refs:z.string().max(12000)}).parse(await body(request)):null;
      const refs=input?parseRefList(input.refs):null; if(refs&&refs.length>500)throw new HttpError(400,'الحد الأقصى ٥٠٠ طلب في المرة الواحدة.');
      const q=normalizeRef(url.searchParams.get('q')??'');if(!refs&&q.length<2)return json({results:[],missing:[],truncated:false});
      const predicate=refs?'o.ref IN (SELECT value FROM json_each(?))':"instr(o.ref,?)>0";const parameter=refs?JSON.stringify(refs):q;
      const found=await rows<{ref:string}>(`SELECT o.*,f.name,f.stage,f.uploaded_at,b.name AS brand_name,0 AS historical FROM occurrences o JOIN files f ON f.id=o.file_id JOIN brands b ON b.id=o.brand_id WHERE ${predicate} AND f.expires_at>? ORDER BY f.uploaded_at DESC,o.page LIMIT 2001`,parameter,now());
      const historical=await rows<{ref:string}>(`SELECT o.ref,o.brand_id,o.page,o.file_name AS name,o.stage,o.uploaded_at,b.name AS brand_name,NULL AS file_id,1 AS historical FROM order_index o JOIN brands b ON b.id=o.brand_id WHERE ${predicate} AND o.expires_at>? LIMIT 2001`,parameter,now());
      const results=[...found,...historical];
      const present=refs?new Set((await rows<{ref:string}>(`SELECT wanted.value AS ref FROM json_each(?) wanted WHERE EXISTS (SELECT 1 FROM occurrences o JOIN files f ON f.id=o.file_id WHERE o.ref=wanted.value AND f.expires_at>?) OR EXISTS (SELECT 1 FROM order_index h WHERE h.ref=wanted.value AND h.expires_at>?)`,JSON.stringify(refs),now(),now())).map(r=>r.ref)):new Set<string>();
      return json({results:results.slice(0,2000),missing:refs?.filter(ref=>!present.has(ref))??[],truncated:results.length>2000});
    }
    if(path[0]==='audit' && method==='GET') {const brand=url.searchParams.get('brand');return json({events:await rows(`SELECT a.*,COALESCE(f.name,CASE WHEN a.action='file_deleted' THEN json_extract(a.detail,'$.name') END) AS file_name FROM audit a LEFT JOIN files f ON f.id=a.file_id WHERE ${brand?'a.brand_id=? AND ':''}(a.file_id IS NULL OR f.expires_at>?) ORDER BY a.created_at DESC LIMIT 300`,...(brand?[brand]:[]),now())});}
    if(path[0]==='maintenance' && method==='POST') {requireAdmin(user);return json(await maintenance(true));}
    throw new HttpError(404,'الطلب غير موجود.');
  }catch(error){if(error instanceof HttpError)return json({error:error.message},error.status);if(error instanceof z.ZodError)return json({error:'راجع الحقول المدخلة ثم حاول مرة أخرى.',fields:error.issues.map(i=>i.path.join('.'))},400);console.error('Waybill API request failed',error instanceof Error?error.message:'Unknown error');return json({error:'تعذر إكمال العملية الآن. بياناتك المدخلة لم تُحذف؛ حاول مرة أخرى.'},500);}
}
export const GET=handle;export const POST=handle;export const PUT=handle;export const DELETE=handle;
