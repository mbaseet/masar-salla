import handler from 'vinext/server/fetch-handler';
import {accessSettings,verifyAccessToken,type Identity} from '../lib/access';
import {withIdentity} from '../lib/auth-context';
import {maintenance} from '../lib/server';

function denied(request:Request,status:number,message:string){
  const headers={'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'};
  if(new URL(request.url).pathname.startsWith('/api/'))return Response.json({error:message},{status,headers});
  return new Response(`<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>مسار — تسجيل الدخول</title><body style="font-family:system-ui;max-width:560px;margin:15vh auto;padding:24px"><h1>مسار</h1><p>${message}</p><a href="/">إعادة المحاولة</a></body></html>`,{status,headers:{...headers,'Content-Type':'text/html; charset=utf-8'}});
}
export default {
  async fetch(request:Request,env:Cloudflare.Env,ctx:ExecutionContext){
    const url=new URL(request.url);
    let identity:Identity|null=null;
    // The dev middleware strips these headers and only injects them on loopback.
    // This entire branch is eliminated from production builds.
    if(import.meta.env.DEV && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)){
      const email=request.headers.get('x-masar-dev-email');
      if(email)identity={subject:'local-admin',email,name:'مدير التجربة'};
      else if(!url.pathname.startsWith('/api/'))return Response.redirect(new URL('/auth/login',url),302);
    }else{
      try{accessSettings(env);}catch{return denied(request,503,'لم يكتمل إعداد تسجيل الدخول. تواصل مع مدير التطبيق.');}
      const token=request.headers.get('cf-access-jwt-assertion');
      if(token){try{identity=await verifyAccessToken(token,env);}catch{/* Fail closed; never accept identity headers as a fallback. */}}
    }
    if(!identity)return denied(request,401,'انتهت جلسة الدخول أو تعذر التحقق منها. افتح رابط التطبيق وسجل الدخول ببريدك.');
    if(url.pathname==='/auth/login')return Response.redirect(new URL('/',url),302);
    if(url.pathname==='/auth/logout')return Response.redirect(new URL('/cdn-cgi/access/logout',url),302);
    const response=await withIdentity(identity,()=>handler.fetch(request,env,ctx));
    const result=new Response(response.body,response);
    result.headers.set('Cache-Control','private, no-store');
    result.headers.set('X-Content-Type-Options','nosniff');
    result.headers.set('Referrer-Policy','same-origin');
    return result;
  },
  async scheduled(_controller:ScheduledController,_env:Cloudflare.Env,_ctx:ExecutionContext){
    // Evaluate the business timezone at runtime because Cloudflare cron uses UTC.
    const hour=new Intl.DateTimeFormat('en-GB',{timeZone:'Africa/Cairo',hour:'2-digit',hourCycle:'h23'}).format(new Date(_controller.scheduledTime));
    if(hour!=='03')return;
    let result=await maintenance(true);
    for(let batch=0;result.more&&batch<19;batch++)result=await maintenance(true);
    if(result.more)throw new Error('Retention cleanup still has pending batches.');
  },
};
