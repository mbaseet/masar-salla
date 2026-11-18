// Run after scripts/prepare-pdf-assets.mjs. All storage and SQL here are in memory.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { fixturePdf } from './pdf-fixtures.mjs';

const root = new URL('../',import.meta.url);
const database = new DatabaseSync(':memory:');
for (const name of (await readdir(new URL('drizzle/',root))).filter(n=>n.endsWith('.sql')).sort()) {
  database.exec(await readFile(new URL(`drizzle/${name}`,root),'utf8'));
}
const objects = new Map();
let onRead;
const bindings = {
  INITIAL_ADMIN_EMAIL:'admin@example.test',
  DB:{
    prepare(query) {
      return {
        bind(...args) {
          const statement=database.prepare(query);
          return {
            first:async()=>statement.get(...args)??null,
            all:async()=>({results:statement.all(...args)}),
            run:()=>({meta:{changes:Number(statement.run(...args).changes)}}),
          };
        },
      };
    },
    async batch(statements) {
      database.exec('BEGIN');
      try {
        // D1 batches are sequential. Do not yield between statements in this adapter.
        const results=statements.map(statement=>statement.run());
        database.exec('COMMIT');
        return results;
      } catch(error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  },
  BUCKET:{
    async get(key) {
      const bytes=objects.get(key);
      if (!bytes) return null;
      const beforeRead=onRead;
      onRead=undefined;
      if(beforeRead) await beforeRead();
      return {body:new Blob([bytes]).stream(),size:bytes.length};
    },
    async delete(key) { objects.delete(key); },
  },
};
globalThis.testPrintBindings=bindings;
const binaries=new Map();
for(const name of ['pdfium','writer']) {
  binaries.set(name,new WebAssembly.Module(await readFile(new URL(`build/pdf-engine/${name}.wasm`,root))));
}
globalThis.testPrintModules=binaries;
registerHooks({
  resolve(specifier,context,next) {
    if(specifier==='@hyzyla/pdfium/dist/index.esm.browser.js') return next('@hyzyla/pdfium',context);
    if(specifier==='cloudflare:workers') return {url:'data:text/javascript,export const env=globalThis.testPrintBindings',shortCircuit:true};
    if(specifier.endsWith('.wasm')) {
      const name=specifier.split('/').at(-1).replace('.wasm','');
      return {url:`data:text/javascript,export default globalThis.testPrintModules.get("${name}")`,shortCircuit:true};
    }
    if(specifier.startsWith('@/')) return next(new URL(`${specifier.slice(2)}.ts`,root).href,context);
    if(specifier.startsWith('.')&&!/\.[a-z]+$/i.test(specifier)&&context.parentURL?.startsWith(root.href)) return next(`${specifier}.ts`,context);
    return next(specifier,context);
  },
  load(url,context,next) {
    const loaded=next(url,context);
    if(url===new URL('lib/server.ts',root).href) return {...loaded,source:String(loaded.source).replace('import.meta.env.DEV','false')};
    return loaded;
  },
});
const { withIdentity }=await import('../lib/auth-context.ts');
const { withPdf }=await import('../lib/pdf-engine.ts');
const { DEFAULT_COLUMNS, detectPage }=await import('../lib/domain.ts');
const api=await import('../app/api/[...path]/route.ts');

const admin={email:'admin@example.test',name:'Test admin',subject:'admin'};
const first={email:'one@example.test',name:'First operator',subject:'one'};
const second={email:'two@example.test',name:'Second operator',subject:'two'};
const testBrand={id:'wassan',identifiers:['Wasn Saudi']};
const otherBrand={id:'other',identifiers:['Other Store']};

async function call(path,input,identity=first,method=input===undefined?'GET':'POST') {
  const response=await withIdentity(identity,()=>api[method](new Request(`https://test.example/api/${path}`,{
    method,...(input===undefined?{}:{body:JSON.stringify(input),headers:{'Content-Type':'application/json'}}),
  })));
  if(response.headers.get('content-type')?.includes('application/json')) return {status:response.status,...await response.json()};
  return {status:response.status,bytes:Buffer.from(await response.arrayBuffer())};
}
assert.equal((await call('bootstrap',undefined,admin)).status,200);
for(const user of [first,second]) {
  assert.equal((await call('users',{email:user.email,name:user.name,role:'operator'},admin)).status,200);
}
database.prepare('INSERT INTO brands (id,name,color,identifiers,columns,created_at) VALUES (?,?,?,?,?,?)')
  .run(otherBrand.id,'Other','#000000',JSON.stringify(otherBrand.identifiers),JSON.stringify(DEFAULT_COLUMNS),new Date().toISOString());

const inspect=(bytes,action)=>withPdf(binaries.get('pdfium'),binaries.get('writer'),new Blob([bytes]).stream(),bytes.length,action);
async function upload(bytes,brand='wassan') {
  const id=randomUUID();
  assert.equal((await call('files',{id,brandId:brand,name:'fixture.pdf',size:bytes.length})).status,201);
  const key=`waybills/${id}.pdf`;
  objects.set(key,bytes);
  database.prepare("UPDATE files SET hash=?,status='uploaded' WHERE id=?").run(randomUUID(),id);
  const result=await call(`files/${id}/recheck`,{});
  assert.equal(result.status,200,result.error);
  return `files/${id}`;
}
async function refs(bytes) {
  return inspect(bytes,pdf=>Array.from({length:pdf.count},(_,i)=>detectPage(pdf.text(i+1),i+1,[testBrand,otherBrand]).refs[0]));
}

const workflowPdf=fixturePdf([1,1],907000001);
const workflowFile=await upload(workflowPdf);
assert.equal((await call(`${workflowFile}/move`,{stage:'prepared'})).status,409);
assert.equal((await call(`${workflowFile}/move`,{stage:'prepared',fromStage:'awaiting',confirmed:true})).status,200);
assert.equal((await call(workflowFile)).file.printed_at,null);
assert.equal((await call(`${workflowFile}/move`,{stage:'printed',fromStage:'awaiting',confirmed:true})).status,409);
assert.equal((await call(`${workflowFile}/move`,{stage:'printed',fromStage:'prepared',confirmed:true})).status,200);
assert.equal((await call(workflowFile)).file.stage,'printed');
const label={text:'أولوية اليوم',color:'pink'};
assert.equal((await call(`${workflowFile}/label`,{label:{...label,color:'red'}})).status,400);
assert.equal((await call(`${workflowFile}/label`,{label})).status,200);
assert.equal((await call(workflowFile,undefined,second)).file.label_text,label.text);
assert.equal((await call(workflowFile,undefined,second)).file.label_color,label.color);
assert.equal((await call(`${workflowFile}/label`,{label:null})).status,200);
assert.equal((await call(workflowFile)).file.label_text,null);
const copiedFile=await upload(Buffer.concat([workflowPdf,Buffer.from('\n% regenerated\n')]));
const duplicateFindings=(await call(copiedFile)).findings;
assert.deepEqual(duplicateFindings.map(f=>f.kind),['duplicate_file']);
assert.equal((await call(copiedFile)).file.duplicate_files,1);
assert.deepEqual((await call(workflowFile)).findings.map(f=>f.kind),['duplicate_file']);
assert.equal((await call('findings',{ids:duplicateFindings.map(f=>f.id),status:'voided'})).status,200);
assert.equal((await call(copiedFile)).findings[0].resolution_note,null);
assert.equal((await call(copiedFile)).file.open_issues,0);
const partialFile=await upload(fixturePdf([1],907000001));
assert.ok((await call(partialFile)).findings.every(f=>f.kind==='duplicate_order'));
assert.equal((await call(partialFile)).file.open_issues,2);
console.log('PASS confirmed stage moves, label validation and persistence, consolidated duplicate files, partial overlap and optional resolution notes');

const original=fixturePdf([1,1,1],910000001);
const file=await upload(original);
const snapshot=await call(`${file}/print-plan`);
assert.equal(snapshot.printable,3);
assert.equal((await call(`${file}/preview?page=1`)).status,200);
assert.equal((await call(`${file}/original`,{})).status,403);
assert.deepEqual((await call(`${file}/original`,{},admin)).bytes,original);

// Admin export creates prior-copy history, so an operator has to reconcile it.
const prior=await call(`${file}/shipment`,{page:1,action:'reserve'});
assert.equal(typeof prior.reconcile,'string');
const reservation=await call(`${file}/shipment`,{page:1,action:'reserve',priorCopy:prior.reconcile});
assert.equal(reservation.status,200,reservation.error);
assert.equal((await call(`${file}/preview?page=1`)).status,409);
assert.equal((await call(`${file}/early-label`,{page:1},second)).status,409);
assert.deepEqual(await refs((await call(`${file}/early-label`,{page:1})).bytes),['910000001']);
const hold=(await call(`${file}/print-plan`)).pages[0].shipment;
assert.equal(hold.state,'reserved');
assert.equal((await call(`${file}/shipment`,{page:1,action:'ship',expectedAt:hold.at},second)).status,200);
assert.deepEqual(await refs((await call(`${file}/print-batch`,{})).bytes),['910000002','910000003']);
assert.equal((await call(file)).file.stage,'awaiting');
const batch=(await call(`${file}/print-plan`)).batch;
assert.equal((await call(`${file}/page-exclusion`,{page:2,exclude:true})).status,200);
assert.equal((await call(`${file}/printed`,{batchId:batch.id})).status,409);
assert.deepEqual(await refs((await call(`${file}/download?purpose=inspect`)).bytes),['910000003']);
assert.equal((await call(`${file}/page-exclusion`,{page:2,exclude:false})).status,200);
assert.deepEqual(await refs((await call(`${file}/print-batch`,{})).bytes),['910000002','910000003']);
const current=(await call(`${file}/print-plan`)).batch;
assert.equal(current.confirmed,false);
assert.equal((await call(`${file}/printed`,{batchId:current.id})).status,200);
assert.equal((await call(file)).file.stage,'printed');
assert.equal((await call(`${file}/print-plan`)).batch.confirmed,true);
assert.equal((await call(`${file}/print-batch`,{})).status,200);
assert.equal((await call(`${file}/print-plan`)).batch.confirmed,false);

const duplicate=await upload(original);
assert.equal((await call(`${duplicate}/print-plan`)).pages[0].shipment.state,'shipped');
assert.equal((await call(file,{confirm:true},first,'DELETE')).status,200);
assert.equal((await call(`${duplicate}/print-plan`)).pages[0].shipment.state,'shipped');
assert.equal((await call(`${duplicate}/process`,{pages:[detectPage('RedBox Ref # 999',1,[testBrand])]})).status,200);
assert.equal((await call(`${duplicate}/print-plan`)).pages[0].shipment.state,'shipped');
assert.equal((await call(`${duplicate}/recheck`,{})).status,200);
assert.equal((await call(`${duplicate}/print-plan`)).pages[0].shipment.state,'shipped');

const changedTracking=Buffer.from(original.toString().replace('Trk # 910000101','Trk # 999999101'));
const replacement=await upload(changedTracking);
assert.equal((await call(`${replacement}/print-plan`)).pages[0].shipment.state,'tracking_review');
assert.equal((await call(`${replacement}/shipment`,{page:1,action:'clear_tracking'})).status,200);
assert.equal((await call(`${replacement}/print-plan`)).pages[0].shipment,null);
const isolated=await upload(fixturePdf([1],910000001,'Other Store'),'other');
assert.equal((await call(`${isolated}/print-plan`)).printable,1);
console.log('PASS original access, early dispatch, filtered output, stale confirmation, reupload, deletion, recheck, tracking review and brand isolation');

const race=await upload(fixturePdf([1,1],920000001));
onRead=async()=>{
  const won=await call(`${race}/shipment`,{page:2,action:'reserve'},second);
  assert.equal(won.status,200,won.error);
};
assert.equal((await call(`${race}/print-batch`,{})).status,409);
const held=(await call(`${race}/print-plan`)).pages[1].shipment;
assert.equal((await call(`${race}/shipment`,{page:2,action:'reserve'})).status,409);
assert.equal((await call(`${race}/shipment`,{page:2,action:'release',expectedAt:held.at})).status,409);
assert.equal((await call(`${race}/shipment`,{page:2,action:'release',expectedAt:held.at},second)).status,200);
assert.equal((await call(`${race}/print-plan`)).printable,2);
await call(`${race}/print-batch`,{});
const stale=(await call(`${race}/shipment`,{page:2,action:'reserve'})).reconcile;
await new Promise(resolve=>setTimeout(resolve,5));
await call(`${race}/print-batch`,{});
const renewed=(await call(`${race}/shipment`,{page:2,action:'reserve',priorCopy:stale})).reconcile;
assert.ok(renewed&&renewed!==stale);
assert.equal((await call(`${race}/shipment`,{page:2,action:'reserve',priorCopy:renewed})).status,200);
const single=await upload(fixturePdf([1],925000001));
assert.equal((await call(`${single}/shipment`,{page:1,action:'ship'})).status,200);
assert.equal((await call(`${single}/print-plan`)).printable,0);
assert.equal((await call(`${single}/print-batch`,{})).status,409);
console.log('PASS atomic issuance during reservation, operator ownership, release, prior-copy reconciliation and stale reconciliation');

const bulkA = await upload(fixturePdf(Array(51).fill(1), 930000001));
const bulkB = await upload(fixturePdf(Array(51).fill(1), 930000101));
const bulkCopy = await upload(fixturePdf([1,1],930000001));
const bulkOther = await upload(fixturePdf([1],930000001,'Other Store'),'other');
const numbers = [930000001,930000101].flatMap(start => Array.from({length:50},(_,i)=>String(start+i)));
const searchBulk = async refs => call('search',{brandId:'wassan',refs:refs.join('\n')});
const foundBulk = await searchBulk([...numbers,'939999999']);
assert.equal(foundBulk.status,200,foundBulk.error);
assert.deepEqual(foundBulk.missing,['939999999']);
assert.equal(foundBulk.results.length,102);
assert.ok(foundBulk.results.every(row=>row.brand_id==='wassan'));
const orders = foundBulk.bulkMatches.filter(row=>row.state==='eligible').map(({ref,tracking})=>({ref,tracking}));
assert.equal(orders.length,100);
const payload = {brandId:'wassan',orders};
assert.equal((await call('search/ship',payload,{email:'unknown@example.test',subject:'unknown',name:'Unknown'})).status,403);
assert.equal((await call('search/ship',{brandId:'wassan',orders:[orders[0],orders[0]]})).status,400);
const staleOrders = orders.map((order,i)=>i===0?{...order,tracking:'wrong'}:order);
assert.equal((await call('search/ship',{brandId:'wassan',orders:staleOrders})).status,409);
assert.equal((await call(`${bulkA}/print-plan`)).printable,51);
assert.equal((await call(`${bulkB}/print-plan`)).printable,51);
await call(`${bulkB}/print-batch`,{});
const oldBulkBatch = (await call(`${bulkB}/print-plan`)).batch;
assert.equal((await call(`${bulkB}/printed`,{batchId:oldBulkBatch.id})).status,200);
// If bulk recording wins while a copy is being prepared, no stale PDF is served.
onRead = async () => {
  assert.deepEqual(await call('search/ship',payload,second),{status:200,shipped:100});
};
assert.equal((await call(`${bulkA}/print-batch`,{})).status,409);
assert.deepEqual(await call('search/ship',payload),{status:200,shipped:0});
assert.deepEqual(await refs((await call(`${bulkA}/print-batch`,{})).bytes),['930000051']);
assert.deepEqual(await refs((await call(`${bulkB}/print-batch`,{})).bytes),['930000151']);
assert.equal((await call(`${bulkCopy}/print-plan`)).printable,0);
assert.equal((await call(`${bulkOther}/print-plan`)).printable,1);
assert.equal((await call(bulkA)).file.stage,'awaiting');
const printedBulkFile = (await call(bulkB)).file;
assert.equal(printedBulkFile.stage,'printed');
assert.equal(printedBulkFile.changed_version,1);
assert.equal((await call(`${bulkB}/printed`,{batchId:oldBulkBatch.id})).status,409);
const audit = (await call('audit')).events.filter(event=>event.action==='bulk_shipped');
assert.equal(audit.reduce((sum,event)=>sum+JSON.parse(event.detail).count,0),100);
assert.ok((await searchBulk(numbers)).bulkMatches.every(row=>row.state==='shipped'));

const bulkConflict = await upload(fixturePdf([1,1,1],931000001));
await upload(Buffer.from(fixturePdf([1],931000001).toString().replace('Trk # 931000101','Trk # 999111222')));
const unknownBrandFile = await upload(fixturePdf([1],932000001,'Unknown sender'));
assert.equal((await call(`${bulkConflict}/shipment`,{page:2,action:'reserve'})).status,200);
const conflictMatches = (await searchBulk(['931000001','931000002','931000003','932000001'])).bulkMatches;
assert.deepEqual(conflictMatches.map(row=>row.state),['tracking_review','reserved','eligible','brand_review']);
assert.equal((await call('search/ship',{brandId:'wassan',orders:[{ref:'931000002',tracking:'931000102'},{ref:'931000003',tracking:'931000103'}]})).status,409);
assert.equal((await call(`${bulkConflict}/print-plan`)).pages[2].shipment,null);
assert.equal((await call(`${unknownBrandFile}/print-plan`)).pages[0].shipment,null);
const sharedPage = await upload(fixturePdf([1],931000003));
database.prepare("UPDATE pages SET data=json_set(data,'$.refs',json_array('931000003','931000004')) WHERE file_id=?")
  .run(sharedPage.split('/')[1]);
assert.equal((await searchBulk(['931000003'])).bulkMatches[0].state,'page_review');
assert.equal((await call('search/ship',{brandId:'wassan',orders:[{ref:'931000003',tracking:'931000103'}]})).status,409);
console.log('PASS 100-order bulk shipment, duplicate copies, brand isolation, atomic stale selection, audit, retry, filtered bytes and concurrent printing');


const categoryConfig = {
  labels:{single:'قطعة وسن',multiple:'عدة قطع'},
  products:[
    {id:'bracelet',name:'سوار',keys:['111','BRACELET']},
    {id:'ring',name:'خاتم',keys:['222','RING']},
    {id:'third',name:'المنتج الثالث',keys:['333']},
  ],
  rules:[
    {id:'bracelet-one',name:'سوار واحد',products:['bracelet'],quantity:'one'},
    {id:'bracelet-more',name:'عدة أساور',products:['bracelet'],quantity:'multiple'},
    {id:'ring-only',name:'خاتم فقط',products:['ring'],quantity:'any'},
    {id:'both',name:'سوار وخاتم',products:['bracelet','ring'],quantity:'any'},
  ],
};
const currentBrand = (await call('bootstrap',undefined,admin)).brands.find(brand=>brand.id==='wassan');
assert.equal((await call('brands/wassan',{...currentBrand,orderCategories:categoryConfig},first)).status,403);
const savedBrand = await call('brands/wassan',{...currentBrand,orderCategories:categoryConfig},admin);
assert.equal(savedBrand.status,200,savedBrand.error);
assert.deepEqual(savedBrand.brands.find(brand=>brand.id==='wassan').orderCategories,categoryConfig);
assert.equal(savedBrand.brands.find(brand=>brand.id==='other').orderCategories,undefined);
const categorized = await upload(fixturePdf([1,2,2,3,1],933000001));
const expires = Math.floor(Date.now()/1000)+600;
database.prepare("INSERT INTO salla_connections(brand_id,merchant_id,credentials,expires_at,event_at) VALUES ('wassan','10','fixture',?,'now')").run(expires);
const cache = database.prepare("INSERT INTO salla_order_products(brand_id,ref,products,expires_at) VALUES ('wassan',?,?,?)");
const item = (productId,sku,quantity)=>({productId,sku,quantity});
cache.run('933000001',JSON.stringify([item('111',null,1)]),expires);
cache.run('933000002',JSON.stringify([item(null,'bracelet',2)]),expires);
cache.run('933000003',JSON.stringify([item('111',null,1),item('222',null,1)]),expires);
cache.run('933000004',JSON.stringify([item('111',null,1),item('222',null,1),item('333',null,1)]),expires);
cache.run('933000005',JSON.stringify([item('222',null,1)]),expires-1200);
const summary = {counts:{'bracelet-one':1,'bracelet-more':1,both:1},manual:null,unclassified:2};
assert.deepEqual((await call(categorized)).file.categories,summary);
const all = await call('files?brand=wassan');
assert.deepEqual(all.files.find(file=>file.id===categorized.split('/')[1]).categories,summary);
assert.equal((await call(categorized+'/category',{ruleId:'unknown'})).status,409);
assert.equal((await call(categorized+'/category',{ruleId:'ring-only'})).status,200);
assert.equal((await call(categorized)).file.categories.manual,'ring-only');
assert.equal((await call(categorized+'/category',{ruleId:null})).status,200);
assert.deepEqual((await call(categorized)).file.categories,summary);
assert.equal((await call(categorized+'/print-plan')).printable,5);
assert.equal((await call(categorized)).audit.filter(event=>event.action==='order_category_changed').length,2);
console.log('PASS brand category settings, exact combinations, expired evidence, manual overrides and unchanged print plan');

const directory=process.env.TEST_PRIVATE_WAYBILLS;
if(directory) {
  const entries=(await readdir(directory)).filter(name=>name.endsWith('.pdf'));
  let linked=false;
  for(const name of entries) {
    const bytes=await readFile(`${directory}/${name}`);
    const source=await inspect(bytes,pdf=>{
      return {count:pdf.count,lastRef:detectPage(pdf.text(pdf.count),pdf.count,[testBrand]).refs[0]};
    });
    const copy=await inspect(bytes,pdf=>pdf.copy(Array.from({length:pdf.count-1},(_,i)=>i+2)));
    const expected=await inspect(bytes,pdf=>pdf.preview(2,1250));
    await inspect(Buffer.from(await new Response(copy.stream).arrayBuffer()),async pdf=>{
      assert.equal(pdf.count,source.count-1);
      assert.deepEqual(await pdf.preview(1,1250),expected);
      assert.equal(detectPage(pdf.text(pdf.count),pdf.count,[testBrand]).refs[0],source.lastRef);
    });
    if(source.count!==6) continue;
    const dhl=await upload(bytes);
    const brandUnknown=database.prepare("SELECT id FROM findings WHERE file_id=? AND kind='brand_unknown'").get(dhl.split('/')[1]);
    if(brandUnknown) await call('findings',{ids:[brandUnknown.id],status:'false_alarm',note:'Synthetic QA confirmation of fixture brand'});
    assert.equal((await call(`${dhl}/shipment`,{page:2,action:'reserve'})).status,200);
    const label=(await call(`${dhl}/early-label`,{page:2})).bytes;
    assert.equal(await inspect(label,pdf=>pdf.count),2);
    assert.equal((await call(`${dhl}/print-plan`)).printable,4);
    const linkedPages = (await call(`${dhl}/print-plan`)).pages.slice(2,4);
    const {ref,tracking} = linkedPages.find(page=>page.role==='label');
    assert.deepEqual(await call('search/ship',{brandId:'wassan',orders:[{ref,tracking}]}),{status:200,shipped:1});
    const revised = await call(`${dhl}/print-plan`);
    assert.ok(revised.pages.slice(2,4).every(page=>page.shipment?.state==='shipped'));
    assert.equal(revised.printable,2);
    linked=true;
  }
  assert.equal(linked,true);
  console.log(`PASS ${entries.length} private inputs, page-copy render comparison, and linked DHL document exclusion`);
}
