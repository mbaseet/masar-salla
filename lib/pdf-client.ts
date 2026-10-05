import { detectPage, type Brand, type PageRecord } from './domain';
export async function extractPdf(file: Blob, brands: Brand[], progress: (done:number,total:number)=>void): Promise<PageRecord[]> {
  const bytes = await file.arrayBuffer();
  return new Promise((resolve,reject)=>{
    const worker = new Worker('/pdf-extractor.js',{type:'module'});
    const pages: PageRecord[]=[];
    const timeout=setTimeout(()=>{worker.terminate();reject(new Error('استغرقت قراءة الملف وقتًا طويلًا. أعد المحاولة.'));},180000);
    const finish=()=>{clearTimeout(timeout);worker.terminate();};
    worker.onerror=()=>{finish();reject(new Error('تعذر تشغيل قارئ PDF. أعد تحميل الصفحة وحاول مرة أخرى.'));};
    worker.onmessage=({data})=>{
      if(data.kind==='page'){pages.push(detectPage(data.text,data.page,brands));progress(data.page,data.total);}
      if(data.kind==='done'){finish();resolve(pages);}
      if(data.kind==='error'){finish();reject(new Error('تعذر قراءة PDF. تأكد أنه غير تالف أو محمي بكلمة مرور.'));}
    };
    worker.postMessage({bytes},[bytes]);
  });
}
