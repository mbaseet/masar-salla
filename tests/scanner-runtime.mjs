// Scanner requests and the Salla connection lifecycle with isolated SQLite and synthetic upstream responses.
import assert from 'node:assert/strict';
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'esbuild';

const database = new DatabaseSync(':memory:');
for (const name of (await readdir('drizzle')).filter(file=>file.endsWith('.sql')).sort()) {
  database.exec(await readFile('drizzle/'+name,'utf8'));
}

const env = {
  SCANNER_BRAND_ID:'wassan', SCANNER_BRAND_NAME:'وسن', SALLA_MERCHANT_ID:'10',
  SCANNER_ACCESS_CODE:randomBytes(24).toString('hex'), SALLA_WEBHOOK_SECRET:randomBytes(24).toString('hex'),
  SALLA_TOKEN_KEY:randomBytes(32).toString('hex'),
  ASSETS:{fetch:request=>new Response(new URL(request.url).pathname)},
  DB:{
    prepare(statement) {
      return {bind(...parameters) {
        const prepared = database.prepare(statement);
        return {
          first:async()=>prepared.get(...parameters)??null,
          all:async()=>({results:prepared.all(...parameters)}),
          run:()=>({meta:{changes:Number(prepared.run(...parameters).changes)}}),
        };
      }};
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        const results = statements.map(statement=>statement.run());
        database.exec('COMMIT');
        return results;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  },
};

const buildResult = await build({entryPoints:['scanner/worker.ts'],bundle:true,write:false,format:'esm'});
const code = Buffer.from(buildResult.outputFiles[0].contents).toString('base64');
const {default:worker} = await import('data:text/javascript;base64,'+code);

const waiters = [];
const context = {waitUntil:promise=>waiters.push(promise)};
let duplicate = false;
let outboundRequests = 0;
const label = {id:20,order_id:30,type:'shipment',tracking_number:'AY0000001234',status:'created'};
globalThis.fetch = async (address,options) => {
  outboundRequests++;
  const url = new URL(address);
  assert.equal(options.redirect,'manual');
  assert.equal(url.origin,'https://api.salla.dev');
  const other = options.headers.Authorization==='Bearer synthetic-other';
  assert.equal(options.headers.Authorization,other ? 'Bearer synthetic-other' : 'Bearer synthetic-access');
  const orderId = other ? 60 : 30;
  const reference = other ? 200001 : 100001;
  const storeLabel = other ? {...label,id:50,order_id:orderId} : label;
  switch (url.pathname) {
    case '/admin/v2/shipments':
      return Response.json({data:duplicate && !other && !url.searchParams.has('order_id') ? [label,{...label,id:21,order_id:31}] : [storeLabel]});
    case '/admin/v2/orders':
      return Response.json({data:url.searchParams.get('reference_id')===String(reference) ? [{id:orderId,reference_id:reference}] : []});
    case '/admin/v2/orders/'+orderId:
      assert.equal(url.searchParams.get('format'),'light');
      return Response.json({data:{id:orderId,reference_id:reference,status:{name:'قيد التجهيز'},customer:{name:'Synthetic fixture'}}});
    case '/admin/v2/orders/items':
      assert.equal(url.searchParams.get('order_id'),String(orderId));
      return Response.json({data:other
        ? [{name:'منتج المتجر الآخر',quantity:1,sku:'OTHER',product_id:70}]
        : [{name:'خاتم',quantity:2,sku:'RING',product_id:40,options:[{name:'المقاس',value:{name:'16'}}]}]});
    default:
      assert.fail('Unexpected outbound path');
  }
};

const origin = 'https://scanner.example.test';
let cookie = '';
function call(path, {method='GET',body,headers={},url=origin}={}) {
  return worker.fetch(new Request(url+path,{method,body,headers:{Cookie:cookie,...headers}}),env,context);
}
const post = (path,body,headers={})=>call(path,{method:'POST',body:JSON.stringify(body),headers:{Origin:origin,...headers}});
const lookup = (tracking,reference,brandId)=>post('/api/lookup',{tracking,reference,brandId});
function event(eventType, merchant=10, created_at='2026-11-15 12:00:00', valid=true, payload) {
  const body = JSON.stringify({event:eventType,merchant,created_at,data:payload??{
    access_token:merchant===11?'synthetic-other':'synthetic-access',refresh_token:'synthetic-refresh',
    expires:Math.floor(Date.now()/1000)+1200,scope:'orders.read shipping.read offline_access',
  }});
  return call('/webhooks/salla',{method:'POST',body,headers:{
    'x-salla-signature':createHmac('sha256',valid?env.SALLA_WEBHOOK_SECRET:'wrong').update(body).digest('hex'),
  }});
}

assert.equal(await (await call('/')).text(),'/index.html');
assert.equal(await (await call('/scan')).text(),'/scan.html');
assert.equal((await call('/api/session')).status,401);
assert.equal((await post('/api/login',{code:env.SCANNER_ACCESS_CODE},{Origin:'https://outside.example.test'})).status,403);
assert.equal((await post('/api/login',{code:'wrong'})).status,401);
const login = await post('/api/login',{code:env.SCANNER_ACCESS_CODE});
assert.equal(login.status,200);
assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict; Max-Age=43200; Secure/);
cookie = login.headers.get('set-cookie').split(';')[0];
assert.deepEqual(await (await call('/api/session')).json(),{brands:[{id:'wassan',name:'وسن',connected:false}],demo:false});
assert.equal((await lookup('AY0000001234')).status,503);
assert.equal((await post('/api/lookup',{brandId:'wassan',tracking:'RT0000001234',mode:'return'})).status,404);
assert.equal((await event('app.store.authorize',10,undefined,false)).status,401);
assert.equal((await event('app.store.authorize',11)).status,403);
assert.equal((await event('app.store.authorize')).status,204);
await Promise.all(waiters.splice(0));
assert.doesNotMatch(database.prepare('SELECT credentials FROM salla_connections').get().credentials,/synthetic-/);

