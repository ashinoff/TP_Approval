import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, createLocalJWKSet, SignJWT } from 'jose';
import { verifier } from '../apps/api/src/auth.js';
import { validateDocx } from '../apps/api/src/files.js';
import { zip,docxParts } from './zip.js';
import { createServer } from 'node:http';
test('DOCX: accepts synthetic OOXML and rejects invalid/active/external XML',async()=>{
  await validateDocx(zip(docxParts));
  await assert.rejects(validateDocx(Buffer.from('not zip')));
  await assert.rejects(validateDocx(zip({...docxParts,'word/vbaProject.bin':'macro'})));
  await assert.rejects(validateDocx(zip({...docxParts,'_rels/.rels':'<Relationships><Relationship TargetMode="External" Target="http://127.0.0.1"/></Relationships>'})));
  await assert.rejects(validateDocx(zip({...docxParts,'word/document.xml':'<!DOCTYPE x [<!ENTITY y SYSTEM "file:///secret">]><x>&y;</x>'})));
});
test('JWT: verifies signature, issuer, audience, expiry and platform role',async()=>{
  const key=await generateKeyPair('RS256');const jwk=await exportJWK(key.publicKey);jwk.kid='test';
  const verify=verifier({issuer:'https://issuer.test',audience:'tp-approval',jwksUrl:'https://issuer.test/jwks'},createLocalJWKSet({keys:[jwk]}));
  const token=async(aud='tp-approval',roles=['tp-approval-user'],exp='1h')=>new SignJWT({realm_access:{roles}}).setProtectedHeader({alg:'RS256',kid:'test'}).setSubject('person').setIssuer('https://issuer.test').setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key.privateKey);
  assert.equal((await verify(`Bearer ${await token()}`)).subject,'person');
  await assert.rejects(verify(undefined));await assert.rejects(verify('Bearer dev-token'));
  await assert.rejects(verify(`Bearer ${await token('wrong')}`));await assert.rejects(verify(`Bearer ${await token('tp-approval',[])}`));await assert.rejects(verify(`Bearer ${await token('tp-approval',['tp-approval-user'],'-1h')}`));
});
test('JWKS: production resolver fetches public keys over HTTP and rejects a forged signature',async()=>{
  const key=await generateKeyPair('RS256');const wrong=await generateKeyPair('RS256');const jwk=await exportJWK(key.publicKey);jwk.kid='remote';
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({keys:[jwk]}));});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const issuer=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
  try{
    const verify=verifier({issuer,audience:'tp-approval',jwksUrl:`${issuer}/jwks`});
    const jwt=(privateKey:CryptoKey)=>new SignJWT({realm_access:{roles:['tp-approval-user']}}).setProtectedHeader({alg:'RS256',kid:'remote'}).setIssuer(issuer).setAudience('tp-approval').setSubject('test').setIssuedAt().setExpirationTime('5m').sign(privateKey);
    assert.equal((await verify(`Bearer ${await jwt(key.privateKey)}`)).subject,'test');
    await assert.rejects(verify(`Bearer ${await jwt(wrong.privateKey)}`));
  }finally{await new Promise<void>((ok,fail)=>server.close(error=>error?fail(error):ok()));}
});
