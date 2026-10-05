// Destructive only to the local test database. Never runs against a hosted Site.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {DEFAULT_COLUMNS,MAX_FILE_BYTES,type PageRecord} from '../lib/domain.ts';
const origin=process.env.TEST_ORIGIN??'http://127.0.0.1:5173';
assert.equal(new URL(origin).hostname,'127.0.0.1','Only the loopback QA server is permitted.');
const paths=(await readdir('.wrangler/state/v3/d1',{recursive:true})).filter(p=>p.endsWith('.sqlite')&&!p.endsWith('/metadata.sqlite'));
assert.equal(paths.length,1,'Expected exactly one local test database.');
const database=new DatabaseSync(`.wrangler/state/v3/d1/${paths[0]}`);database.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
database.exec('DELETE FROM findings; DELETE FROM pages; DELETE FROM occurrences; DELETE FROM notes; DELETE FROM audit; DELETE FROM order_index; DELETE FROM files; DELETE FROM brands; DELETE FROM users; DELETE FROM settings;');
const signed=await fetch(`${origin}/signin-with-chatgpt?return_to=/`,{redirect:'manual'});
const cookie=signed.headers.get('set-cookie')!.split(';')[0];assert.ok(cookie);
async function call(path:string,data?:unknown,expected=200,method=data===undefined?'GET':'POST') {
 const res=await fetch(`${origin}/api/${path}`,{method,headers:{cookie,'Content-Type':'application/json'},...(data===undefined?{}:{body:JSON.stringify(data)})});
 const value=await res.json() as any;assert.equal(res.status,expected,`${path}: ${JSON.stringify(value)}`);return value;
}
let checks=0;const pass=(name:string)=>console.log(`PASS ${++checks}: ${name}`);
const bootstrap=await call('bootstrap');assert.equal(bootstrap.user.role,'admin');assert.equal(bootstrap.brands[0].id,'wassan');
assert.equal((await fetch(`${origin}/api/files`)).status,401);assert.equal((await fetch(`${origin}/api/files`,{headers:{'oai-authenticated-user-id':'forged','oai-authenticated-user-email':'forged@example.test'}})).status,401);pass('login and spoofed identity rejection');
const brand=bootstrap.brands[0];
const load=async(count:number)=>JSON.parse(await readFile(`.sites-runtime/sample-records/${count}.json`,'utf8')) as {name:string;pages:PageRecord[]};
const samples=new Map<number,{id:string;pages:PageRecord[];bytes:Buffer<ArrayBuffer>}>();
async function upload(pages:PageRecord[],bytes=Buffer.from(`%PDF-1.7\n% synthetic QA ${randomUUID()}\n%%EOF`),brandId='wassan',name='اختبار.pdf') {
 const id=randomUUID();await call('files',{id,brandId,name,size:bytes.length},201);
 const content=await fetch(`${origin}/api/files/${id}/content`,{method:'PUT',headers:{cookie,'Content-Type':'application/pdf'},body:bytes});
 assert.equal(content.status,200,`content: ${await content.text()}`);
 const start=performance.now();const {file}=await call(`files/${id}/process`,{pages});return {id,file,seconds:(performance.now()-start)/1000};
}
for(const count of [226,26,836,85,6]){
 const {name,pages}=await load(count),bytes=await readFile(`../sample waybills/${name}`);const result=await upload(pages,bytes,'wassan',name);samples.set(count,{id:result.id,pages,bytes});
 assert.equal(result.file.page_count,count);assert.equal(result.file.waybill_count,count===6?3:count);assert.equal(result.file.open_issues,count===6?6:0);
 const downloaded=await fetch(`${origin}/api/files/${result.id}/download`,{headers:{cookie}});assert.equal(downloaded.status,200);assert.equal(createHash('sha256').update(Buffer.from(await downloaded.arrayBuffer())).digest('hex'),createHash('sha256').update(bytes).digest('hex'));
 pass(`${count}-page original upload, correct findings/counts, unchanged download; processing ${result.seconds.toFixed(2)}s`);
}
const first=samples.get(226)!;const ref=first.pages[0].refs[0];
await call(`files/${first.id}/printed`,{});await call(`files/${first.id}/move`,{stage:'prepared'});
await call(`files/${first.id}/notes`,{ref,type:'cancelled',body:'QA: cancellation after print'});
let detail=await call(`files/${first.id}`);assert.equal(detail.file.changed_version,1);assert.equal(detail.file.ack_version,0);assert.equal(detail.file.attention_orders,1);
await call(`files/${first.id}/acknowledge`,{version:1});await call(`files/${first.id}/notes`,{ref,type:'changed',body:'QA: second change'});await call(`files/${first.id}/acknowledge`,{version:1},409);
detail=await call(`files/${first.id}`);assert.equal(detail.file.changed_version,2);assert.equal(detail.file.ack_version,1);pass('late cancellation on Prepared, acknowledgment, second change and stale acknowledgment rejection');
let search=await call(`search?q=${ref.slice(0,-1)}`);assert.ok(search.results.some((r:any)=>r.ref===ref&&r.file_id===first.id));
search=await call('search',{refs:`${ref}\n000000000000`});assert.deepEqual(search.missing,['000000000000']);pass('partial and batch search');
const duplicate=await upload(first.pages,first.bytes);detail=await call(`files/${duplicate.id}`);assert.equal(detail.findings.filter((f:any)=>f.kind==='duplicate_order').length,226);assert.equal(detail.findings.filter((f:any)=>f.kind==='duplicate_file').length,1);
await call(`files/${duplicate.id}/process`,{pages:first.pages});let original=await call(`files/${first.id}`);assert.equal(original.findings.length,227);pass('same-file hash plus cross-file refs; recheck does not multiply mirrored findings');
await call('findings',{ids:detail.findings.map((f:any)=>f.id),status:'voided',note:'QA duplicate copy voided'});await call(`files/${duplicate.id}/process`,{pages:first.pages});detail=await call(`files/${duplicate.id}`);assert.equal(detail.file.open_issues,0);pass('resolved findings remain resolved after recheck');
const repeat=await upload(first.pages.slice(0,2));detail=await call(`files/${repeat.id}`);assert.equal(detail.findings.filter((f:any)=>f.kind==='duplicate_order'&&f.related_file_id===first.id).length,2);assert.ok(detail.findings.every((f:any)=>f.related_page&&f.related_uploaded_at));pass('two repeated orders show previous file, page and date');
const baseline={...first.pages[0],refs:['800000001']};
const mixed=await upload([baseline,{...baseline,page:2,refs:['800000002'],quantity:2}]);detail=await call(`files/${mixed.id}`);assert.equal(detail.file.bucket,'mixed');assert.ok(detail.findings.some((f:any)=>f.kind==='bucket_mismatch'&&f.ref==='800000002'&&f.page===2));await call(`files/${mixed.id}/printed`,{},409);pass('mixed bucket identifies offending Ref and blocks print confirmation');
const internal=await upload([baseline,{...baseline,page:2}]);detail=await call(`files/${internal.id}`);assert.ok(detail.findings.some((f:any)=>f.kind==='duplicate_order'&&!f.related_file_id&&f.related_page===1&&f.page===2));pass('duplicate Ref inside one PDF');
const unknown=await upload([{...baseline,refs:[],carrier:'Unknown',role:'unknown',quantity:null,tracking:null,brands:[]}]);detail=await call(`files/${unknown.id}`);assert.ok(detail.findings.some((f:any)=>f.kind==='unreadable'&&f.page===1));assert.equal(detail.file.page_count,1);pass('unknown carrier is flagged and retained');
const br=await call('brands',{name:'علامة اختبار',color:'#665599',identifiers:['Other Store'],columns:DEFAULT_COLUMNS,retention_days:30,archive_days:7,index_days:90});const other=br.brands.find((b:any)=>b.id!=='wassan');
await call(`brands/${other.id}`,{...other,identifiers:['Other Store','other.example.test']});
await call('brands',{...other,name:'Conflicting',identifiers:['wasnbrand.com']},400);
const wrong=await upload([{...baseline,brands:[other.id],matches:['Other Store']}]);detail=await call(`files/${wrong.id}`);assert.equal(detail.file.detected_brand_id,other.id);assert.ok(detail.findings.some((f:any)=>f.kind==='brand_mismatch'));
await call(`files/${wrong.id}/brand`,{brandId:other.id});detail=await call(`files/${wrong.id}`);assert.equal(detail.file.brand_id,other.id);assert.equal(detail.file.open_issues,0);pass('editable brand words, conflicting words rejected, wrong-brand move rechecks destination without cross-brand false duplicates');
const concurrentPage={...baseline,refs:['800000099']};const concurrent=await Promise.all([upload([concurrentPage]),upload([concurrentPage])]);for(const f of concurrent){detail=await call(`files/${f.id}`);assert.ok(detail.findings.some((i:any)=>i.kind==='duplicate_order'));}pass('simultaneous uploads detect both sides');
database.prepare('UPDATE files SET expires_at=? WHERE id=?').run(new Date(Date.now()-1000).toISOString(),concurrent[0].id);detail=await call(`files/${concurrent[1].id}`);assert.equal(detail.file.open_issues,0);assert.equal(detail.findings.length,0);pass('expired related duplicates stop alerting before cleanup runs');
const clean=samples.get(26)!;await call(`files/${clean.id}/printed`,{});await call(`files/${clean.id}/move`,{stage:'shipped'});
database.prepare("UPDATE files SET shipped_at=? WHERE id=?").run(new Date(Date.now()-8*86400000).toISOString(),clean.id);
await call(`files/${first.id}/move`,{stage:'shipped'});database.prepare("UPDATE files SET shipped_at=? WHERE id=?").run(new Date(Date.now()-8*86400000).toISOString(),first.id);
await call('maintenance',{});assert.equal((await call(`files/${clean.id}`)).file.stage,'archive');assert.equal((await call(`files/${first.id}`)).file.stage,'shipped');pass('scheduled rules archive clear shipped files and retain cards needing attention');
const expired=wrong.id;database.prepare('UPDATE files SET uploaded_at=?,expires_at=? WHERE id=?').run(new Date(Date.now()-31*86400000).toISOString(),new Date(Date.now()-86400000).toISOString(),expired);
await call(`files/${expired}`,undefined,404);assert.equal((await fetch(`${origin}/api/files/${expired}/download`,{headers:{cookie}})).status,404);
search=await call(`search?q=${baseline.refs[0]}`);assert.ok(!search.results.some((r:any)=>r.file_id===expired));await call('maintenance',{});assert.equal(database.prepare('SELECT count(*) AS n FROM files WHERE id=?').get(expired)!.n,0);search=await call(`search?q=${baseline.refs[0]}`);assert.ok(search.results.some((r:any)=>r.historical&&r.brand_id===other.id));pass('expiry immediately removes access/active lookup, cleanup deletes records, optional historical index remains');
await call('files',{id:randomUUID(),brandId:'wassan',name:'too-big.pdf',size:MAX_FILE_BYTES+1},400);pass('50 MB upload boundary enforced');
database.prepare("UPDATE users SET role='operator' WHERE id=?").run(bootstrap.user.id);await call('users',undefined,403);await call(`brands/${brand.id}`,brand,403);assert.ok((await call('files')).files.length);assert.ok((await call('bootstrap')).brands.length===2);database.prepare("UPDATE users SET role='admin' WHERE id=?").run(bootstrap.user.id);pass('operator can access all brands but cannot change users or brand settings');
assert.equal((await fetch(`${origin}/api/maintenance/run`,{method:'POST'})).status,401);pass('unattended cleanup endpoint rejects missing service credential');
await call(`brands/${other.id}`,{...other,index_days:0});assert.equal(database.prepare('SELECT count(*) AS n FROM order_index WHERE brand_id=?').get(other.id)!.n,0);pass('turning off the historical index deletes existing index entries');
const retryId=randomUUID(),retryBytes=Buffer.from('%PDF-1.7\n% retry fixture\n%%EOF');await call('files',{id:retryId,brandId:'wassan',name:'retry.pdf',size:retryBytes.length},201);database.prepare("UPDATE files SET status='receiving',processed_at=? WHERE id=?").run(new Date(Date.now()-11*60000).toISOString(),retryId);const retried=await fetch(`${origin}/api/files/${retryId}/content`,{method:'PUT',headers:{cookie},body:retryBytes});assert.equal(retried.status,200);database.prepare("UPDATE files SET status='processing',processed_at=? WHERE id=?").run(new Date(Date.now()-6*60000).toISOString(),retryId);await call(`files/${retryId}/process`,{pages:[{...baseline,refs:['800000888']}]});pass('interrupted upload and processing can recover after stale leases');
database.close();console.log(`Integration complete: ${checks} checks passed.`);
