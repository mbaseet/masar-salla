import {createRequire} from 'node:module';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {fixturePdf} from './pdf-fixtures.mjs';
const require=createRequire(import.meta.url);
const {chromium}=require(process.env.PLAYWRIGHT_MODULE??'/private/tmp/salla-browser/node_modules/playwright-core');
const origin='http://127.0.0.1:5173';
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
let checks=0;const pass=name=>console.log(`PASS UX ${++checks}: ${name}`);
await mkdir('.sites-runtime/ux',{recursive:true});
try{
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ar-SA'});
 const page=await context.newPage();page.setDefaultTimeout(30000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const allFiles=async()=>await (await page.request.get(`${origin}/api/files`)).json();
 const readyQueue=async count=>await page.waitForFunction(expected=>document.querySelectorAll('.upload-entry.entry-done').length===expected,count,{timeout:180000});
 const returnBoard=async()=>{await page.getByRole('button',{name:'العودة إلى اللوحة',exact:true}).click();await page.locator('.upload-dialog').waitFor({state:'detached'});await page.locator('.file-panel').waitFor({state:'detached'});await page.locator('.column-add').waitFor();};
 await page.goto(`${origin}/auth/login`,{waitUntil:'networkidle'});await page.getByRole('heading',{name:/بوالص وسن/}).waitFor();
 for(const f of (await allFiles()).files.filter(f=>f.name.startsWith('UI-')||f.name==='وسن.pdf'))await page.request.delete(`${origin}/api/files/${f.id}`,{data:{confirm:true}});
 await page.reload();await page.locator('.column-add').waitFor();
 assert.equal(await page.locator('html').getAttribute('dir'),'rtl');assert.ok(await page.locator('.column-awaiting .waybill-card').count()>0);
 await page.locator('.column-add').click();assert.notEqual(await page.locator('input[type=file]').getAttribute('multiple'),null);
 const real=[];for(const count of [226,26]){const {name}=JSON.parse(await readFile(`.sites-runtime/sample-records/${count}.json`,'utf8'));real.push({name:`UI-batch-${count}.pdf`,mimeType:'application/pdf',buffer:await readFile(`../sample waybills/${name}`)});}
 await page.locator('input[type=file]').setInputFiles(real);assert.equal(await page.locator('.upload-entry').count(),2);await page.getByRole('button',{name:/رفع وفحص/}).click();await readyQueue(2);
 await page.screenshot({path:'.sites-runtime/ux/batch-desktop.png'});await returnBoard();
 let files=(await allFiles()).files;const uploaded=files.filter(f=>f.name.startsWith('UI-batch-'));assert.equal(uploaded.length,2);assert.ok(uploaded.every(f=>f.stage==='awaiting'&&f.status==='ready'));
 pass('two real PDFs selected together produce two ready cards in an already occupied first column');
 await page.locator('.column-add').click();
 // Drag/drop, a damaged file, and a recoverable server error in the same batch.
 let shouldFail=true;await page.route('**/api/files/*/process',async route=>{if(shouldFail){shouldFail=false;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'QA transient failure'})});}else await route.continue();});
 const transfer=await page.evaluateHandle(items=>{const d=new DataTransfer();for(const i of items)d.items.add(new File([new Uint8Array(i.bytes)],i.name,{type:'application/pdf'}));return d;},[{name:'UI-damaged.pdf',bytes:[...Buffer.from('%PDF-1.7\nbroken')]},{name:'UI-retry.pdf',bytes:[...fixturePdf([1],940000001)]},{name:'UI-continued.pdf',bytes:[...fixturePdf([1],940000002)]}]);
 await page.locator('.upload-drop').dispatchEvent('drop',{dataTransfer:transfer});await transfer.dispose();assert.equal(await page.locator('.upload-entry').count(),3);
 await page.getByRole('button',{name:/رفع وفحص/}).click();await page.getByRole('button',{name:'إعادة محاولة الملفات المتبقية'}).waitFor({timeout:180000});
 assert.equal(await page.locator('.entry-error').count(),2);assert.equal(await page.locator('.entry-done').count(),1);const beforeRetry=(await allFiles()).files.length;
 await page.getByRole('button',{name:'إعادة محاولة الملفات المتبقية'}).click();await readyQueue(2);await page.getByRole('button',{name:'إعادة محاولة الملفات المتبقية'}).waitFor();assert.equal((await allFiles()).files.length,beforeRetry);assert.equal(await page.locator('.entry-error').count(),1);await returnBoard();await page.unroute('**/api/files/*/process');
 pass('drop accepts every file, failed files do not stop the queue, and retry does not duplicate successful cards');
 // One identifier on the first page verifies the entire file; minority quantities remain visible after resolution.
 await page.locator('.column-add').click();await page.locator('input[type=file]').setInputFiles({name:'UI-minority.pdf',mimeType:'application/pdf',buffer:fixturePdf([1,1,4],950000001)});await page.getByRole('button',{name:/رفع وفحص/}).click();await readyQueue(1);await page.getByRole('button',{name:'مراجعة الملف',exact:true}).click();
 await page.locator('.quantity-attention').waitFor();assert.ok((await page.locator('.quantity-attention').innerText()).includes('950000003'));assert.equal(await page.locator('.quantity-exception-row').count(),1);assert.ok((await page.locator('.quantity-attention').innerText()).includes('٤'));
 await page.getByRole('button',{name:'معالجة التنبيهات المفتوحة',exact:true}).click();await page.getByRole('textbox',{name:'ملاحظة معالجة التنبيه'}).fill('تمت مراجعة الكمية وتجهيز أربع قطع.');await page.getByRole('button',{name:'حفظ المعالجة',exact:true}).click();await page.getByText('لا توجد تنبيهات مفتوحة',{exact:true}).waitFor();assert.equal(await page.locator('.quantity-exception-row').count(),1);await page.locator('.quantity-attention').waitFor();
 await page.getByRole('button',{name:'تأكيد الطباعة',exact:true}).click();await page.getByRole('button',{name:'نعم، تمت الطباعة',exact:true}).click();await page.getByText('تم تأكيد الطباعة',{exact:true}).waitFor();
 const file=(await allFiles()).files.find(f=>f.name==='UI-minority.pdf');assert.equal(file.quantity_attention,1);assert.equal(file.open_issues,0);assert.equal(file.stage,'printed');
 await page.screenshot({path:'.sites-runtime/ux/quantity-resolved-desktop.png'});await returnBoard();await page.reload();await page.locator('.waybill-card').filter({hasText:'UI-minority.pdf'}).getByRole('button').click();await page.locator('.quantity-attention').waitFor();
 const attention=await page.context().newPage();await attention.goto(`${origin}/attention?file=${file.id}`);await attention.getByText('950000003',{exact:true}).waitFor();assert.equal(await attention.locator('.quantity-exception-row').count(),1);await attention.close();
 pass('minority Ref/page/quantity stays highlighted after UI resolution, printing, reopening, reload and in the attention sheet');
 // Cancellation notes still work with the new review panel.
 await page.getByRole('tab',{name:/الملاحظات/}).click();await page.getByRole('textbox',{name:'رقم الطلب (اختياري)'}).fill('950000003');await page.getByRole('textbox',{name:'نص الملاحظة'}).fill('إلغاء هذا الطلب بعد الطباعة');await page.getByRole('button',{name:'إضافة الملاحظة',exact:true}).click();await page.getByText('تعديل بعد الطباعة',{exact:true}).first().waitFor();await page.getByRole('button',{name:'راجعت التعديلات'}).click();await page.getByText('تم تأكيد مراجعة التغييرات',{exact:true}).waitFor();
 pass('post-print note and acknowledgment still work in the revised panel');
 // Delete cancellation first, then confirm; scope deletes only this test upload.
 await page.getByRole('button',{name:'حذف الملف',exact:true}).click();await page.getByRole('button',{name:'الاحتفاظ بالملف'}).click();assert.ok((await allFiles()).files.some(f=>f.id===file.id));
 await page.getByRole('button',{name:'حذف الملف',exact:true}).click();await page.getByRole('button',{name:'حذف نهائي',exact:true}).click();await page.getByText('حُذف الملف من اللوحة والتخزين',{exact:true}).waitFor();assert.ok(!(await allFiles()).files.some(f=>f.id===file.id));assert.equal((await page.request.get(`${origin}/api/files/${file.id}/download`)).status(),404);
 pass('deletion cancel preserves the file; confirmation removes its card and download access');
 // Mobile layout and keyboard escape: no full-page horizontal overflow or clipped action buttons.
 await page.setViewportSize({width:390,height:844});await page.locator('.column-add').click();await page.locator('input[type=file]').setInputFiles([{name:'UI-وسن.pdf',mimeType:'application/pdf',buffer:fixturePdf([1,1],960000001,'')}]);await page.getByRole('button',{name:/رفع وفحص/}).click();await readyQueue(1);
 await page.screenshot({path:'.sites-runtime/ux/batch-mobile.png'});const bounds=await page.locator('[data-slot=dialog-content]').boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=845);await page.getByRole('button',{name:'مراجعة الملف',exact:true}).click();await page.getByText('لا توجد تنبيهات مفتوحة',{exact:true}).waitFor();assert.ok(!(await page.locator('.panel-scroll').innerText()).includes('لم توجد كلمة تعريف'));await returnBoard();
 const widths=await page.evaluate(()=>({viewport:innerWidth,page:document.documentElement.scrollWidth}));assert.ok(widths.page<=widths.viewport+1);await page.locator('.column-add').click();await page.keyboard.press('Escape');await page.locator('.upload-dialog').waitFor({state:'detached'});
 pass('filename-only matching and mobile upload/review/back/keyboard-close controls work without page overflow');
 assert.deepEqual(errors,[]);await writeFile('.sites-runtime/ux/results.json',JSON.stringify({checks,uncaughtErrors:errors}));console.log(`Browser UX complete: ${checks} scenarios passed.`);
}finally{await browser.close();}
