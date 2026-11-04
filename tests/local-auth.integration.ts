import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp,type AppConfig} from '../apps/api/src/app.js';
import {bootstrapLocalAdmin} from '../scripts/setup-standalone.js';
import {zip,docxParts} from './zip.js';

export async function runLocalAuthIntegration(ownerUrl:string,runtimeUrl:string,root:string){
  const owner=new pg.Pool({connectionString:ownerUrl}),runtime=new pg.Pool({connectionString:runtimeUrl});
  const config:AppConfig={authMode:'local',production:true,appOrigin:'https://app.test',storagePath:resolve(root,'local-files'),maxFileBytes:1024*1024};
  let app=createApp(runtime,config),checks=0;
  const pass=(name:string)=>console.log(`LOCAL ${++checks}: ${name}`);
  type Client={cookie:string;csrf:string};
  const take=(r:request.Response):Client=>({cookie:r.headers['set-cookie'][0].split(';')[0],csrf:r.body.csrfToken});
  const post=(client:Client,path:string,body:object)=>request(app).post(path).set('Host','app.test').set('Origin','https://app.test').set('Cookie',client.cookie).set('X-CSRF-Token',client.csrf).set('Idempotency-Key',randomUUID()).send(body);
  const get=(client:Client,path:string)=>request(app).get(path).set('Cookie',client.cookie);
  const login=async(name:string,password='Synthetic-initial-123')=>{
    const r=await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:name,password});
    assert.equal(r.status,200,JSON.stringify(r.body));return take(r);
  };
  const change=async(client:Client,currentPassword='Synthetic-initial-123',newPassword='Synthetic-personal-456')=>{
    const r=await post(client,'/auth/password',{currentPassword,newPassword});assert.equal(r.status,200,JSON.stringify(r.body));return take(r);
  };
  try{
    assert.equal(await bootstrapLocalAdmin(ownerUrl,'Synthetic-initial-123'),true);
    assert.equal(await bootstrapLocalAdmin(ownerUrl,'Never-reset-existing-password'),false);
    assert.deepEqual((await request(app).get('/auth/session')).body,{mode:'local',authenticated:false});
    assert.equal((await request(app).get('/api/v1/me')).status,401);
    assert.equal((await request(app).get('/api/v1/me').set('Authorization','Bearer dev-token')).status,401);
    assert.equal((await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://evil.test').send({login:'admin',password:'Synthetic-initial-123'})).status,403);
    let admin=await login('ADMIN');
    assert.match(admin.cookie,/^__Host-tp_session=/);
    const loginResponse=await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'admin',password:'Synthetic-initial-123'});
    const cookieOptions=loginResponse.headers['set-cookie'][0];assert.match(cookieOptions,/HttpOnly/);assert.match(cookieOptions,/Secure/);assert.match(cookieOptions,/SameSite=Strict/);assert.equal(cookieOptions.includes('Domain='),false);
    assert.equal((await get(admin,'/api/v1/me')).body.error.code,'PASSWORD_CHANGE_REQUIRED');
    const oldAdmin=admin;admin=await change(admin);
    assert.equal((await get(oldAdmin,'/api/v1/me')).status,401);
    assert.equal((await get(admin,'/api/v1/me')).status,200);
    pass('HTTPS cookie, mandatory first change, rotation, no bearer bypass, bootstrap never resets');

    const units=(await get(admin,'/api/v1/res')).body,area=units[0].id,other=units[1].id;
    const create=async(login:string,resId:string)=>{
      const r=await post(admin,'/api/v1/admin/local-users',{login,name:'Синтетический '+login,password:'Synthetic-initial-123',assignment:{role:'RIRU_ENGINEER',resId}});
      assert.equal(r.status,200,JSON.stringify(r.body));return r.body.id;
    };
    const engineerId=await create('engineer',area);await create('other',other);
    const engineer=await change(await login('engineer')),stranger=await change(await login('other'));
    const listing=await get(admin,'/api/v1/admin/local-users');assert.equal(listing.body.length,3);assert.equal(JSON.stringify(listing.body).includes('scrypt'),false);
    assert.equal((await get(engineer,'/api/v1/admin/local-users')).status,403);
    assert.equal((await post(engineer,'/api/v1/admin/local-users',{login:'intruder',name:'x',password:'Synthetic-initial-123',assignment:{role:'TECH_ADMIN',resId:null}})).status,403);
    for(const table of ['local_credentials','local_sessions'])await assert.rejects(runtime.query('SELECT * FROM app.'+table),{code:'42501'});
    pass('User provisioning and admin boundaries; raw credentials and sessions are inaccessible to runtime');

    const body={resId:area,contractNumber:'SYNTHETIC-LOCAL',contractDate:'2026-11-04',actNumber:'SYNTHETIC-LOCAL',applicant:'Учебный заявитель',address:'Учебный адрес'};
    const missingCsrf=await request(app).post('/api/v1/acts').set('Host','app.test').set('Origin','https://app.test').set('Cookie',engineer.cookie).send(body);
    assert.equal(missingCsrf.status,403);
    assert.equal((await request(app).post('/api/v1/acts').set('Host','app.test').set('Origin','https://evil.test').set('Cookie',engineer.cookie).set('X-CSRF-Token',engineer.csrf).send(body)).status,403);
    const created=await post(engineer,'/api/v1/acts',body);assert.equal(created.status,200,JSON.stringify(created.body));
    const actId=created.body.id;
    assert.equal((await get(stranger,'/api/v1/acts/'+actId)).status,404);
    assert.equal((await get(admin,'/api/v1/acts/'+actId)).status,404);
    assert.equal((await post(stranger,'/api/v1/acts',body)).status,403);
    assert.equal(Number((await runtime.query('SELECT count(*) FROM app.acts')).rows[0].count),0);
    pass('CSRF, RLS, RES isolation and no document access for TECH_ADMIN');

    for(const path of ['/api/v1/acts/'+actId+'/files','/api/v1/documents/extract-tu']){
      const upload=request(app).post(path).set('Host','app.test').set('Origin','https://app.test').set('Cookie',engineer.cookie).set('X-CSRF-Token',engineer.csrf);
      if(path.endsWith('extract-tu'))upload.field('resId',area);
      const r=await upload.attach('file',zip(docxParts),'synthetic.docx');
      assert.equal(r.status,503,JSON.stringify(r.body));assert.equal(r.body.error.code,'SCANNER_NOT_CONFIGURED');
    }
    assert.equal(Number((await owner.query('SELECT count(*) FROM app.files')).rows[0].count),0);
    pass('Production opens the interface but both upload paths fail closed without a scanner');

    app=createApp(runtime,config);
    assert.equal((await get(engineer,'/api/v1/acts/'+actId)).status,200);
    assert.equal((await get(engineer,'/auth/session')).body.authenticated,true);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/access',{password:'Synthetic-reset-789'})).status,200);
    assert.equal((await get(engineer,'/api/v1/me')).status,401);
    const reset=await login('engineer','Synthetic-reset-789');assert.equal((await get(reset,'/api/v1/me')).body.error.code,'PASSWORD_CHANGE_REQUIRED');
    const renewed=await change(reset,'Synthetic-reset-789','Synthetic-after-reset-012');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/access',{active:false})).status,200);
    assert.equal((await get(renewed,'/api/v1/me')).status,401);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/access',{active:true})).status,200);
    assert.equal((await get(renewed,'/api/v1/me')).status,401);
    pass('Session survives app recreation; password reset and account disabling revoke all sessions');

    const unlocked=await login('engineer','Synthetic-after-reset-012');
    assert.equal((await post(unlocked,'/auth/logout',{})).status,200);
    assert.equal((await get(unlocked,'/api/v1/me')).status,401);
    const expiring=await login('engineer','Synthetic-after-reset-012');
    await owner.query("UPDATE app.local_sessions SET expires_at=now()-interval '1 second' WHERE user_id=$1",[engineerId]);
    assert.equal((await get(expiring,'/api/v1/me')).status,401);
    for(let i=0;i<5;i++)assert.equal((await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer',password:'wrong'})).status,401);
    assert.equal((await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer',password:'Synthetic-after-reset-012'})).status,401);
    await owner.query("UPDATE app.local_credentials SET locked_until=now()-interval '1 second' WHERE user_id=$1",[engineerId]);
    await login('engineer','Synthetic-after-reset-012');
    const own=(await get(admin,'/api/v1/me')).body.id;
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+own+'/access',{active:false})).status,409);
    assert.equal(Number((await owner.query("SELECT count(*) FROM app.idempotency WHERE path LIKE '/api/v1/admin/local-users%' AND path NOT LIKE '%/roles'")).rows[0].count),0);
    pass('Logout, expiry, brute-force lock/recovery and protection from self-disabling');
  }finally{await runtime.end();await owner.end();}
}
