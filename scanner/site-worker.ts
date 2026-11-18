const scanner = 'https://masar-salla.mint-meow.workers.dev';

interface SiteEnv {
  ASSETS: Fetcher;
}

export default {
  fetch(request: Request, env: SiteEnv) {
    if (request.method!=='GET' && request.method!=='HEAD') return new Response(null,{status:404});
    const url = new URL(request.url);
    if (url.pathname==='/scan' || url.pathname==='/scan/') return Response.redirect(scanner+'/scan',302);
    if (url.pathname!=='/' && url.pathname!=='/scan.css') return new Response(null,{status:404});
    if (url.pathname==='/') url.pathname = '/index.html';
    return env.ASSETS.fetch(new Request(url,request));
  },
} satisfies ExportedHandler<SiteEnv>;
