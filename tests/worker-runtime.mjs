// Run after npm run build. Uses an isolated local database, never production.
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Miniflare,Response as MiniResponse} from 'miniflare';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
const {privateKey,publicKey}=await generateKeyPair('RS256');
const testKeys={keys:[{...await exportJWK(publicKey),kid:'local-test'}]};
const files=(await readdir('dist/server',{recursive:true})).filter(p=>p.endsWith('.js')&&p!=='index.js');
const modules=['index.js',...files].map(p=>({type:'ESModule',path:resolve('dist/server',p)}));
const mf=new Miniflare({name:'masar-runtime-test',modules,modulesRoot:resolve('dist/server'),compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ACCESS_TEAM_DOMAIN:'https://masar-test.cloudflareaccess.com',ACCESS_AUD:'masar-test-audience',INITIAL_ADMIN_EMAIL:'owner@example.test'},outboundService:request=>{assert.equal(request.url,'https://masar-test.cloudflareaccess.com/cdn-cgi/access/certs');return MiniResponse.json(testKeys);},cf:false});
try{
 const db=await mf.getD1Database('DB');
 const migration=await readFile('drizzle/0000_closed_lethal_legion.sql','utf8');
 for(const statement of migration.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(statement).run();
 await db.prepare('INSERT INTO brands (id,name,color,identifiers,columns,created_at) VALUES (?,?,?,?,?,?)').bind('qa','QA','#000000','[]','[]',new Date().toISOString()).run();
 await db.prepare('INSERT INTO files (id,brand_id,name,size,object_key,uploaded_at,expires_at,created_by) VALUES (?,?,?,?,?,?,?,?)').bind('expired-qa','qa','Synthetic cron test',1,'waybills/expired-qa.pdf',new Date(Date.now()-31*86400000).toISOString(),new Date(Date.now()-86400000).toISOString(),'qa').run();
 const worker=await mf.getWorker();
 // Use the direct Worker service: this Wrangler version's HTTP cron test route
 // targets its static-asset router instead of the user Worker (workers-sdk #9882).
 assert.equal((await worker.scheduled({scheduledTime:new Date('2026-01-15T00:00:00Z'),cron:'0 * * * *'})).outcome,'ok');
 assert.ok(await db.prepare('SELECT id FROM files WHERE id=?').bind('expired-qa').first());
 assert.equal((await worker.scheduled({scheduledTime:new Date('2026-07-15T00:00:00Z'),cron:'0 * * * *'})).outcome,'ok');
 assert.equal(await db.prepare('SELECT id FROM files WHERE id=?').bind('expired-qa').first(),null);
 console.log('PASS native scheduled handler: skips 02:00 Cairo, cleans expired records at 03:00 with DST.');
 for(const path of ['/','/api/files','/api/files/fake/download','/attention?file=fake','/auth/login']){
  for(const headers of [{},{cookie:'__masar_local=1','x-masar-dev-email':'admin@masar.test','oai-authenticated-user-id':'owner','oai-authenticated-user-email':'owner@example.test'},{'cf-access-jwt-assertion':'forged'}]){
   const res=await mf.dispatchFetch('http://localhost'+path,{headers,redirect:'manual'});assert.equal(res.status,401,path);assert.equal(res.headers.get('cache-control'),'private, no-store');
  }
 }
 console.log('PASS production auth: 15 unauthenticated/forged-cookie/header requests rejected across pages, APIs and downloads.');
 async function signed(email,subject='test-subject'){
  return await new SignJWT({email,type:'app'}).setProtectedHeader({alg:'RS256',kid:'local-test'}).setSubject(subject).setIssuer('https://masar-test.cloudflareaccess.com').setAudience(['masar-test-audience']).setIssuedAt().setExpirationTime('1h').sign(privateKey);
 }
 async function api(email,path,data,expected=200,subject){
  const res=await mf.dispatchFetch('https://masar.example.test/api/'+path,{method:data?'POST':'GET',headers:{'cf-access-jwt-assertion':await signed(email,subject),...(data?{'Content-Type':'application/json'}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const value=await res.json();assert.equal(res.status,expected,JSON.stringify(value));return value;
 }
 await api('stranger@example.test','bootstrap',undefined,403);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM users').first()).n,0);
 const owner=await api('owner@example.test','bootstrap');assert.equal(owner.user.role,'admin');
 await api('owner@example.test','users',{email:'operator@example.test',name:'Operator',role:'operator',active:true});
 const operator=await api('operator@example.test','bootstrap');assert.equal(operator.user.role,'operator');
 assert.equal((await api('operator@example.test','bootstrap',undefined,200,'different-provider-subject')).user.id,operator.user.id);
 await api('operator@example.test','users',undefined,403);
 await api('owner@example.test','users',{email:'operator@example.test',name:'Operator',role:'operator',active:false});
 await api('operator@example.test','files',undefined,403);
 await api('operator@example.test','files/anything/download',undefined,403);
 console.log('PASS production membership: only configured email initializes admin; invited operator keeps stable ID; inactive users and non-admin actions rejected.');

}finally{await mf.dispose();}
