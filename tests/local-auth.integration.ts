import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {createApp,type AppConfig} from '../apps/api/src/app.js';
import {bootstrapLocalAdmin,resetLocalAdmin} from '../scripts/setup-standalone.js';
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
      const r=await post(admin,'/api/v1/admin/local-users',{login,name:'Синтетический '+login,email:login+'@example.test',password:'Synthetic-initial-123',assignment:{role:'RIRU_ENGINEER',resId}});
      assert.equal(r.status,200,JSON.stringify(r.body));return r.body.id;
    };
    const engineerId=await create('engineer',area);await create('other',other);
    const engineer=await change(await login('engineer')),stranger=await change(await login('other'));
    const listing=await get(admin,'/api/v1/admin/local-users');assert.equal(listing.body.length,3);assert.equal(JSON.stringify(listing.body).includes('scrypt'),false);
    assert.equal((await get(engineer,'/api/v1/admin/local-users')).status,403);
    assert.equal((await post(engineer,'/api/v1/admin/local-users',{login:'intruder',name:'x',password:'Synthetic-initial-123',assignment:{role:'TECH_ADMIN',resId:null}})).status,403);
    for(const table of ['local_credentials','local_sessions'])await assert.rejects(runtime.query('SELECT * FROM app.'+table),{code:'42501'});
    pass('User provisioning and admin boundaries; raw credentials and sessions are inaccessible to runtime');

    const body={resId:area,contractNumber:'00001-26-00000006-1',contractDate:'2026-11-04',actNumber:'SYNTHETIC-LOCAL',applicant:'Учебный заявитель',address:'Учебный адрес'};
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
    assert.equal(Number((await owner.query("SELECT count(*) FROM app.idempotency WHERE path='/api/v1/admin/local-users' OR path LIKE '/api/v1/admin/local-users/%/access'")).rows[0].count),0);
    pass('Logout, expiry, brute-force lock/recovery and protection from self-disabling');

    const account=async(id:string)=>(await get(admin,'/api/v1/admin/local-users')).body.find((u:any)=>u.id===id);
    const profileBody=(u:any,patch:object={})=>({name:u.name,login:u.login,email:u.email,expectedRevision:u.revision,assignments:u.roles,...patch});
    const createBody={login:'mail.check',name:'Учебная почта',email:'  Mail.Check@Example.Test  ',password:'Synthetic-initial-123',assignment:{role:'SUE',resId:null}};
    const mailUser=await post(admin,'/api/v1/admin/local-users',createBody);assert.equal(mailUser.status,200,JSON.stringify(mailUser.body));
    assert.equal((await account(mailUser.body.id)).email,'mail.check@example.test');
    const duplicate=await post(admin,'/api/v1/admin/local-users',{...createBody,login:'mail.duplicate',email:'MAIL.CHECK@example.test'});
    assert.equal(duplicate.status,409);assert.equal(duplicate.body.error.code,'EMAIL_IN_USE');
    assert.equal((await post(admin,'/api/v1/admin/local-users',{...createBody,login:'mail.invalid',email:'broken'})).status,422);
    assert.equal((await account(own)).email,null);
    assert.equal((await post(stranger,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(await account(engineerId)))).status,403);
    assert.equal((await post(stranger,'/api/v1/admin/local-users/'+engineerId+'/delete',{expectedRevision:0})).status,403);
    pass('Email normalization/uniqueness, legacy accounts without invented email and admin-only profile/delete');

    // Synthetic cancelled task: keep its identity/assignment snapshots across edits and deletion.
    const oldAssignment=(await owner.query('SELECT id FROM app.roles WHERE user_id=$1 AND revoked_at IS NULL',[engineerId])).rows[0].id;
    const fileId=randomUUID(),versionId=randomUUID(),cycleId=randomUUID(),historyTask=randomUUID();
    await owner.query("INSERT INTO app.files(id,act_id,sha256,size,kind,scan_status,created_by) VALUES($1,$2,$3,1,'ACT_DOCX','READY',$4)",[fileId,actId,'a'.repeat(64),engineerId]);
    await owner.query("INSERT INTO app.versions(id,act_id,number,file_id,snapshot,created_by) VALUES($1,$2,1,$3,'{}',$4)",[versionId,actId,fileId,engineerId]);
    await owner.query("INSERT INTO app.cycles(id,act_id,version_id,number,state,closed_at) VALUES($1,$2,$3,1,'RETURNED',now())",[cycleId,actId,versionId]);
    await owner.query("INSERT INTO app.tasks(id,act_id,cycle_id,role,assignee_id,status,policy_id,calendar_snapshot,due_at,assignment_id) VALUES($1,$2,$3,'RIRU_ENGINEER',$4,'CANCELLED',(SELECT id FROM app.deadline_policies WHERE role='RIRU_ENGINEER' LIMIT 1),'[]',now(),$5)",[historyTask,actId,cycleId,engineerId,oldAssignment]);
    const historyBefore=(await owner.query('SELECT to_jsonb(t) AS data FROM app.tasks t WHERE id=$1',[historyTask])).rows[0].data;
    const beforeEdit=await account(engineerId),oldSession=await login('engineer','Synthetic-after-reset-012');
    const edited=await post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(beforeEdit,{name:'Учебное новое имя',login:'engineer.updated',email:'ENGINEER.UPDATED@EXAMPLE.TEST',assignments:[{role:'RIRU_ENGINEER',resId:other}]}));
    assert.equal(edited.status,200,JSON.stringify(edited.body));
    assert.equal((await get(oldSession,'/api/v1/me')).status,401);
    assert.equal((await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer',password:'Synthetic-after-reset-012'})).status,401);
    const editedSession=await login('engineer.updated','Synthetic-after-reset-012');
    const me=(await get(editedSession,'/api/v1/me')).body;
    assert.equal(me.id,engineerId);assert.equal(me.name,'Учебное новое имя');assert.equal(me.email,'engineer.updated@example.test');assert.deepEqual(me.roles,[{role:'RIRU_ENGINEER',resId:other}]);
    assert.equal((await get(editedSession,'/api/v1/acts/'+actId)).status,404);
    assert.ok((await owner.query('SELECT revoked_at FROM app.roles WHERE id=$1',[oldAssignment])).rows[0].revoked_at);
    assert.deepEqual((await owner.query('SELECT to_jsonb(t) AS data FROM app.tasks t WHERE id=$1',[historyTask])).rows[0].data,historyBefore);
    pass('Editing name/login/email/RES revokes sessions, preserves password and UUID, updates RLS, retains historical assignments');

    let current=await account(engineerId);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(current,{email:'OTHER@example.test'}))).body.error.code,'EMAIL_IN_USE');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(current,{login:'other'}))).body.error.code,'LOGIN_IN_USE');
    const [concurrent,parallelLogin]=await Promise.all([
      Promise.all(['Версия А','Версия Б'].map(name=>post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(current,{name:'Учебная '+name})))),
      request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer.updated',password:'Synthetic-after-reset-012'})
    ]);
    assert.equal(parallelLogin.status,200,JSON.stringify(parallelLogin.body));
    assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);assert.equal(concurrent.find(r=>r.status===409)!.body.error.code,'ACCOUNT_CHANGED');
    const retained=await account(engineerId);assert.equal(retained.email,'engineer.updated@example.test');assert.equal(retained.login,'engineer.updated');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+own+'/profile',profileBody(await account(own),{email:'admin@example.test',assignments:[]}))).body.error.code,'KEEP_ADMIN_ROLE');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+own+'/delete',{expectedRevision:0})).body.error.code,'SELF_DELETE');
    pass('Atomic duplicate rejection, concurrent edit conflict and self-admin protection');

    const liveAssignment=(await owner.query('SELECT id FROM app.roles WHERE user_id=$1 AND revoked_at IS NULL',[engineerId])).rows[0].id;
    const pendingAct=await post(editedSession,'/api/v1/acts',{...body,resId:other,contractNumber:'00001-26-00000007-1',actNumber:'SYNTHETIC-PENDING'});
    assert.equal(pendingAct.status,200,JSON.stringify(pendingAct.body));
    const pendingId=pendingAct.body.id,pendingFile=randomUUID(),pendingVersion=randomUUID(),pendingCycle=randomUUID(),liveTask=randomUUID();
    await owner.query("INSERT INTO app.files(id,act_id,sha256,size,kind,scan_status,created_by) VALUES($1,$2,$3,1,'ACT_DOCX','READY',$4)",[pendingFile,pendingId,'b'.repeat(64),engineerId]);
    await owner.query("INSERT INTO app.versions(id,act_id,number,file_id,snapshot,created_by) VALUES($1,$2,1,$3,'{}',$4)",[pendingVersion,pendingId,pendingFile,engineerId]);
    await owner.query("INSERT INTO app.cycles(id,act_id,version_id,number,state,closed_at) VALUES($1,$2,$3,1,'RETURNED',now())",[pendingCycle,pendingId,pendingVersion]);
    await owner.query("INSERT INTO app.tasks(id,act_id,cycle_id,role,assignee_id,status,policy_id,calendar_snapshot,due_at,assignment_id) VALUES($1,$2,$3,'RIRU_ENGINEER',$4,'OPEN',(SELECT id FROM app.deadline_policies WHERE role='RIRU_ENGINEER' LIMIT 1),'[]',now(),$5)",[liveTask,pendingId,pendingCycle,engineerId,liveAssignment]);
    current=await account(engineerId);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/delete',{expectedRevision:current.revision})).body.error.code,'ACCOUNT_IN_USE');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(current,{assignments:[]}))).body.error.code,'ROLE_IN_USE');
    await owner.query("UPDATE app.tasks SET status='CANCELLED',completed_at=now() WHERE id=$1",[liveTask]);
    const substituteId=(await owner.query("SELECT user_id FROM app.local_credentials WHERE login='other'")).rows[0].user_id;
    const subId=(await owner.query("INSERT INTO app.substitutions(role_id,substitute_id,starts_at,ends_at,created_by) VALUES($1,$2,now()+interval '1 day',now()+interval '2 days',$3) RETURNING id",[liveAssignment,substituteId,own])).rows[0].id;
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/profile',profileBody(current,{assignments:[]}))).body.error.code,'ROLE_IN_USE');
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+substituteId+'/delete',{expectedRevision:(await account(substituteId)).revision})).body.error.code,'ACCOUNT_IN_USE');
    await owner.query("UPDATE app.substitutions SET starts_at=now()-interval '2 days',ends_at=now()-interval '1 day' WHERE id=$1",[subId]);
    pass('Open task and future substitution prevent role removal/account deletion without changing assignments');

    const toDelete=await account(engineerId),liveSession=await login('engineer.updated','Synthetic-after-reset-012');
    const [deletion,...parallelLogins]=await Promise.all([
      post(admin,'/api/v1/admin/local-users/'+engineerId+'/delete',{expectedRevision:toDelete.revision}),
      ...Array.from({length:3},()=>request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer.updated',password:'Synthetic-after-reset-012'}))
    ]);
    assert.equal(deletion.status,200,JSON.stringify(deletion.body));
    for(const response of parallelLogins){assert.ok([200,401].includes(response.status),JSON.stringify(response.body));if(response.status===200)assert.equal((await get(take(response),'/api/v1/me')).status,401);}
    assert.equal(await account(engineerId),undefined);
    assert.equal((await get(liveSession,'/api/v1/me')).status,401);
    assert.equal((await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'engineer.updated',password:'Synthetic-after-reset-012'})).status,401);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/access',{active:true})).status,404);
    assert.equal((await post(admin,'/api/v1/admin/local-users/'+engineerId+'/roles',{role:'SUE',resId:null})).status,404);
    assert.equal((await owner.query('SELECT author_id FROM app.acts WHERE id=$1',[actId])).rows[0].author_id,engineerId);
    assert.deepEqual((await owner.query('SELECT to_jsonb(t) AS data FROM app.tasks t WHERE id=$1',[historyTask])).rows[0].data,historyBefore);
    assert.ok((await owner.query("SELECT 1 FROM app.audit_events WHERE action='LOCAL_ACCOUNT_DELETED' AND details->>'userId'=$1",[engineerId])).rowCount);
    assert.equal(Number((await owner.query('SELECT count(*) FROM app.local_credentials WHERE user_id=$1',[engineerId])).rows[0].count),0);
    const recreated=await post(admin,'/api/v1/admin/local-users',{login:'engineer.updated',name:'Учебная новая учётная запись',email:'engineer.updated@example.test',password:'Synthetic-initial-123',assignment:{role:'RIRU_ENGINEER',resId:other}});
    assert.equal(recreated.status,200,JSON.stringify(recreated.body));assert.notEqual(recreated.body.id,engineerId);
    assert.equal((await owner.query('SELECT author_id FROM app.acts WHERE id=$1',[actId])).rows[0].author_id,engineerId);
    pass('Deletion removes credentials, revokes login, preserves history/audit; reused login/email creates a different identity');

    const second=await post(admin,'/api/v1/admin/local-users',{login:'second.admin',name:'Учебный второй администратор',email:'second.admin@example.test',password:'Synthetic-initial-123',assignment:{role:'TECH_ADMIN',resId:null}});
    assert.equal(second.status,200);const secondId=second.body.id,secondSession=await change(await login('second.admin'));
    const originalVersion=(await account(own)).revision,secondVersion=(await account(secondId)).revision;
    const crossed=await Promise.all([post(admin,'/api/v1/admin/local-users/'+secondId+'/delete',{expectedRevision:secondVersion}),post(secondSession,'/api/v1/admin/local-users/'+own+'/delete',{expectedRevision:originalVersion})]);
    assert.equal(crossed.filter(r=>r.status===200).length,1);assert.ok(crossed.some(r=>r.status===403||r.status===401));
    assert.equal(Number((await owner.query("SELECT count(*) FROM app.users u JOIN app.roles r ON r.user_id=u.id WHERE u.active AND r.role='TECH_ADMIN' AND r.revoked_at IS NULL")).rows[0].count),1);
    pass('Concurrent administrators cannot delete each other and leave the system without an administrator');
    await owner.query("UPDATE app.local_credentials SET failed_attempts=5,locked_until=now()+interval '15 minutes' WHERE login='admin'");
    await resetLocalAdmin(ownerUrl,'1191');
    const resetLogin=await request(app).post('/auth/login').set('Host','app.test').set('Origin','https://app.test').send({login:'admin',password:'1191'});
    assert.equal(resetLogin.status,200,JSON.stringify(resetLogin.body));assert.equal(resetLogin.body.mustChangePassword,false);
    assert.equal((await owner.query("SELECT count(*) FROM app.audit_events WHERE action='LOCAL_ADMIN_PASSWORD_RESET'")).rows[0].count,'1');
    pass('ADMIN_RESET_PASSWORD restores admin login with a 4-digit password, unlocks the account and is audited');
    const adminClient=take(resetLogin);
    const before=(await get(adminClient,'/api/v1/admin/calendar?year=2026')).body;assert.equal(before.filter((d:any)=>d.working).length,247);
    const saved=await post(adminClient,'/api/v1/admin/calendar',{days:[{day:'2026-12-30',working:false,source:'Синтетический приказ № 1'}]});assert.equal(saved.status,200,JSON.stringify(saved.body));
    const after=(await get(adminClient,'/api/v1/admin/calendar?year=2026')).body.find((d:any)=>d.day==='2026-12-30');assert.equal(after.working,false);assert.equal(after.source,'Синтетический приказ № 1');assert.equal(after.revision,2);
    assert.equal((await request(app).get('/api/v1/admin/calendar?year=2026')).status,401);
    pass('TECH_ADMIN edits the production calendar with a recorded reason; seeded 2026 calendar has 247 working days');
    const createdField=await post(adminClient,'/api/v1/admin/card-fields',{label:'Номер опоры',kind:'text',required:false,sort:50});assert.equal(createdField.status,200,JSON.stringify(createdField.body));assert.equal(createdField.body.code,'f_nomer_opory');
    assert.equal((await post(adminClient,'/api/v1/admin/card-fields',{label:'Тип опоры',kind:'select',options:[]})).body.error.code,'CARD_OPTIONS_REQUIRED');
    assert.equal((await post(adminClient,'/api/v1/admin/card-fields/f_nomer_opory',{kind:'number'})).body.error.code,'CARD_KIND_FIXED');
    const off=await post(adminClient,'/api/v1/admin/card-fields/f_nomer_opory',{active:false,label:'Номер опоры (старое)'});assert.equal(off.status,200);assert.equal(off.body.active,false);
    const listed=(await get(adminClient,'/api/v1/admin/card-fields'.replace('/admin','')+'?all=1')).body;assert.ok(listed.some((f:any)=>f.code==='f_nomer_opory'&&!f.active));
    assert.ok(!(await get(adminClient,'/api/v1/card-fields')).body.some((f:any)=>f.code==='f_nomer_opory'));
    pass('Administrator adds and disables card fields without migrations; kind is fixed; list fields require options');
    const someRes=(await owner.query("SELECT id FROM app.res_units WHERE code='ADLER'")).rows[0].id;
    const withPosition=await post(adminClient,'/api/v1/admin/local-users',{login:'positioned',name:'Синтетический с должностью',email:'positioned@example.test',position:'Начальник РИРУ',password:'Synthetic-initial-123',assignment:{role:'RIRU_HEAD',resId:someRes}});assert.equal(withPosition.status,200,JSON.stringify(withPosition.body));
    let positioned=(await get(adminClient,'/api/v1/admin/local-users')).body.find((u:any)=>u.login==='positioned');assert.equal(positioned.position,'Начальник РИРУ');
    const moved=await post(adminClient,`/api/v1/admin/local-users/${positioned.id}/profile`,{login:'positioned',name:positioned.name,email:positioned.email,position:'Заместитель начальника РИРУ',expectedRevision:positioned.revision,assignments:positioned.roles});assert.equal(moved.status,200,JSON.stringify(moved.body));
    positioned=(await get(adminClient,'/api/v1/admin/local-users')).body.find((u:any)=>u.login==='positioned');assert.equal(positioned.position,'Заместитель начальника РИРУ');
    pass('Administrator sets and edits employee position; it is returned with the account');
  }finally{await runtime.end();await owner.end();}
}
