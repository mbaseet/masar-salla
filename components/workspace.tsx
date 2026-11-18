'use client';
import { useCallback,useEffect,useState } from 'react';
import { Archive,Bell,ClipboardList,Clock3,FileCheck2,FileText,GripVertical,History,LayoutDashboard,LoaderCircle,LogOut,Package,Plus,Printer,RefreshCw,Search,Settings,ShieldCheck,Truck,UploadCloud,AlertTriangle,MessageSquare } from 'lucide-react';
import { toast } from 'sonner';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs,TabsList,TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { SidebarProvider,Sidebar,SidebarHeader,SidebarContent,SidebarFooter,SidebarMenu,SidebarMenuItem,SidebarMenuButton,SidebarTrigger } from '@/components/ui/sidebar';
import { bucketName,moveNeedsConfirmation,type Brand,type FileCard,type User } from '@/lib/domain';
import { api,post,n,date,businessDay } from '@/lib/client';
import { Picker,Blank } from './controls';
import UploadDialog from './upload-dialog';
import FilePanel from './file-panel';
import SearchView from './search-view';
import SettingsView from './settings-view';
import ActivityView from './activity-view';
import OrderCategoryBadges from './order-category-badges';
import MoveFileDialog, { type FileMove } from './move-file-dialog';
import { FileLabel } from './file-label';
type View='board'|'search'|'activity'|'settings';