const matched = await lookup('ay٠٠٠٠٠٠١٢٣٤');
assert.equal(matched.status,200);
const order = await matched.json();
assert.equal(order.ref,'100001');
assert.equal(order.status,'قيد التجهيز');
assert.deepEqual(order.items[0].options,[{name:'المقاس',value:'16'}]);
assert.equal(order.items[0].quantity,2);
assert.equal(Object.hasOwn(order,'customer'),false);
assert.equal(database.prepare('SELECT count(*) AS count FROM salla_order_products').get().count,1);
assert.equal((await lookup('https://unknown.example.test/AY0000001234')).status,400);
assert.equal((await lookup('AY9999999999','100001')).status,409);
duplicate = true;
await worker.scheduled({scheduledTime:0},env);
assert.equal((await lookup('AY0000001234')).status,409);
assert.equal((await lookup('AY0000001234','100001')).status,200);
assert.equal((await event('app.uninstalled',10,'2026-11-15 12:01:00')).status,204);
assert.equal((await event('app.store.authorize')).status,204);
assert.equal((await lookup('AY0000001234')).status,503);
assert.equal((await post('/api/lookup',{brandId:'wassan',tracking:'RT0000001234',mode:'return'})).status,404);
assert.equal(database.prepare('SELECT count(*) AS count FROM salla_order_products').get().count,0);

