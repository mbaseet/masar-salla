import {readdir,readFile,mkdir,writeFile} from 'node:fs/promises';
import {PDFiumLibrary} from '@hyzyla/pdfium';
import assert from 'node:assert/strict';
import {detectPage,analyzePages} from '../lib/domain.ts';
const brands=[{id:'wassan',identifiers:['Wasn Saudi','wasnbrand.com','وسن','اليقاظة']}];
const library=await PDFiumLibrary.init();
const files=(await readdir('../sample waybills')).filter(f=>f.endsWith('.pdf'));
const expected=new Map([[226,'single'],[836,'single'],[26,'multiple'],[85,'multiple'],[6,'unknown']]);
await mkdir('.sites-runtime/sample-records',{recursive:true});
let total=0;const refs=new Set<string>();
for(const [index,name] of files.entries()) {
 const started=performance.now(),bytes=await readFile(`../sample waybills/${name}`),doc=await library.loadDocument(bytes),pages=[];
 for(let i=0;i<doc.getPageCount();i++) {const p=doc.getPage(i);pages.push(detectPage(p.getText(),i+1,brands));const internals=p as unknown as {module:{_FPDF_ClosePage:(id:number)=>void};pageIdx:number};internals.module._FPDF_ClosePage(internals.pageIdx);}
 doc.destroy();const result=analyzePages(pages,'wassan',null,name,brands);
 assert.equal(result.bucket,expected.get(pages.length));assert.equal(result.waybillCount,pages.length===6?3:pages.length);
 const kinds=[...new Set(result.findings.map(f=>f.kind))];
 assert.deepEqual(kinds.sort(),pages.length===6?['quantity_unknown']:[]);
 total+=pages.length;pages.flatMap(p=>p.refs).forEach(ref=>refs.add(ref));
 // Ignored local QA state: minimal detection fields only, never raw extracted text.
 await writeFile(`.sites-runtime/sample-records/${pages.length}.json`,JSON.stringify({name,pages}));
 console.log(JSON.stringify({sample:index+1,pages:pages.length,waybills:result.waybillCount,bucket:result.bucket,findings:result.findings.length,seconds:Number(((performance.now()-started)/1000).toFixed(2))}));
}
library.destroy();assert.equal(total,1179);assert.equal(refs.size,1176);console.log('All five samples verified: 1,179 pages / 1,176 orders.');