export default function Workspace(){
  const [user,setUser]=useState<User|null>(null),[brands,setBrands]=useState<Brand[]>([]),[brandId,setBrandId]=useState(''),[files,setFiles]=useState<FileCard[]>([]),[view,setView]=useState<View>('board'),[filter,setFilter]=useState('all'),[period,setPeriod]=useState('all'),[loading,setLoading]=useState(true),[error,setError]=useState(''),[uploadOpen,setUploadOpen]=useState(false),[selected,setSelected]=useState<string|null>(null),[busy,setBusy]=useState(false),[agentQuery,setAgentQuery]=useState('');
  const current=brands.find(b=>b.id===brandId)??brands[0];
  const bootstrap=useCallback(async()=>{const result=await api<{user:User;brands:Brand[]}>('bootstrap');setUser(result.user);setBrands(result.brands);setBrandId(previous=>result.brands.some(b=>b.id===previous)?previous:result.brands[0]?.id??'');return result;},[]);
  const loadFiles=useCallback(async()=>{const result=await api<{files:FileCard[]}>('files');setFiles(result.files);},[]);
  const refresh=useCallback(async()=>{await Promise.all([bootstrap(),loadFiles()]);},[bootstrap,loadFiles]);
  useEffect(()=>{const params=new URLSearchParams(location.search);const v=params.get('view');if(v&&['board','search','activity','settings'].includes(v))setView(v as View);setSelected(params.get('file'));refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));},[refresh]);
  useEffect(()=>{const timer=setInterval(()=>{if(document.visibilityState==='visible')void loadFiles().catch(()=>{});},20000);return()=>clearInterval(timer);},[loadFiles]);
  const navigate=(v:View)=>{setView(v);history.replaceState(null,'',`/?view=${v}`);};
  async function perform(action:()=>Promise<unknown>,success?:string){setBusy(true);try{await action();await loadFiles();if(success)toast.success(success);}catch(e){toast.error((e as Error).message);}finally{setBusy(false);}}
  const brandFiles=files.filter(f=>f.brand_id===current?.id),daily=brandFiles.filter(f=>businessDay(f.uploaded_at)===businessDay());
  const rules = current?.orderCategories?.rules ?? [];
  const [category,setCategory] = useState('all');
  const effectiveCategory = rules.some(rule=>rule.id===category) ? category : 'all';
  const hasBoardFilters = filter!=='all' || period!=='all' || effectiveCategory!=='all';
  function resetBoardFilters() {
    setFilter('all');
    setPeriod('all');
    setCategory('all');
  }
  function showReviewFiles() {
    navigate('board');
    resetBoardFilters();
    setFilter('issues');
  }
  const visible=brandFiles.filter(f=>(filter==='all'||(filter==='issues'?(f.open_issues>0||f.changed_version>f.ack_version):f.bucket===filter))&&(effectiveCategory==='all'||f.categories?.manual===effectiveCategory||(f.categories?.counts[effectiveCategory]??0)>0)&&(period==='all'||Date.now()-new Date(f.uploaded_at).getTime()<Number(period)*86400000));
  const issueCards=brandFiles.filter(f=>f.open_issues>0||f.changed_version>f.ack_version).length;
  const [pendingMove,setPendingMove] = useState<FileMove|null>(null);
  function moveFile(move: FileMove, confirmed = false) {
    void perform(()=>post(`files/${move.file.id}/move`,{
      stage:move.stage, fromStage:move.file.stage, confirmed,
    }),'تم نقل الملف');
  }
  function onDrop(event: React.DragEvent, stage: string) {
    event.preventDefault();
    if (busy || pendingMove) return;
    const id = event.dataTransfer.getData('application/x-waybill-id');
    const file = brandFiles.find(card=>card.id===id);
    const column = current?.columns.find(item=>item.id===stage);
    if (!column || !file || file.status!=='ready' || stage===file.stage) return;
    const move = {file,stage,name:column.name};
    if (moveNeedsConfirmation(file,stage)) setPendingMove(move);
    else moveFile(move);
  }
  useEffect(()=>{
    type ToolContext={registerTool:(tool:Record<string,unknown>,options:{signal:AbortSignal})=>void|Promise<void>};
    const context=(document as Document & {modelContext?:ToolContext}).modelContext;if(!context?.registerTool)return;
    const lifecycle=new AbortController();
    void Promise.resolve(context.registerTool({name:'search_waybill_orders',title:'البحث عن الطلبات',description:'Search retained waybill occurrences by a partial order reference and show the search view. Does not change order data.',inputSchema:{type:'object',properties:{ref:{type:'string',minLength:2,maxLength:40}},required:['ref'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},execute:async(input:unknown)=>{const ref=(input as {ref?:unknown})?.ref;if(typeof ref!=='string'||ref.length<2||ref.length>40)throw new Error('Provide an order reference of 2-40 characters.');const result=await api(`search?q=${encodeURIComponent(ref)}`);setAgentQuery(ref);setView('search');return result;}},{signal:lifecycle.signal})).catch(()=>{});
    return()=>lifecycle.abort();
  },[]);
  if(error)return <main className="access-state"><ShieldCheck size={42}/><h1>تعذر فتح مساحة العمل</h1><p>{error}</p><Button onClick={()=>{setError('');setLoading(true);void refresh().catch(e=>setError(e.message)).finally(()=>setLoading(false));}}>إعادة المحاولة</Button><a href="/auth/login" target="_top">تسجيل الدخول</a></main>;
  return <SidebarProvider defaultOpen style={{'--sidebar-width':'224px'} as React.CSSProperties}><Toaster dir="rtl" position="bottom-left" richColors theme="light"/>
    <Sidebar side="right" className="operations-sidebar"><SidebarHeader><div className="wordmark"><span className="wordmark-icon"><FileCheck2 size={25}/></span><div><strong>مسار</strong><small>إدارة البوالص</small></div></div></SidebarHeader><SidebarContent><div className="sidebar-caption">مساحة العمل</div><SidebarMenu>{[{id:'board',label:'لوحات البوالص',icon:LayoutDashboard},{id:'search',label:'البحث عن طلب',icon:Search},{id:'activity',label:'سجل النشاط',icon:History},...(user?.role==='admin'?[{id:'settings',label:'الإعدادات',icon:Settings}]:[])].map(item=><SidebarMenuItem key={item.id}><SidebarMenuButton isActive={view===item.id} onClick={()=>navigate(item.id as View)} className="nav-item"><item.icon/><span>{item.label}</span></SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu><div className="sidebar-caption brands-caption">العلامات التجارية <span>{n(brands.length)}</span></div><div className="side-brands">{brands.map(brand=><button key={brand.id} className={brand.id===current?.id?'side-brand active':'side-brand'} onClick={()=>{setBrandId(brand.id);setCategory('all');navigate('board');}}><span className="brand-avatar" style={{background:brand.color}}>{brand.name.slice(0,1)}</span><span>{brand.name}</span><small>{n(files.filter(f=>f.brand_id===brand.id&&f.stage!=='archive').length)}</small></button>)}</div>{user?.role==='admin'&&<button className="add-brand-nav" onClick={()=>navigate('settings')}><Plus size={16}/> إدارة العلامات</button>}</SidebarContent><SidebarFooter><div className="retention-note"><ShieldCheck size={19}/><span>ملفاتك محفوظة لمدة<br/><strong>{n(current?.retention_days??30)} يومًا</strong></span></div><div className="user-strip"><span className="user-avatar">{user?.name?.slice(0,1)??'م'}</span><div><strong>{user?.name??'جارٍ التحميل'}</strong><small>{user?.role==='admin'?'مدير مساحة العمل':'عضو الفريق'}</small></div><a href="/auth/logout" target="_top" aria-label="تسجيل الخروج"><LogOut size={17}/></a></div></SidebarFooter></Sidebar>
    <main className="workspace-main"><header className="topbar"><div className="topbar-title"><SidebarTrigger className="mobile-menu"/><span>مساحة الفريق</span><span className="separator">/</span><strong>{{board:'لوحات البوالص',search:'البحث عن الطلبات',activity:'سجل النشاط',settings:'الإعدادات'}[view]}</strong></div><div className="topbar-end"><span className="today-label"><Clock3 size={15}/>{date(new Date().toISOString())}</span><button className="icon-button" aria-label="عرض الملفات التي تحتاج مراجعة" onClick={showReviewFiles}><Bell size={20}/>{issueCards>0&&<span className="notification-count">{n(issueCards)}</span>}</button></div></header>
    {loading?<div className="page-content"><Skeleton className="h-12 w-52"/><div className="stats-grid">{[1,2,3,4].map(i=><Skeleton key={i} className="h-28"/>)}</div><Skeleton className="h-80 w-full"/></div>:<>
      {view==='board'&&current&&<div className="page-content board-content"><div className="page-heading"><div><div className="eyebrow">التشغيل اليومي</div><h1>بوالص {current.name}<span aria-hidden="true" className="title-brand" style={{background:current.color}}>{current.name.slice(0,1)}</span></h1><p>من رفع الملف إلى خروج الطلبات للشحن.</p></div><Button className="primary-action" onClick={()=>setUploadOpen(true)}><UploadCloud/> رفع بوالص</Button></div>
      <div className="stats-grid">{[{label:'ملفات اليوم',value:daily.length,icon:FileText,style:'blue',meta:'حسب تاريخ الرفع'},{label:'بوالص اليوم',value:daily.reduce((s,f)=>s+f.waybill_count,0),icon:Package,style:'teal',meta:'بدون المستندات المرافقة'},{label:'تحتاج مراجعة',value:issueCards,icon:AlertTriangle,style:'amber',meta:'من جميع الملفات المحفوظة'},{label:'تمت طباعتها اليوم',value:brandFiles.filter(f=>f.printed_at&&businessDay(f.printed_at)===businessDay()).length,icon:Printer,style:'purple',meta:'ملفات مؤكدة الطباعة'}].map(stat=><div className="stat-card" key={stat.label}><div><span className="stat-label">{stat.label}</span><strong>{n(stat.value)}</strong><small>{stat.meta}</small></div><span className={`stat-icon ${stat.style}`}><stat.icon size={21}/></span></div>)}</div>
      <div className="board-toolbar"><Tabs dir="rtl" value={filter} onValueChange={setFilter}><TabsList className="board-filters"><TabsTrigger value="all">كل الملفات <span>{n(brandFiles.length)}</span></TabsTrigger><TabsTrigger value="single">{bucketName('single',current)}</TabsTrigger><TabsTrigger value="multiple">{bucketName('multiple',current)}</TabsTrigger><TabsTrigger value="issues">تحتاج مراجعة{issueCards>0&&<span className="tiny-alert">{n(issueCards)}</span>}</TabsTrigger></TabsList></Tabs><div className="toolbar-actions">{rules.length>0&&<Picker label="تصنيف الطلبات" value={effectiveCategory} onChange={setCategory} options={[{value:'all',label:'كل التصنيفات'},...rules.map(rule=>({value:rule.id,label:rule.name}))]}/>}<Picker label="تاريخ الرفع" value={period} onChange={setPeriod} options={[{value:'all',label:'كل الأيام'},{value:'1',label:'آخر ٢٤ ساعة'},{value:'7',label:'آخر ٧ أيام'}]}/><button className="icon-button" aria-label="تحديث اللوحة" onClick={()=>void perform(refresh)} disabled={busy}><RefreshCw size={17} className={busy?'spin':''}/></button></div></div>
      {hasBoardFilters&&visible.length===0&&<div className="board-filter-empty" role="status">
        <span>لا توجد ملفات تطابق الفلاتر الحالية.</span>
        <Button size="sm" variant="outline" onClick={resetBoardFilters}>مسح الفلاتر</Button>
      </div>}
      <div className="kanban-scroll"><div className="kanban" style={{gridTemplateColumns:`repeat(${current.columns.length},minmax(220px,1fr))`}}>{current.columns.map(column=>{const cards=visible.filter(f=>f.stage===column.id);const Icon=column.id==='printed'?Printer:column.id==='prepared'?Package:column.id==='shipped'?Truck:column.id==='archive'?Archive:ClipboardList;return <section key={column.id} className={`kanban-column column-${column.id}`} onDragOver={e=>e.preventDefault()} onDrop={e=>onDrop(e,column.id)} aria-label={column.name}><div className="column-heading"><div><span className="column-marker" style={{background:column.color}}/><h2>{column.name}</h2><span className="column-count">{n(cards.length)}</span></div><Icon size={17}/></div><div className="column-cards">{column.id==='awaiting'&&<button className="column-add" onClick={()=>setUploadOpen(true)}><Plus size={16}/> إضافة ملفات</button>}{cards.map(file=><article key={file.id} draggable={file.status==='ready'} onDragStart={e=>e.dataTransfer.setData('application/x-waybill-id',file.id)} className={`waybill-card ${file.open_issues?'has-issue':''}`}><button className="card-open" onClick={()=>setSelected(file.id)}><div className="card-top"><span className="pdf-icon"><FileText size={20}/><small>PDF</small></span><span className="card-carrier">{file.carriers.join(' · ')||'جارٍ الرفع'}</span><GripVertical size={16} className="grip"/></div><h3>{file.name}</h3><FileLabel file={file}/><div className="card-facts"><strong>{n(file.waybill_count)} <span>بوليصة</span></strong><span>{n(file.page_count)} صفحة</span></div><Badge className={`bucket-badge bucket-${file.bucket}`}>{bucketName(file.bucket,current)}</Badge><OrderCategoryBadges brand={current} file={file}/>{file.status!=='ready'&&<div className="card-status"><LoaderCircle size={14}/>{file.status==='processing'?'جارٍ الفحص':file.status==='uploaded'?'الفحص غير مكتمل':'الرفع غير مكتمل'}</div>}{file.duplicate_files>0&&<div className="card-alert"><AlertTriangle size={14}/>ملف مكرر</div>}{file.open_issues>file.duplicate_files&&<div className="card-alert"><AlertTriangle size={14}/>{n(file.open_issues-file.duplicate_files)} تنبيه للمراجعة</div>}{file.quantity_attention>0&&<div className="card-quantity"><Package size={14}/>{n(file.quantity_attention)} بوالص بكميات مختلفة</div>}{file.changed_version>file.ack_version&&<div className="card-changed"><Bell size={14}/>تعديل بعد الطباعة</div>}{file.note_count>0&&<div className="card-note"><MessageSquare size={14}/>{file.attention_orders?`${n(file.attention_orders)} طلبات تحتاج انتباهًا`:`${n(file.note_count)} ملاحظات`}</div>}<div className="card-footer"><span><Clock3 size={13}/>{date(file.uploaded_at,true)}</span><span>{(file.size/1024/1024).toFixed(1)} MB</span></div></button></article>)}{cards.length===0&&<div className="column-empty"><Icon size={25}/><span>لا توجد ملفات</span>{column.id==='awaiting'&&filter==='all'&&<button onClick={()=>setUploadOpen(true)}><Plus size={15}/> رفع أول ملف</button>}</div>}</div></section>;})}</div></div><div className="board-footnote"><span><GripVertical size={15}/> اسحب الملف بين المراحل، أو انقله من تفاصيله.</span><span>الأوقات بتوقيت السعودية</span></div>
      </div>}
      {view==='search'&&<SearchView key={agentQuery} brands={brands} activeBrandId={current?.id??''} onOpen={setSelected} onChanged={loadFiles} initialQuery={agentQuery}/>}
      {view==='activity'&&<ActivityView brands={brands}/>}
      {view==='settings'&&user?.role==='admin'&&<SettingsView brands={brands} user={user} onSaved={refresh}/>}
      {view==='settings'&&user?.role!=='admin'&&<Blank title="الإعدادات متاحة للمدير فقط"/>}
    </>}
    </main><MoveFileDialog move={pendingMove} onClose={()=>setPendingMove(null)} onConfirm={move=>moveFile(move,true)}/><UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} brand={current} brands={brands} onComplete={async()=>{await loadFiles();resetBoardFilters();}} onReview={setSelected}/><FilePanel id={selected} brands={brands} onClose={()=>setSelected(null)} onChange={loadFiles} onOpenFile={setSelected}/>
  </SidebarProvider>;
}
