'use client';
import { useEffect, useRef, useState } from 'react';
import { FileCheck2, UploadCloud, LoaderCircle, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { MAX_FILE_BYTES, type Brand, type FileCard } from '@/lib/domain';
import { extractPdf } from '@/lib/pdf-client';
import { api,post,n } from '@/lib/client';
export default function UploadDialog({open,onOpenChange,brand,brands,onComplete}:{open:boolean;onOpenChange:(v:boolean)=>void;brand?:Brand;brands:Brand[];onComplete:(id:string)=>Promise<void>}){
  const [file,setFile]=useState<File|null>(null),[drag,setDrag]=useState(false),[progress,setProgress]=useState(0),[status,setStatus]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');const input=useRef<HTMLInputElement>(null);const uploadId=useRef<string|null>(null);
  useEffect(()=>{if(open){setFile(null);setError('');setStatus('');setProgress(0);uploadId.current=null;}},[open]);
  const select=(selected?:File)=>{if(!selected)return;if(!selected.name.toLowerCase().endsWith('.pdf')){setError('اختر ملف PDF.');return;}if(selected.size>MAX_FILE_BYTES){setError('الحد الأقصى لحجم الملف ٥٠ MB.');return;}setError('');setFile(selected);uploadId.current=null;};
  async function submit(){if(!file||!brand)return;setBusy(true);setError('');setProgress(2);setStatus('قراءة الصفحات ورفع الملف…');const id=uploadId.current??crypto.randomUUID();uploadId.current=id;
    try{
      const created=await post<{file:FileCard}>('files',{id,brandId:brand.id,name:file.name,size:file.size});
      const extraction=extractPdf(file,brands,(done,total)=>{setProgress(Math.round(done/total*70));setStatus(`قراءة الصفحة ${n(done)} من ${n(total)}`);});
      const upload=['uploading','receiving'].includes(created.file.status)?api(`files/${id}/content`,{method:'PUT',headers:{'Content-Type':'application/pdf'},body:file}):Promise.resolve();
      const [pages]=await Promise.all([extraction,upload]);setProgress(85);setStatus('مراجعة التكرار والعلامة والكميات…');await post(`files/${id}/process`,{pages});setProgress(100);setStatus('اكتمل الفحص');toast.success('تم رفع الملف وفحصه');onOpenChange(false);await onComplete(id);
    }catch(e){setError((e as Error).message);setStatus('يمكنك إعادة المحاولة دون فقد الملف المحفوظ.');}finally{setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={v=>{if(!busy)onOpenChange(v);}}><DialogContent className="upload-dialog" dir="rtl" onInteractOutside={e=>{if(busy)e.preventDefault();}}><DialogHeader><DialogTitle>رفع بوالص {brand?.name}</DialogTitle><DialogDescription>نقرأ كل صفحة ونراجع أرقام الطلبات والكميات والعلامة.</DialogDescription></DialogHeader><input ref={input} type="file" accept="application/pdf,.pdf" hidden onChange={e=>select(e.target.files?.[0])}/><button className={`upload-drop ${drag?'drag-over':''}`} disabled={busy} onClick={()=>input.current?.click()} onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)} onDrop={e=>{e.preventDefault();setDrag(false);if(!busy)select(e.dataTransfer.files[0]);}}><span className="upload-symbol">{file?<FileCheck2 size={31}/>:<UploadCloud size={31}/>}</span><strong>{file?file.name:'اسحب ملف PDF إلى هنا'}</strong><span>{file?`${(file.size/1024/1024).toFixed(1)} MB`:'أو اضغط لاختيار الملف من جهازك'}</span><small>PDF حتى ٥٠ MB · يُحفظ الملف الأصلي دون تعديل</small></button>{busy&&<div className="upload-progress"><Progress value={progress}/><p aria-live="polite">{status}</p><small>اترك هذه الصفحة مفتوحة حتى يكتمل الفحص.</small></div>}{error&&<div className="error-banner" role="alert">{error}</div>}<div className="dialog-footer"><span><ShieldCheck size={15}/> متاح لفريقك فقط</span><Button onClick={()=>void submit()} disabled={!file||busy}>{busy?<LoaderCircle className="spin"/>:<FileCheck2/>}{busy?'جارٍ الفحص…':'رفع وفحص الملف'}</Button></div></DialogContent></Dialog>;
}
