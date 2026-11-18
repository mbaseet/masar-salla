import { login, logout, signedIn } from './lib/session';
import { lookupOrder, sallaWebhook, SYNC_INTERVAL_SECONDS, syncRecentShipments, trackingCode } from './lib/salla';
import { json, localDemo, parseJson, query, readText, sameOrigin, ScannerError, seconds, type ScannerEnv } from './lib/runtime';

import { lookupBrand, scannerBrands, scannerBrandStatus } from './lib/brands';

function secure(response: Response) {
  const headers = new Headers(response.headers);
  headers.set('Cache-Control','no-store');
  headers.set('Referrer-Policy','no-referrer');
  headers.set('X-Content-Type-Options','nosniff');
  headers.set('Permissions-Policy','camera=(self), microphone=(), geolocation=()');
  headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; media-src 'self' blob:; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  return new Response(response.body,{status:response.status,headers});
}

async function handle(request: Request, env: ScannerEnv, ctx: ExecutionContext) {
  const url = new URL(request.url);
  const {pathname} = url;
  if (pathname === '/webhooks/salla' && request.method === 'POST') {
    const connected = await sallaWebhook(request,env);
    if (connected) ctx.waitUntil(syncRecentShipments(env,connected).catch(()=>console.error('Initial Salla shipment sync did not complete')));
    return new Response(null,{status:204});
  }
  if (!pathname.startsWith('/api/')) {
    if (request.method!=='GET' && request.method!=='HEAD') return new Response(null,{status:405});
    const page = pathname==='/' ? '/index.html' : pathname==='/scan' || pathname==='/scan/' ? '/scan.html' : null;
    if (page) {
      return env.ASSETS.fetch(new Request(new URL(page,url),request));
    }
    return env.ASSETS.fetch(request);
  }
  if (request.method!=='GET') sameOrigin(request,url);
  if (pathname==='/api/login' && request.method==='POST') {
    return json({ok:true},200,{'Set-Cookie':await login(request,env,url)});
  }
  if (pathname==='/api/logout' && request.method==='POST') {
    return json({ok:true},200,{'Set-Cookie':await logout(request,env,url)});
  }
  if (!await signedIn(request,env,url)) {
    throw new ScannerError(401,'not_signed_in','سجّل الدخول لمتابعة المسح.');
  }
  const demo = localDemo(env,url);
  const brands = scannerBrands(env,demo);
  if (pathname==='/api/session' && request.method==='GET') {
    return json({brands:await scannerBrandStatus(env,brands,demo),demo});
  }
  if (pathname==='/api/lookup' && request.method==='POST') {
    const input = parseJson(await readText(request,2048));
    const brand = lookupBrand(brands,input.brandId);
    const tracking = trackingCode(input.tracking);
    const rawRef = typeof input.reference==='string' ? input.reference.trim() : '';
    const reference = rawRef.replace(/[٠-٩۰-۹]/g,c=>String(c.charCodeAt(0)-(c.charCodeAt(0)<1776?1632:1776)));
    if (!tracking || (reference && !/^\d{1,40}$/.test(reference))) {
      throw new ScannerError(400,'invalid_tracking','أدخل رقم التتبع المطبوع ورقم الطلب إن توفر.');
    }
    const returnLookup = input.mode==='return';
    if (returnLookup && !demo) {
      throw new ScannerError(404,'not_found','وضع المرتجعات متاح في التجربة المحلية.');
    }
    if (demo) {
      const second = brand.id==='demo-other';
      const ref = returnLookup ? (second ? '200002' : '100002') : (second ? '200001' : '100001');
      const demoTracking = returnLookup ? 'RT0000001234' : 'AY0000001234';
      if (tracking!==demoTracking || (reference && reference!==ref)) {
        throw new ScannerError(404,'demo_not_found','لا توجد نتيجة لهذا الرقم في البيانات التجريبية.');
      }
      const items = second ? [{name:'منتج المتجر التجريبي',quantity:1,options:[],sku:'OTHER-DEMO'}] : [
        {name:'سوار وسن',quantity:2,options:[],sku:'BRACELET-DEMO'},
        {name:'خاتم وسن',quantity:1,options:[{name:'المقاس',value:'16'}],sku:'RING-DEMO'},
      ];
      return json({brandId:brand.id,ref,status:returnLookup?'مرتجع بانتظار الاستلام':'قيد التجهيز',tracking,checkedAt:new Date().toISOString(),items});
    }
    return json({brandId:brand.id,...await lookupOrder(env,brand,tracking,reference||null,brands.length)});
  }
  throw new ScannerError(404,'not_found','الطلب غير موجود.');
}

export default {
  async fetch(request: Request, env: ScannerEnv, ctx: ExecutionContext) {
    try {
      return secure(await handle(request,env,ctx));
    } catch (error) {
      if (error instanceof ScannerError) return secure(json({code:error.code,message:error.message},error.status));
      console.error('Scanner request failed');
      return secure(json({code:'internal_error',message:'تعذّر إكمال العملية. حاول مجددًا.'},500));
    }
  },
  async scheduled(event: ScheduledController, env: ScannerEnv) {
    const brands = scannerBrands(env);
    const slot = Math.floor(event.scheduledTime / (SYNC_INTERVAL_SECONDS*1000));
    await Promise.all([
      syncRecentShipments(env,brands[slot%brands.length]),
      env.DB.batch([
        query(env,'DELETE FROM scanner_sessions WHERE expires_at<=?',seconds()),
        query(env,'DELETE FROM scanner_login_limits WHERE expires_at<=?',seconds()),
        query(env,'DELETE FROM salla_order_products WHERE expires_at<=?',seconds()),
        query(env,'DELETE FROM salla_shipment_events WHERE expires_at<=?',seconds()),
      ]),
    ]);
  },
} satisfies ExportedHandler<ScannerEnv>;
