import type { Brand } from './domain';
export const n=(value:number)=>new Intl.NumberFormat('ar-SA').format(value);
export const date=(value:string,withTime=false)=>new Intl.DateTimeFormat('ar-SA-u-ca-gregory',{day:'numeric',month:'short',...(withTime?{hour:'2-digit',minute:'2-digit'}:{}),timeZone:'Asia/Riyadh'}).format(new Date(value));
export const businessDay=(value:string|Date=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Riyadh'}).format(new Date(value));
export const stageName=(stage:string,brands:Brand[],brandId:string)=>brands.find(b=>b.id===brandId)?.columns.find(c=>c.id===stage)?.name??stage;
export const actionNames:Record<string,string>={file_deleted:'حذف ملفًا مرفوعًا بالخطأ',upload_started:'بدأ رفع الملف',uploaded:'رفع الملف',processed:'فحص الملف',downloaded:'تنزيل / فتح للطباعة',inspected:'فتح للمراجعة',printed:'أكد الطباعة',moved:'نقل الملف',note_added:'أضاف ملاحظة',issues_resolved:'عالج التنبيهات',acknowledged:'راجع التغييرات بعد الطباعة',brand_moved:'نقل إلى علامة أخرى',brand_created:'أضاف علامة',brand_updated:'حدّث إعدادات العلامة',user_updated:'حدّث عضوًا في الفريق',auto_archive:'أرشفة تلقائية',manually_confirmed:'أكد العلامة والكمية يدويًا'};
export async function api<T=Record<string,unknown>>(path:string,options:RequestInit={}):Promise<T>{
  const res=await fetch(`/api/${path}`,{...options,headers:{...(typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});
  const data=await res.json() as T & {error?:string}; if(!res.ok)throw new Error(data.error??'تعذر إكمال العملية.');return data;
}
export const post=<T=Record<string,unknown>>(path:string,data:unknown)=>api<T>(path,{method:'POST',body:JSON.stringify(data)});
