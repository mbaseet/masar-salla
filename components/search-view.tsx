'use client';

import { useCallback, useEffect, useState } from 'react';
import { ListChecks, Search, Truck } from 'lucide-react';
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { api, post, n, date, stageName } from '@/lib/client';
import type { Brand, Occurrence } from '@/lib/domain';
import { MAX_BATCH_REFS, type BulkShipmentMatch } from '@/lib/printing-types';
import { Blank, Picker } from './controls';

type SearchResult = {
  results: Occurrence[];
  missing: string[];
  truncated: boolean;
  bulkMatches?: BulkShipmentMatch[] | null;
};

const shipmentLabels: Record<BulkShipmentMatch['state'], string> = {
  eligible: 'متاح للتحديث',
  shipped: 'شُحن مسبقًا',
  reserved: 'محجوز للشحن المنفصل',
  tracking_review: 'يحتاج مراجعة التتبع',
  brand_review: 'يحتاج مراجعة العلامة',
  page_review: 'صفحة مشتركة مع طلب آخر',
  unavailable: 'البوليصة غير متاحة',
};

export default function SearchView({ brands, activeBrandId, onOpen, onChanged, initialQuery = '' }: {
  brands: Brand[];
  activeBrandId: string;
  onOpen: (id: string) => void;
  onChanged: () => Promise<void>;
  initialQuery?: string;
}) {
  const [mode, setMode] = useState('single');
  const [query, setQuery] = useState(initialQuery);
  const [batch, setBatch] = useState('');
  const [brandId, setBrandId] = useState(activeBrandId || 'all');
  const [result, setResult] = useState<SearchResult | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(!!initialQuery);
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const clearResults = () => {
    setResult(null);
    setSelected(new Set());
    setError('');
    setMessage('');
  };
  const runSearch = useCallback(async (value: string, listBrand?: string) => {
    setBusy(true);
    setError('');
    setSelected(new Set());
    setResult(null);
    try {
      const data = listBrand === undefined
        ? await api<SearchResult>(`search?q=${encodeURIComponent(value)}`)
        : await post<SearchResult>('search', { refs: value, ...(listBrand !== 'all' && { brandId: listBrand }) });
      setResult(data);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    if (!initialQuery) return;
    const controller = new AbortController();
    void api<SearchResult>(`search?q=${encodeURIComponent(initialQuery)}`, { signal: controller.signal })
      .then(setResult)
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); })
      .finally(() => { if (!controller.signal.aborted) setBusy(false); });
    return () => controller.abort();
  }, [initialQuery]);

  const matches = new Map(result?.bulkMatches?.map(match => [match.ref, match]));
  const eligible = result?.truncated ? [] : (result?.bulkMatches ?? []).filter(match => match.state === 'eligible');
  const canSelect = mode === 'batch' && !!result?.bulkMatches && !result.truncated;
  const disabled = busy || saving;

  function toggle(ref: string) {
    setSelected(previous => {
      const next = new Set(previous);
      if (next.has(ref)) next.delete(ref);
      else next.add(ref);
      return next;
    });
  }

  async function markShipped() {
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const orders = eligible.filter(match => selected.has(match.ref)).map(({ref, tracking}) => ({ref, tracking}));
      const {shipped} = await post<{shipped: number}>('search/ship', { brandId, orders });
      setMessage(shipped > 0
        ? `تم تسجيل شحن ${n(shipped)} طلب واستبعاد بوالصها من نسخ الطباعة التالية.`
        : 'الطلبات المحددة مسجلة كمشحونة بالفعل.');
      await Promise.all([runSearch(batch, brandId), onChanged()]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return <div className="page-content narrow-page">
    <div className="page-heading">
      <div>
        <div className="eyebrow">كل العلامات في مكان واحد</div>
        <h1>أين يوجد الطلب؟</h1>
        <p>ابحث برقم الطلب أو جزء منه، وستظهر كل الملفات والصفحات المرتبطة به.</p>
      </div>
      <Search className="page-heading-icon"/>
    </div>
    <div className="search-surface">
      <Tabs dir="rtl" value={mode} onValueChange={value => { setMode(value); clearResults(); }}>
        <TabsList>
          <TabsTrigger value="single" disabled={disabled}><Search size={16}/> طلب واحد</TabsTrigger>
          <TabsTrigger value="batch" disabled={disabled}><ListChecks size={16}/> فحص قائمة</TabsTrigger>
        </TabsList>
        <TabsContent value="single">
          <form className="search-form" onSubmit={event => { event.preventDefault(); setMessage(''); void runSearch(query); }}>
            <Input dir="ltr" aria-label="رقم الطلب للبحث" placeholder="مثال: 288365535" value={query}
              onChange={event => setQuery(event.target.value)} minLength={2} maxLength={40} disabled={disabled}/>
            <Button disabled={disabled || query.trim().length < 2}><Search size={17}/> بحث</Button>
          </form>
        </TabsContent>
        <TabsContent value="batch">
          <form onSubmit={event => { event.preventDefault(); setMessage(''); void runSearch(batch, brandId); }}>
            <div className="batch-brand">
              <Picker label="العلامة التجارية" value={brandId} disabled={disabled}
                onChange={value => { setBrandId(value); clearResults(); }}
                options={[{ value: 'all', label: 'كل العلامات' }, ...brands.map(brand => ({ value: brand.id, label: brand.name }))]}/>
              <span>اختر علامة لتسجيل شحن الطلبات الموجودة في ملفاتها.</span>
            </div>
            <Textarea dir="ltr" aria-label="قائمة أرقام الطلبات" placeholder={'288365535\n289691732'}
              value={batch} onChange={event => { setBatch(event.target.value); clearResults(); }} maxLength={12000} disabled={disabled}/>
            <div className="batch-footer">
              <span>رقم في كل سطر، حتى {n(MAX_BATCH_REFS)} طلب.</span>
              <Button disabled={disabled || !batch.trim()}><ListChecks/> فحص القائمة</Button>
            </div>
          </form>
        </TabsContent>
      </Tabs>
    </div>

    {error && <div className="error-banner" role="alert">{error}</div>}
    {message && <div className="bulk-success" role="status">{message}</div>}
    {busy ? <Skeleton className="h-64 w-full"/> : !result ?
      <Blank title="ابدأ برقم الطلب" description="يشمل البحث الملفات المحفوظة، بما فيها الأرشيف." icon={Search}/> :
      <>
        {result.missing.length > 0 && <div className="warning-banner">
          <strong>لم نجد {n(result.missing.length)} طلبًا في الملفات المحفوظة</strong>
          <div className="missing-refs">{result.missing.map(ref => <code key={ref}>{ref}</code>)}</div>
        </div>}
        {result.truncated && <div className="warning-banner">
          {mode === 'batch' ? 'النتائج كثيرة. افحص قائمة أقصر لعرض كل المطابقات.' : 'النتائج كثيرة. أدخل رقمًا أطول لتحديد البحث.'}
        </div>}
        {result.results.length === 0 ?
          <Blank title="لا توجد نتائج مطابقة" description="تحقق من رقم الطلب أو من انتهاء مدة الاحتفاظ بالملف." icon={Search}/> :
          <div className="results-surface">
            <div className="section-title"><h3>{n(result.results.length)} نتيجة</h3></div>
            {canSelect && <div className="bulk-toolbar">
              <div>
                <label>
                  <input type="checkbox" disabled={disabled || !eligible.length}
                    checked={eligible.length > 0 && selected.size === eligible.length}
                    ref={input => { if (input) input.indeterminate = selected.size > 0 && selected.size < eligible.length; }}
                    onChange={event => setSelected(new Set(event.target.checked ? eligible.map(match => match.ref) : []))}/>
                  تحديد كل الطلبات المتاحة
                </label>
                <small>{n(selected.size)} من {n(eligible.length)} طلب محدد</small>
              </div>
              <AlertDialog open={confirming} onOpenChange={setConfirming}>
                <AlertDialogTrigger asChild>
                  <Button disabled={disabled || !selected.size}><Truck/> تسجيل الشحن واستبعاد من الطباعة</Button>
                </AlertDialogTrigger>
                <AlertDialogContent dir="rtl">
                  <AlertDialogHeader className="sm:text-right">
                    <AlertDialogTitle>تأكيد الشحن السابق</AlertDialogTitle>
                    <AlertDialogDescription>
                      ستُسجّل {n(selected.size)} طلب من {brands.find(brand => brand.id === brandId)?.name} كمشحونة.
                      ستُستبعد بوالصها والصفحات المرفقة من نسخ الطباعة التالية في جميع الملفات المطابقة.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>إلغاء</AlertDialogCancel>
                    <Button onClick={() => { setConfirming(false); void markShipped(); }}>تأكيد الشحن</Button>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </div>}
            <Table>
              <TableHeader><TableRow>
                {canSelect && <TableHead>تحديد</TableHead>}
                <TableHead>رقم الطلب</TableHead><TableHead>العلامة / الملف</TableHead><TableHead>الصفحة</TableHead>
                <TableHead>تاريخ الرفع</TableHead><TableHead>حالة الملف</TableHead>
                {result.bulkMatches && <TableHead>حالة الطلب</TableHead>}
                <TableHead/>
              </TableRow></TableHeader>
              <TableBody>{result.results.map((row, index) => {
                const match = matches.get(row.ref);
                return <TableRow key={`${row.file_id}-${row.page}-${row.ref}-${index}`}>
                  {canSelect && <TableCell>
                    {!row.historical && match?.state === 'eligible' &&
                      <input type="checkbox" aria-label={`تحديد الطلب ${row.ref}، صفحة ${row.page}، ${row.name}`}
                        checked={selected.has(row.ref)} disabled={disabled} onChange={() => toggle(row.ref)}/>}
                  </TableCell>}
                  <TableCell><bdi className="ref-number">{row.ref}</bdi></TableCell>
                  <TableCell><strong>{row.brand_name}</strong><small className="table-file-name">{row.name}</small></TableCell>
                  <TableCell>{n(row.page)}</TableCell>
                  <TableCell>{row.uploaded_at ? date(row.uploaded_at) : '—'}</TableCell>
                  <TableCell>{row.historical ? 'انتهى حفظ PDF' : stageName(row.stage ?? '', brands, row.brand_id)}</TableCell>
                  {result.bulkMatches && <TableCell>{match && !row.historical ? shipmentLabels[match.state] : '—'}</TableCell>}
                  <TableCell>{row.file_id && <Button variant="outline" size="sm" onClick={() => onOpen(row.file_id)}>فتح الملف</Button>}</TableCell>
                </TableRow>;
              })}</TableBody>
            </Table>
          </div>}
      </>}
  </div>;
}
