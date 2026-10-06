'use client';
import {useEffect,useRef,useState} from 'react';
import {CheckCircle2,FileCheck2,UploadCloud,LoaderCircle,ShieldCheck,X,AlertTriangle} from 'lucide-react';
import {Button} from '@/components/ui/button';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {Progress} from '@/components/ui/progress';
import {MAX_FILE_BYTES,type Brand,type FileCard} from '@/lib/domain';
import {extractPdf} from '@/lib/pdf-client';
import {api,post,n} from '@/lib/client';
type Entry={id:string;file:File;state:'queued'|'working'|'done'|'error';progress:number;message:string;issues?:number};
export default function UploadDialog({open,onOpenChange,brand,brands,onComplete,onReview}:{open:boolean;onOpenChange:(v:boolean)=>void;brand?:Brand;brands:Brand[];onComplete:()=>Promise<void>;onReview:(id:string)=>void}){
 const [entries,setEntries]=useState<Entry[]>([]),[drag,setDrag]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const input=useRef<HTMLInputElement>(null);const working=useRef(false);
 useEffect(()=>{if(open){setEntries([]);setError('');}},[open]);
 useEffect(()=>{if(!busy)return;const guard=(event:BeforeUnloadEvent)=>{event.preventDefault();};window.addEventListener('beforeunload',guard);return()=>window.removeEventListener('beforeunload',guard);},[busy]);
 function select(files:FileList|null|File[]){
   if(!files||working.current)return;const valid:Entry[]=[],errors:string[]=[];
   for(const file of Array.from(files)){
     if(!file.name.toLowerCase().endsWith('.pdf')){errors.push(`${file.name}: اختر PDF فقط.`);continue;}
     if(!file.size||file.size>MAX_FILE_BYTES){errors.push(`${file.name}: يجب أن يكون الملف غير فارغ وألا يتجاوز ٥٠ MB.`);continue;}
     valid.push({id:crypto.randomUUID(),file,state:'queued',progress:0,message:'بانتظار الرفع'});
   }
   setEntries(old=>[...old,...valid.filter(v=>!old.some(e=>e.file.name===v.file.name&&e.file.size===v.file.size&&e.file.lastModified===v.file.lastModified))]);
   setError(errors.join('\n'));if(input.current)input.current.value='';
 }
 const update=(id:string,patch:Partial<Entry>)=>setEntries(old=>old.map(e=>e.id===id?{...e,...patch}:e));
 async function submit(){
   if(!brand||working.current)return;working.current=true;setBusy(true);setError('');
   // A bounded queue keeps memory stable for several large PDFs and continues after an individual failure.
   try{for(const entry of entries.filter(e=>e.state==='queued'||e.state==='error')){
     update(entry.id,{state:'working',progress:2,message:'رفع الملف وقراءة الصفحات…'});
     try{
       const created=await post<{file:FileCard}>('files',{id:entry.id,brandId:brand.id,name:entry.file.name,size:entry.file.size});
       if(created.file.status==='ready'){update(entry.id,{state:'done',progress:100,message:'اكتمل الفحص',issues:created.file.open_issues});continue;}
       const extraction=extractPdf(entry.file,brands,(done,total)=>update(entry.id,{progress:Math.round(done/total*75),message:`قراءة الصفحة ${n(done)} من ${n(total)}`}));
       const upload=['uploading','receiving'].includes(created.file.status)?api(`files/${entry.id}/content`,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:entry.file}):Promise.resolve();
       const [parsed,saved]=await Promise.allSettled([extraction,upload]);
       if(saved.status==='rejected')throw saved.reason;if(parsed.status==='rejected')throw parsed.reason;
       update(entry.id,{progress:85,message:'مراجعة الطلبات والكميات والعلامة…'});
       const result=await post<{file:FileCard}>(`files/${entry.id}/process`,{pages:parsed.value});
       update(entry.id,{state:'done',progress:100,message:'اكتمل الفحص',issues:result.file.open_issues});
     }catch(e){update(entry.id,{state:'error',message:(e as Error).message});}
   }
   await onComplete();
   }catch(e){setError(`تعذر تحديث اللوحة: ${(e as Error).message}`);}finally{working.current=false;setBusy(false);}
 }
 const done=entries.filter(e=>e.state==='done').length,pending=entries.filter(e=>e.state!=='done').length;
 return <Dialog open={open} onOpenChange={value=>{if(!working.current)onOpenChange(value);}}><DialogContent className="upload-dialog" dir="rtl" onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>رفع بوالص {brand?.name}</DialogTitle><DialogDescription>اختر عدة ملفات معًا. كل PDF يظهر كبطاقة مستقلة في بانتظار الطباعة.</DialogDescription></DialogHeader>
 <input ref={input} type="file" accept="application/pdf,.pdf" multiple hidden onChange={e=>select(e.target.files)}/>
 <button className={`upload-drop ${entries.length?'has-files':''} ${drag?'drag-over':''}`} disabled={busy} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);select(e.dataTransfer.files);}}><UploadCloud size={28}/><strong>{entries.length?'إضافة ملفات أخرى':'اسحب ملفات PDF إلى هنا'}</strong><span>أو اضغط لاختيار ملف أو أكثر</span><small>حتى ٥٠ MB لكل ملف · تُحفظ الأصول دون تعديل</small></button>
 {entries.length>0&&<><div className="queue-summary" aria-live="polite">{n(entries.length)} ملفات · اكتمل {n(done)}{busy&&' · اترك هذه الصفحة مفتوحة'}</div><ul className="upload-queue">{entries.map(entry=><li key={entry.id} className={`upload-entry entry-${entry.state}`}><div className="queue-file-title">{entry.state==='working'?<LoaderCircle className="spin" size={18}/>:entry.state==='done'?<CheckCircle2 size={18}/>:entry.state==='error'?<AlertTriangle size={18}/>:<FileCheck2 size={18}/>}<strong>{entry.file.name}</strong>{!busy&&entry.state==='queued'&&<button aria-label={`إزالة ${entry.file.name} من القائمة`} onClick={()=>setEntries(old=>old.filter(e=>e.id!==entry.id))}><X size={17}/></button>}</div><p role={entry.state==='error'?'alert':undefined}>{entry.message}{entry.state==='done'&&(entry.issues?` · ${n(entry.issues)} تنبيه للمراجعة`:' · لا توجد تنبيهات')}</p>{entry.state==='working'&&<Progress value={entry.progress}/>}<div className="queue-file-footer"><small>{(entry.file.size/1024/1024).toFixed(1)} MB</small>{entry.state==='done'&&!busy&&<Button variant="outline" size="sm" onClick={()=>{onOpenChange(false);onReview(entry.id);}}>مراجعة الملف</Button>}</div></li>)}</ul></>}
 {error&&<div className="error-banner" role="alert" style={{whiteSpace:'pre-line'}}>{error}</div>}
 <div className="dialog-footer"><span><ShieldCheck size={15}/> متاح لفريقك فقط</span><div className="queue-actions"><Button variant="outline" disabled={busy} onClick={()=>onOpenChange(false)}>{done?'العودة إلى اللوحة':'إغلاق'}</Button>{pending>0&&<Button onClick={()=>void submit()} disabled={busy}>{busy?<LoaderCircle className="spin"/>:<UploadCloud/>}{busy?'جارٍ رفع الملفات…':entries.some(e=>e.state==='error')?'إعادة محاولة الملفات المتبقية':`رفع وفحص ${n(pending)} ملفات`}</Button>}</div></div>
 </DialogContent></Dialog>;
}
