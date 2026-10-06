import {createRemoteJWKSet,jwtVerify,type JWTVerifyGetKey} from 'jose';

export type Identity={subject:string;email:string;name:string};
export type AccessConfig={ACCESS_TEAM_DOMAIN?:string;ACCESS_AUD?:string};
const keySets=new Map<string,ReturnType<typeof createRemoteJWKSet>>();

export function accessSettings(config:AccessConfig){
  const domain=config.ACCESS_TEAM_DOMAIN?.replace(/\/$/,'');
  if(!domain || !/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain) || !config.ACCESS_AUD?.trim()){
    throw new Error('Cloudflare Access is not configured.');
  }
  return {issuer:domain,audience:config.ACCESS_AUD.trim()};
}

// The key URL comes from deployment configuration, never untrusted JWT claims.
export async function verifyAccessToken(token:string,config:AccessConfig,key?:JWTVerifyGetKey):Promise<Identity>{
  const settings=accessSettings(config);
  let keys=key??keySets.get(settings.issuer);
  if(!keys){const remote=createRemoteJWKSet(new URL(`${settings.issuer}/cdn-cgi/access/certs`));keySets.set(settings.issuer,remote);keys=remote;}
  const {payload}=await jwtVerify(token,keys,{...settings,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email'],clockTolerance:5});
  if(payload.type!=='app' || typeof payload.sub!=='string' || !payload.sub || typeof payload.email!=='string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)){
    throw new Error('A verified user email is required.');
  }
  const email=payload.email.trim().toLowerCase();
  return {subject:payload.sub,email,name:typeof payload.name==='string'?payload.name:email};
}
