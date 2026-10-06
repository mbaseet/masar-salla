import type {Plugin} from 'vite';
// Development-only login. The plugin is never registered during a build.
export function localAuth():Plugin{return {name:'masar-local-auth',configureServer(server){
  server.middlewares.use((req,res,next)=>{
    for(const name of Object.keys(req.headers))if(name.startsWith('x-masar-dev-')||name.startsWith('oai-authenticated-')||name==='cf-access-jwt-assertion')delete req.headers[name];
    for(let i=req.rawHeaders.length-2;i>=0;i-=2)if(/^(x-masar-dev-|oai-authenticated-|cf-access-jwt-assertion$)/i.test(req.rawHeaders[i]))req.rawHeaders.splice(i,2);
    let url:URL;try{url=new URL(req.url??'/',`http://${req.headers.host}`);}catch{return next();}
    if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname)||!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress??''))return next();
    if(url.pathname==='/auth/login'||url.pathname==='/auth/logout'){
      if(req.method!=='GET'||(req.headers.origin&&req.headers.origin!==url.origin)||req.headers['sec-fetch-site']==='cross-site'){res.statusCode=403;res.end();return;}
      res.writeHead(302,{'Location':'/','Cache-Control':'no-store','Set-Cookie':`__masar_local=${url.pathname==='/auth/login'?'1':'0'}; Path=/; HttpOnly; SameSite=Lax`});res.end();return;
    }
    if(req.headers.cookie?.split(';').filter(c=>c.trim()==='__masar_local=1').length===1){req.headers['x-masar-dev-email']='admin@masar.test';req.rawHeaders.push('x-masar-dev-email','admin@masar.test');}
    next();
  });
}};}
