'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Download, FileText, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { date, n, post } from '@/lib/client';
import { normalizeRef } from '@/lib/domain';
import type { FileCard } from '@/lib/domain';
import type { PrintPage, PrintPlan } from '@/lib/printing-types';

const shipmentNames = {
  reserved: 'قيد الشحن المنفصل',
  shipped: 'شُحنت مسبقًا',
  tracking_review: 'تحتاج مراجعة التتبع',
};

export function printPageStatus(page: PrintPage) {
  return page.shipment ? shipmentNames[page.shipment.state] : page.excluded ? 'مستبعدة من الطباعة' : '';
}

async function openPdf(path: string, payload: object, name: string, inline = false, popup: Window | null = null) {
  try {
    const response = await fetch(`/api/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/pdf')) {
      const failure = await response.json<{ error?: string }>().catch(() => ({} as { error?: string }));
      throw new Error(failure.error ?? 'تعذر فتح نسخة الطباعة. حدّث الملف وحاول مرة أخرى.');
    }
    const url = URL.createObjectURL(await response.blob());
    if (popup && !popup.closed) {
      popup.location.replace(url);
    } else {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      if (inline) toast.info('نُزّلت النسخة. افتحها من التنزيلات للطباعة.');
    }
    setTimeout(() => URL.revokeObjectURL(url), 300000);
  } catch (error) {
    popup?.close();
    throw error;
  }
}

function printWindow() {
  const popup = window.open('', '_blank');
  if (popup) {
    popup.opener = null;
    popup.document.title = 'جارٍ تجهيز PDF…';
    popup.document.body.textContent = 'جارٍ تجهيز نسخة الطباعة…';
    popup.document.body.dir = 'rtl';
  }
  return popup;
}

function PagePreview({ fileId, page }: { fileId: string; page: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  useEffect(() => {
    const request = new AbortController();
    setStatus('loading');
    void fetch(`/api/files/${fileId}/preview?page=${page}`, { signal: request.signal }).then(async response => {
      if (!response.ok) throw new Error();
      const width = Number(response.headers.get('X-Preview-Width'));
      const height = Number(response.headers.get('X-Preview-Height'));
      const rgba = new Uint8ClampedArray(await response.arrayBuffer());
      if (request.signal.aborted) return;
      const target = canvas.current;
      const context = target?.getContext('2d');
      if (!target || !context || width < 1 || height < 1 || rgba.length !== width*height*4) throw new Error();
      target.width = width;
      target.height = height;
      context.putImageData(new ImageData(rgba,width,height),0,0);
      setStatus('ready');
    }).catch(() => {
      if (!request.signal.aborted) setStatus('error');
    });
    return () => request.abort();
  }, [fileId,page]);
  return <div className="print-page-preview">
    <canvas ref={canvas} hidden={status!=='ready'} aria-label={`معاينة الصفحة ${n(page)}`}/>
    {status==='loading'&&<p role="status">جارٍ تحميل المعاينة…</p>}
    {status==='error'&&<p>تعذّرت معاينة الصفحة. راجع رقم الطلب والصفحة قبل المتابعة.</p>}
    {status==='ready'&&<small>معاينة للمراجعة</small>}
  </div>;
}

type Decision = 'ship' | 'release' | 'exclude' | 'clear_tracking' | 'reconcile';

export default function PrintControls({ file, plan, pageNumber, onPage, disabled, onChange }: {
  file: FileCard;
  plan: PrintPlan;
  pageNumber: number | null;
  onPage: (page: number | null) => void;
  disabled: boolean;
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [original, setOriginal] = useState(false);
  const [priorVersion, setPriorVersion] = useState<string>();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [pageInput, setPageInput] = useState('');
  const page = plan.pages.find(p => p.page === pageNumber);
  const unavailable = disabled || busy || file.status!=='ready';
  const base = `files/${file.id}`;
  const shipped = plan.pages.filter(p => p.shipment?.state==='shipped').length;
  const skipped = plan.pages.length - plan.printable;
  const prefix = file.name.replace(/\.pdf$/i,'');

  useEffect(() => {
    setDecision(null);
    setPageInput(pageNumber ? String(pageNumber) : '');
  }, [file.id,pageNumber]);

  async function work(task: () => Promise<void>) {
    setBusy(true);
    try {
      await task();
    } catch (error) {
      toast.error((error as Error).message);
      await onChange().catch(() => {});
    } finally {
      setBusy(false);
    }
  }

  function batch(inline: boolean) {
    const popup = inline ? printWindow() : null;
    void work(async () => {
      await openPdf(`${base}/print-batch`, { inline }, `${prefix} - للطباعة.pdf`, inline, popup);
      await onChange();
    });
  }

  function early(reserve: boolean, priorCopy?: string) {
    if (!page) return;
    const popup = printWindow();
    void work(async () => {
      try {
        if (reserve) {
          const result = await post<{ reconcile?: string }>(`${base}/shipment`, { page:page.page, action:'reserve', priorCopy });
          if (result.reconcile) {
            popup?.close();
            setPriorVersion(result.reconcile);
            setDecision('reconcile');
            return;
          }
          setDecision(null);
          toast.success('حُجزت البوليصة واستُبعدت من الدفعة.');
        }
        await openPdf(`${base}/early-label`, { page:page.page }, `waybill-${page.ref}.pdf`, true, popup);
        await onChange();
      } catch (error) {
        popup?.close();
        throw error;
      }
    });
  }

  function update(action: Exclude<Decision,'reconcile'>, exclude = true) {
    if (!page) return;
    void work(async () => {
      if (action==='exclude') await post(`${base}/page-exclusion`, { page:page.page, exclude });
      else await post(`${base}/shipment`, { page:page.page, action, expectedAt:page.shipment?.at });
      setDecision(null);
      await onChange();
      toast.success(action==='ship' ? 'تأكّد الشحن واستُبعدت البوليصة من الدفعات.' : 'حُدّثت حالة الصفحة.');
    });
  }

  const confirmation = decision && {
    ship: ['تأكيد الشحن الفعلي', 'أكد فقط إذا سُلّمت هذه الشحنة بالفعل. ستظل خارج الدفعات التالية.', 'نعم، تم الشحن'],
    release: ['إعادة البوليصة إلى الدفعة', 'تأكد أن الشحنة لم تُسلّم وتخلّص من أي ملصق أو نسخة سبق فتحها قبل إعادتها للطباعة.', 'إعادة إلى الدفعة'],
    exclude: ['استبعاد هذه الصفحة', 'ستُستبعد من نسخ الطباعة الجديدة. إذا طبعتها مسبقًا، أزلها من الأوراق المطبوعة.', 'استبعاد الصفحة'],
    clear_tracking: ['السماح برقم التتبع الحالي', 'لهذا الطلب شحنة أخرى محجوزة أو مشحونة. تأكد من أن هذا التتبع يخص شحنة يجب تجهيزها قبل إتاحته.', 'السماح بهذا التتبع'],
    reconcile: ['توجد نسخة طباعة سابقة', 'تخلّص من النسخة السابقة أو أزل هذا الملصق من الأوراق المطبوعة وتأكد أن الشحنة لم تُسلّم.', 'أزلت النسخة السابقة، تابع'],
  }[decision];

  return <>
    {file.status==='ready'&&<div className="print-summary" aria-live="polite">
      <strong>{n(plan.printable)} صفحة للطباعة</strong>
      {skipped>0&&<span>{n(skipped)} خارج الدفعة{shipped>0&&` · ${n(shipped)} صفحة لشحنات سُلّمت`}</span>}
      {!plan.printable&&<p>لا توجد صفحات متبقية في نسخة الطباعة.</p>}
    </div>}
    {plan.batch&&!plan.batch.current&&<div className="warning-banner" role="status">تغيّرت صفحات الدفعة. استبدل النسخة السابقة بنسخة جديدة وراجع أي أوراق سبق طباعتها.</div>}
    <div className="file-actions">
      <Button disabled={unavailable||!plan.printable} onClick={()=>batch(true)}><Printer/> طباعة الدفعة</Button>
      <Button variant="outline" disabled={unavailable||!plan.printable} onClick={()=>batch(false)}><Download/> تنزيل نسخة الطباعة</Button>
      <Button variant="outline" disabled={unavailable||!plan.pages.length} onClick={()=>onPage(plan.pages[0]?.page??null)}><FileText/> معاينة الصفحات</Button>
      {plan.canExportOriginal&&<Button variant="ghost" size="sm" disabled={disabled||busy||!file.hash} onClick={()=>setOriginal(true)}>تنزيل الأصل للإدارة</Button>}
    </div>
    <Dialog open={!!page} onOpenChange={open=>{if(!open&&!busy)onPage(null);}}>
      <DialogContent dir="rtl" className="print-page-dialog">
        <DialogHeader>
          <DialogTitle>صفحات الملف</DialogTitle>
          <DialogDescription>راجع الصفحة أو اختر طريقة التعامل معها.</DialogDescription>
        </DialogHeader>
        {page&&<>
          <form className="print-page-navigation" onSubmit={event=>{
            event.preventDefault();
            const target = Number(normalizeRef(pageInput));
            if (plan.pages.some(p=>p.page===target)) onPage(target);
            else toast.error('اختر رقم صفحة من هذا الملف.');
          }}>
            <Button type="button" size="icon-sm" variant="outline" aria-label="الصفحة السابقة" disabled={busy||page.page<=1} onClick={()=>onPage(page.page-1)}><ChevronRight/></Button>
            <Input value={pageInput} inputMode="numeric" aria-label="رقم الصفحة" onChange={event=>setPageInput(event.target.value)} disabled={busy}/>
            <span>من {n(plan.pages.length)}</span>
            <Button size="sm" variant="outline" disabled={busy}>انتقال</Button>
            <Button type="button" size="icon-sm" variant="outline" aria-label="الصفحة التالية" disabled={busy||page.page>=plan.pages.length} onClick={()=>onPage(page.page+1)}><ChevronLeft/></Button>
          </form>
          <div className="print-page-meta">
            <strong>{page.ref ? <>الطلب <bdi>{page.ref}</bdi></> : 'رقم الطلب غير محدد'}</strong>
            {page.tracking&&<small>التتبع <bdi>{page.tracking}</bdi></small>}
            {page.role==='support'&&<small>مستند مرافق للبوليصة</small>}
            {printPageStatus(page)&&<span className="print-state">{printPageStatus(page)}</span>}
            {page.shipment?.state==='tracking_review'&&!page.tracking&&<small>رقم التتبع غير متاح. تحقق من البوليصة مع الفريق.</small>}
            {page.shipment&&<small>{page.shipment.actor} · {date(page.shipment.at,true)}</small>}
          </div>
          {page.shipment||page.excluded
            ? <p className="microcopy">معاينة هذه الصفحة غير متاحة لأنها خارج الدفعة.</p>
            : <PagePreview fileId={file.id} page={page.page}/>}
          {confirmation&&decision ? <section className="print-confirmation">
            <strong>{confirmation[0]}</strong><p>{confirmation[1]}</p>
            <div className="file-actions">
              <Button size="sm" disabled={busy} onClick={()=>decision==='reconcile'?early(true,priorVersion):update(decision)}>{confirmation[2]}</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={()=>setDecision(null)}>رجوع</Button>
            </div>
          </section> : <div className="file-actions">
            {page.ref&&page.role!=='unknown'&&<>
              {!page.shipment&&!page.excluded&&<Button size="sm" disabled={unavailable} onClick={()=>early(true)}>شحن منفصل</Button>}
              {page.shipment?.canOpen&&<Button size="sm" disabled={unavailable} onClick={()=>early(false)}>فتح البوليصة مجددًا</Button>}
              {(!page.shipment||page.shipment.state==='reserved')&&<Button size="sm" variant="outline" disabled={unavailable} onClick={()=>setDecision('ship')}>{page.shipment?'تأكيد الشحن':'تم شحنها بالفعل'}</Button>}
              {page.shipment?.canRelease&&<Button size="sm" variant="outline" disabled={unavailable} onClick={()=>setDecision('release')}>إلغاء الشحن المنفصل</Button>}
              {page.shipment?.state==='tracking_review'&&page.tracking&&<Button size="sm" variant="outline" disabled={unavailable} onClick={()=>setDecision('clear_tracking')}>مراجعة التتبع</Button>}
            </>}
            {!page.shipment&&<Button size="sm" variant="outline" disabled={unavailable} onClick={()=>page.excluded?update('exclude',false):setDecision('exclude')}>{page.excluded?'إعادة الصفحة للطباعة':'استبعاد الصفحة من الطباعة'}</Button>}
          </div>}
        </>}
      </DialogContent>
    </Dialog>
    <Dialog open={original} onOpenChange={open=>{if(!busy)setOriginal(open);}}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>تنزيل PDF الأصلي</DialogTitle>
          <DialogDescription>للرجوع الإداري. يحتوي على كل الصفحات بما فيها البوالص المشحونة أو المستبعدة. استخدم نسخة الطباعة للتجهيز.</DialogDescription>
        </DialogHeader>
        <Button disabled={busy} onClick={()=>void work(async()=>{
          await openPdf(`${base}/original`, {}, file.name);
          setOriginal(false);
        })}>تنزيل الأصل</Button>
      </DialogContent>
    </Dialog>
  </>;
}
