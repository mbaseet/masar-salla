'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Printer} from 'lucide-react';
import {NOTE_NAMES,quantityExceptions,type FileDetail} from '@/lib/domain';
import {api,date,n} from '@/lib/client';
export default function AttentionSheet(){
 const [data,setData]=useState<FileDetail|null>(null),[error,setError]=useState('');
 useEffect(()=>{const id=new URLSearchParams(location.search).get('file');if(!id){setError('اختر ملفًا لعرض التنبيهات.');return;}void api<FileDetail>(`files/${encodeURIComponent(id)}`).then(setData).catch(e=>setError(e.message));},[]);
 const quantities=quantityExceptions(data?.orders??[]);
 const exceptions=data?.orders.filter(o=>o.page_role==='label'&&quantities.pages.has(o.page))??[];
 return <main className="attention-page"><div className="print-controls"><Button onClick={()=>window.print()} disabled={!data}><Printer/> طباعة ورقة التنبيهات</Button><a href="/">مساحة العمل</a></div><h1>تنبيهات قبل تجهيز الطلبات</h1>{error?<p>{error}</p>:!data?<p>جارٍ التحميل…</p>:<><p>{data.file.name}</p><small>{date(new Date().toISOString(),true)}</small><p className="print-warning">الملف الأصلي لم يتغير. راجع الملصقات المطبوعة لهذه الطلبات.</p><table><thead><tr><th>الطلب / الصفحة</th><th>النوع</th><th>التفاصيل</th></tr></thead><tbody>
 {exceptions.map(o=><tr className="quantity-exception-row" key={`quantity:${o.page}:${o.ref}`}><td><bdi>{o.ref}</bdi> / {n(o.page)}</td><td>كمية مختلفة</td><td><strong>الكمية: {n(o.quantity!)}</strong> — يظل التمييز محفوظًا بعد معالجة التنبيه.</td></tr>)}
 {data.notes.map(note=><tr key={note.id}><td><bdi>{note.ref??'الملف كاملًا'}</bdi></td><td>{NOTE_NAMES[note.type]}</td><td>{note.body}</td></tr>)}
 {data.findings.filter(i=>i.status==='open'&&!(i.kind==='bucket_mismatch'&&i.page&&quantities.pages.has(i.page))).map(i=><tr key={i.id}><td><bdi>{i.ref??'—'}</bdi>{i.page?` / ${i.page}`:''}</td><td>تنبيه مفتوح</td><td>{i.message}</td></tr>)}
 </tbody></table>{exceptions.length===0&&data.notes.length===0&&data.findings.every(i=>i.status!=='open')&&<p>لا توجد ملاحظات أو تنبيهات مفتوحة لهذا الملف.</p>}</>}</main>;
}