const brands = [{id:'wassan',name:'وسن',merchantId:'10'},{id:'other',name:'متجر آخر',merchantId:'11'}];
env.SCANNER_BRANDS = JSON.stringify(brands);
duplicate = false;
assert.equal((await event('app.store.authorize',10,'2026-11-15 12:02:00')).status,204);
assert.equal((await event('app.store.authorize',11)).status,204);
await Promise.all(waiters.splice(0));
assert.deepEqual(await (await call('/api/session')).json(),{
  brands:[{id:'wassan',name:'وسن',connected:true},{id:'other',name:'متجر آخر',connected:true}],demo:false,
});
const beforeInvalidLookup = outboundRequests;
assert.equal((await lookup('AY0000001234')).status,400);
assert.equal((await lookup('AY0000001234',undefined,'unknown')).status,403);
assert.equal(outboundRequests,beforeInvalidLookup);
for (const [brandId,ref,sku] of [['wassan','100001','RING'],['other','200001','OTHER']]) {
  const response = await lookup('AY0000001234',undefined,brandId);
  assert.equal(response.status,200);
  const result = await response.json();
  assert.equal(result.brandId,brandId);
  assert.equal(result.ref,ref);
  assert.equal(result.items[0].sku,sku);
}
assert.equal((await lookup('AY0000001234','100001','other')).status,404);
const beforeSchedule = outboundRequests;
await worker.scheduled({scheduledTime:15*60*1000},env);
assert.equal(outboundRequests,beforeSchedule+1);
assert.equal((await event('app.uninstalled',11,'2026-11-15 12:01:00')).status,204);
assert.equal((await lookup('AY0000001234',undefined,'other')).status,503);
assert.equal((await lookup('AY0000001234',undefined,'wassan')).status,200);
assert.deepEqual(database.prepare('SELECT DISTINCT brand_id FROM salla_order_products').all().map(record=>record.brand_id),['wassan']);
env.SCANNER_BRANDS = [brands[0],{...brands[1],merchantId:'10'}];
assert.equal((await call('/api/session')).status,503);
env.SCANNER_BRANDS = [brands[0],{...brands[1],shipmentSource:'webhook'}];
const eventTime = offset=>new Date(Date.now()+offset*1000).toISOString().slice(0,19).replace('T',' ');
const demoAuth = {
  access_token:'synthetic-other',refresh_token:'synthetic-refresh',
  expires:Math.floor(Date.now()/1000)+1200,scope:'orders.read webhooks.read_write offline_access',
};
const demoLabel = {id:50,order_id:60,type:'shipment',tracking_number:'SALLA-DEMO-2026',shipping_number:'DEMO-LABEL-2026',status:'created'};
assert.equal((await event('app.store.authorize',11,eventTime(-20),true,{...demoAuth,scope:demoAuth.scope+' orders.read_write'})).status,400);
assert.equal((await event('app.store.authorize',11,eventTime(-20),true,demoAuth)).status,204);
await Promise.all(waiters.splice(0));
assert.equal((await lookup(demoLabel.tracking_number,undefined,'other')).status,404);
assert.equal((await event('shipment.created',11,eventTime(-19),false,demoLabel)).status,401);
assert.equal((await event('shipment.created',11,eventTime(-19),true,demoLabel)).status,204);
const beforeEventLookup = outboundRequests;
const demoOrder = await lookup(demoLabel.shipping_number,undefined,'other');
assert.equal(demoOrder.status,200);
assert.equal((await demoOrder.json()).ref,'200001');
assert.equal(outboundRequests,beforeEventLookup+2);
const updatedLabel = {...demoLabel,tracking_number:'NEW-DEMO-2026',shipping_number:null};
assert.equal((await event('shipment.updated',11,eventTime(-18),true,updatedLabel)).status,204);
assert.equal((await lookup(demoLabel.shipping_number,undefined,'other')).status,404);
assert.equal((await lookup(updatedLabel.tracking_number,undefined,'other')).status,200);
assert.equal((await event('shipment.cancelled',11,eventTime(-17),true,{id:50})).status,204);
assert.equal((await event('shipment.created',11,eventTime(-19),true,demoLabel)).status,204);
assert.equal((await lookup(updatedLabel.tracking_number,undefined,'other')).status,404);
assert.equal((await lookup(demoLabel.tracking_number,undefined,'other')).status,404);
assert.equal((await event('app.uninstalled',11,eventTime(-16))).status,204);
assert.equal(database.prepare("SELECT count(*) AS n FROM salla_shipment_events WHERE brand_id='other'").get().n,0);
delete env.SCANNER_BRANDS;
assert.equal((await post('/api/logout',{})).status,200);
assert.equal((await call('/api/session')).status,401);
env.SCANNER_DEMO='true';
const local='http://127.0.0.1:5174';
async function demoRequest(path, data) {
  return call(path,{url:local,method:'POST',headers:{Origin:local,'Content-Type':'application/json'},body:JSON.stringify(data)});
}
const demoLogin=await demoRequest('/api/login',{code:'demo-masar'});
assert.equal(demoLogin.status,200);
cookie=demoLogin.headers.get('set-cookie').split(';')[0];
const returned=await demoRequest('/api/lookup',{brandId:'wassan',tracking:'RT0000001234',mode:'return'});
assert.equal(returned.status,200);
assert.equal((await returned.json()).ref,'100002');
assert.equal((await demoRequest('/api/lookup',{brandId:'wassan',tracking:'AY0000001234',mode:'return'})).status,404);
assert.equal((await demoRequest('/api/lookup',{brandId:'wassan',tracking:'RT0000001234'})).status,404);
console.log('PASS scanner assets, sessions, Salla lookup, shipment webhooks, brand isolation, variants, duplicate tracking, and per-store uninstall');
