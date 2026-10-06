import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
if(!config.account_id||!config.d1_databases?.[0]?.database_id||config.d1_databases[0].database_id.startsWith('00000000'))throw new Error('Configure the Cloudflare account and D1 database first.');
if(!config.vars?.ACCESS_TEAM_DOMAIN||!config.vars?.ACCESS_AUD)throw new Error('Configure Cloudflare Access before publishing. See CLOUDFLARE_DEPLOYMENT.md.');
for(const args of [['scripts/prepare-pdf-assets.mjs'],['scripts/run-framework.mjs','build'],['--import','./scripts/sites-env.mjs','./node_modules/wrangler/bin/wrangler.js','deploy','--config','dist/server/wrangler.json']]){
 const result=spawnSync(process.execPath,args,{stdio:'inherit'});if(result.error)throw result.error;if(result.status!==0)process.exit(result.status??1);
}
