import {test} from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPair,SignJWT,createLocalJWKSet,exportJWK,type JWTPayload} from 'jose';
import {accessSettings,verifyAccessToken} from '../lib/access.ts';
import {withIdentity,getIdentity} from '../lib/auth-context.ts';
const {publicKey,privateKey}=await generateKeyPair('RS256');
const jwks=createLocalJWKSet({keys:[{...await exportJWK(publicKey),kid:'test'}]});
const config={ACCESS_TEAM_DOMAIN:'https://masar-test.cloudflareaccess.com',ACCESS_AUD:'masar-test-audience'};
const timestamp=Math.floor(Date.now()/1000);
async function token(overrides:JWTPayload={}){return new SignJWT({email:'Operator@Example.test',type:'app',sub:'test-subject',iss:config.ACCESS_TEAM_DOMAIN,aud:[config.ACCESS_AUD],iat:timestamp,exp:timestamp+3600,...overrides}).setProtectedHeader({alg:'RS256',kid:'test'}).sign(privateKey);}
test('valid signed Access application token yields normalized email',async()=>{
 assert.deepEqual(await verifyAccessToken(await token(),config,jwks),{subject:'test-subject',email:'operator@example.test',name:'operator@example.test'});
});
test('wrong audience and issuer are rejected',async()=>{
 for(const claims of [{aud:['other-app']},{iss:'https://attacker.cloudflareaccess.com'}])await assert.rejects(verifyAccessToken(await token(claims),config,jwks));
});
test('expired and not-yet-valid tokens are rejected',async()=>{
 for(const claims of [{exp:timestamp-60},{nbf:timestamp+600}])await assert.rejects(verifyAccessToken(await token(claims),config,jwks));
});
test('unsigned, malformed and tampered tokens are rejected',async()=>{
 const signed=await token();const [head,body,signature]=signed.split('.');
 for(const candidate of ['not-a-jwt',`${head}.${Buffer.from(JSON.stringify({email:'admin@example.test'})).toString('base64url')}.${signature}`,`${Buffer.from('{"alg":"none"}').toString('base64url')}.${body}.`])await assert.rejects(verifyAccessToken(candidate,config,jwks));
});
test('organization sessions, service identities and absent email/expiry cannot become app users',async()=>{
 for(const claims of [{type:'org'},{sub:'',email:undefined},{email:undefined},{email:'not-email'},{exp:undefined}])await assert.rejects(verifyAccessToken(await token(claims),config,jwks));
});
test('unconfigured Access fails closed and key URLs cannot be chosen by a caller',()=>{
 for(const bad of [{},{ACCESS_TEAM_DOMAIN:'https://attacker.test',ACCESS_AUD:'x'},{ACCESS_TEAM_DOMAIN:'http://team.cloudflareaccess.com',ACCESS_AUD:'x'},{ACCESS_TEAM_DOMAIN:'https://team.cloudflareaccess.com/path',ACCESS_AUD:'x'}])assert.throws(()=>accessSettings(bad));
});
test('authenticated identity stays isolated across simultaneous requests',async()=>{
 const identities=['one@example.test','two@example.test'].map(email=>({email,subject:email,name:email}));
 assert.equal(getIdentity(),null);
 await Promise.all(identities.map(identity=>withIdentity(identity,async()=>{await new Promise(resolve=>setTimeout(resolve,5));assert.deepEqual(getIdentity(),identity);})));assert.equal(getIdentity(),null);
});
