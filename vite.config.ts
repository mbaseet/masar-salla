import vinext from 'vinext';
import {defineConfig} from 'vite';
import {localAuth} from './build/local-auth-plugin';

export default defineConfig(async({command})=>{
  process.env.CLOUDFLARE_CF_FETCH_ENABLED??='false';
  process.env.WRANGLER_SEND_METRICS??='false';
  process.env.WRANGLER_LOG_PATH??='.wrangler/logs';
  process.env.WRANGLER_REGISTRY_PATH??='.wrangler/registry';
  process.env.MINIFLARE_REGISTRY_PATH??='.wrangler/registry';
  const {cloudflare}=await import('@cloudflare/vite-plugin');
  return {
    server:{host:'127.0.0.1',port:5173,...(process.env.CODEX_SANDBOX==='seatbelt'?{watch:{useFsEvents:false,usePolling:true}}:{})},
    plugins:[vinext(),...(command==='serve'?[localAuth()]:[]),cloudflare({configPath:'./wrangler.jsonc',...(command==='serve'?{config:{assets:{binding:'ASSETS',run_worker_first:false}}}:{}),viteEnvironment:{name:'rsc',childEnvironments:['ssr']},inspectorPort:false})],
  };
});
