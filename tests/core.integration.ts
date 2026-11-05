import {completeRiruReview} from './riru-review.fixture.js';
import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { generateKeyPair,exportJWK,createLocalJWKSet,SignJWT } from 'jose';
import { createApp } from '../apps/api/src/app.js';
import { verifier } from '../apps/api/src/auth.js';
import { transaction } from '../apps/api/src/db.js';
import { zip,docxParts } from './zip.js';

export async function runIntegration(ownerUrl:string,runtimeUrl:string,root:string) {
  const owner=new pg.Pool({connectionString:ownerUrl});const runtime=new pg.Pool({connectionString:runtimeUrl,max:8});
  const key=await generateKeyPair('RS256');const jwk=await exportJWK(key.publicKey);jwk.kid='integration';
  const config={issuer:'https://synthetic.test',audience:'tp-approval',jwksUrl:'https://synthetic.test/jwks',platformOrigin:'https://platform.test',storagePath:resolve(root,'files'),maxFileBytes:1024*1024,production:false};
  const app=createApp(runtime,config,verifier(config,createLocalJWKSet({keys:[jwk]})));
  let checks=0;const pass=(name:string)=>{checks++;console.log(`OK ${checks}: ${name}`);};
  const tokens:Record<string,string>={};const users:Record<string,string>={};
  try {
    const res=(await owner.query('SELECT * FROM app.res_units ORDER BY code')).rows;
    const area=res[0].id;const other=res[1].id;
    for(const [name,role,scope] of [['riru','RIRU_ENGINEER',area],['riru-head','RIRU_HEAD',area],['chief','RES_HEAD',area],['sue','SUE',null],['stp','STP',null],['gi','GI',null],['other','RIRU_ENGINEER',other],['tech','TECH_ADMIN',null],['process','PROCESS_ADMIN',null]]) {
      users[name]=(await owner.query('INSERT INTO app.users(issuer,subject,name) VALUES($1,$2,$2) RETURNING id',[config.issuer,name])).rows[0].id;
      await owner.query('INSERT INTO app.roles(user_id,role,res_id) VALUES($1,$2,$3)',[users[name],role,scope]);
      tokens[name]=await new SignJWT({realm_access:{roles:['tp-approval-user']}}).setProtectedHeader({alg:'RS256',kid:'integration'}).setIssuer(config.issuer).setSubject(name).setAudience(config.audience).setIssuedAt().setExpirationTime('1h').sign(key.privateKey);
    }
    const get=(user:string,path:string)=>request(app).get(path).set('Authorization',`Bearer ${tokens[user]}`);
    const post=(user:string,path:string,body:object,k=randomUUID())=>completeRiruReview(request(app).post(path).set('Authorization',`Bearer ${tokens[user]}`).set('Idempotency-Key',k).send(body),app,tokens,owner);
    assert.equal((await request(app).get('/api/v1/acts')).status,401);pass('API rejects unauthenticated access');
    await owner.query('DELETE FROM app.calendar_days');await owner.query("INSERT INTO app.calendar_days SELECT d::date,extract(isodow FROM d)<6,'SYNTHETIC TEST CALENDAR',1 FROM generate_series(current_date-1,current_date+450,'1 day') d");
    const body={resId:area,contractNumber:'00001-26-00000002-1',contractDate:'2026-01-01',actNumber:'TEST-1',applicant:'Синтетический заявитель',address:'Тестовый адрес'};
    const badNumber=await post('riru','/api/v1/acts',{...body,contractNumber:'0001/ТП',actNumber:'0001/ТП'});assert.equal(badNumber.status,422);assert.equal(badNumber.body.error.code,'CONTRACT_NUMBER_FORMAT');
    const created=await post('riru','/api/v1/acts',body);assert.equal(created.status,200,JSON.stringify(created.body));const actId=created.body.id;
    assert.equal((await post('other','/api/v1/acts',body)).status,403);
    assert.equal((await get('other',`/api/v1/acts/${actId}`)).status,404);assert.equal((await get('tech',`/api/v1/acts/${actId}`)).status,200,'TECH_ADMIN reads every document (owner decision 05.11.2026)');
    assert.deepEqual((await get('other','/api/v1/acts')).body,[]);pass('RES isolation; TECH_ADMIN reads documents of every RES');
    assert.equal((await runtime.query('SELECT count(*) FROM app.acts')).rows[0].count,'0');
    await transaction(runtime,users.other,async db=>assert.equal((await db.query('SELECT count(*) FROM app.acts')).rows[0].count,'0'));
    await transaction(runtime,users.riru,async db=>assert.equal((await db.query('SELECT count(*) FROM app.acts')).rows[0].count,'1'));
    assert.equal((await runtime.query('SELECT count(*) FROM app.acts')).rows[0].count,'0');pass('Real RLS and transaction context isolation');
    const upload=()=>request(app).post(`/api/v1/acts/${actId}/files`).set('Authorization',`Bearer ${tokens.riru}`).attach('file',zip(docxParts),'synthetic.docx');
    const file=await upload();assert.equal(file.status,201,JSON.stringify(file.body));
    assert.equal((await get('other',`/api/v1/files/${file.body.id}/download`)).status,404);assert.equal((await get('riru',`/api/v1/files/${file.body.id}/download`)).status,200);pass('Private DOCX upload and protected download');
    const makeVersion=async()=>{const ar=await get('riru',`/api/v1/acts/${actId}`);assert.equal(ar.status,200,JSON.stringify(ar.body));const a=ar.body;const v=await post('riru',`/api/v1/acts/${actId}/versions`,{fileId:file.body.id,expectedRevision:a.revision});assert.equal(v.status,200,JSON.stringify(v.body));return v.body;};
    const v1=await makeVersion();
    assert.equal((await post('riru',`/api/v1/acts/${actId}/versions`,{fileId:file.body.id,expectedRevision:0})).status,412);pass('Stale revisions cannot overwrite newer work');
    await assert.rejects(runtime.query('UPDATE app.versions SET number=99 WHERE id=$1',[v1.id]));pass('Submitted versions cannot be overwritten by runtime');
    const submitVersion=async(v:Record<string,any>)=>{const a=(await get('riru',`/api/v1/acts/${actId}`)).body;return post('riru',`/api/v1/acts/${actId}/submit`,{versionId:v.id,expectedRevision:a.revision});};
    const removed=(await owner.query('DELETE FROM app.calendar_days WHERE day=current_date+1 RETURNING *')).rows[0];
    assert.equal((await submitVersion(v1)).status,409);assert.equal((await owner.query('SELECT count(*) FROM app.cycles')).rows[0].count,'0');
    await owner.query('INSERT INTO app.calendar_days(day,working,source,revision) VALUES($1,$2,$3,$4)',[removed.day,removed.working,removed.source,removed.revision]);pass('Calendar gaps abort submission atomically');
    const submitted=await submitVersion(v1);assert.equal(submitted.status,200,JSON.stringify(submitted.body));
    const myTask=async(name:string)=>(await get(name,'/api/v1/tasks/mine')).body.find((t:any)=>t.act_id===actId);
    const decision=async(name:string,choice='APPROVE',reason='',k=randomUUID())=>post(name,`/api/v1/tasks/${(await myTask(name)).id}/decision`,{decision:choice,reason},k);
    const chief=await myTask('chief');const dkey=randomUUID();const dpath=`/api/v1/tasks/${chief.id}/decision`;
    await owner.query("INSERT INTO app.roles(user_id,role,res_id) VALUES($1,'RES_HEAD',$2)",[users.riru,area]);
    await owner.query('UPDATE app.tasks SET assignee_id=$1,assignment_id=NULL WHERE id=$2',[users.riru,chief.id]);
    assert.equal((await post('riru',dpath,{decision:'APPROVE'})).status,403);
    await owner.query('UPDATE app.tasks SET assignee_id=$1 WHERE id=$2',[users.chief,chief.id]);
    await owner.query("DELETE FROM app.roles WHERE user_id=$1 AND role='RES_HEAD'",[users.riru]);pass('Same user cannot approve their own document in another role');
    const duplicate=await Promise.all([post('chief',dpath,{decision:'APPROVE'},dkey),post('chief',dpath,{decision:'APPROVE'},dkey)]);assert.ok(duplicate.every(d=>d.status===200),JSON.stringify(duplicate.map(d=>d.body)));
    assert.equal((await owner.query('SELECT count(*) FROM app.decisions WHERE task_id=$1',[chief.id])).rows[0].count,'1');pass('Concurrent idempotent decisions create one result');
    assert.equal((await get('sue','/api/platform/badge')).body.count,1);assert.equal((await get('riru','/api/platform/badge')).body.count,0);
    assert.equal((await decision('sue','RETURN','Ошибка в мощности')).status,200);
    assert.equal((await get('riru',`/api/v1/acts/${actId}`)).body.state,'CENTRAL_COLLECTING');
    assert.ok(await myTask('stp'));assert.equal((await submitVersion(v1)).status,409);
    await decision('stp');await decision('gi');assert.equal((await get('riru',`/api/v1/acts/${actId}`)).body.state,'RETURNED');
    assert.equal((await get('riru','/api/platform/badge')).body.count,1);pass('Parallel return collects other decisions then assigns rework');
    const v2=await makeVersion();let detail=(await get('riru',`/api/v1/acts/${actId}`)).body;const comment=detail.comments[0];
    assert.equal((await post('riru',`/api/v1/comments/${comment.id}/events`,{versionId:v2.id,type:'REPORTED_FIXED',explanation:'Мощность исправлена'})).status,200);
    assert.equal((await submitVersion(v2)).status,200);await decision('chief');
    assert.equal((await decision('sue')).status,409);
    assert.equal((await post('stp',`/api/v1/comments/${comment.id}/events`,{versionId:v2.id,type:'VERIFIED',explanation:'Проверено'})).status,403);
    assert.equal((await post('sue',`/api/v1/comments/${comment.id}/events`,{versionId:v2.id,type:'VERIFIED',explanation:'Исправление подтверждено автором'})).status,200);
    const results=await Promise.all(['sue','stp','gi'].map(name=>decision(name)));assert.ok(results.every(r=>r.status===200),JSON.stringify(results.map(r=>r.body)));
    detail=(await get('riru',`/api/v1/acts/${actId}`)).body;assert.equal(detail.state,'APPROVED');assert.equal(detail.cycles.length,2);assert.equal(detail.versions.length,2);assert.equal(detail.releases.length,1);pass('New cycle, author verifies fix, concurrent three approvals yield one release');
    assert.equal((await post('riru',`/api/v1/acts/${actId}/revise`,{reason:'Пересмотр',expectedRevision:detail.revision})).status,200);
    detail=(await get('riru',`/api/v1/acts/${actId}`)).body;assert.equal(detail.releases[0].status,'UNDER_REVISION');pass('Review keeps previous approved publication explicitly marked');
    const v3=await makeVersion();await submitVersion(v3);await decision('chief');
    const subUser=(await owner.query('INSERT INTO app.users(issuer,subject,name) VALUES($1,$2,$2) RETURNING id',[config.issuer,'substitute'])).rows[0].id;
    tokens.substitute=await new SignJWT({realm_access:{roles:['tp-approval-user']}}).setProtectedHeader({alg:'RS256',kid:'integration'}).setIssuer(config.issuer).setSubject('substitute').setAudience(config.audience).setIssuedAt().setExpirationTime('1h').sign(key.privateKey);
    const sueRole=(await owner.query("SELECT id FROM app.roles WHERE user_id=$1 AND role='SUE'",[users.sue])).rows[0].id;
    const substitution=await post('process','/api/v1/admin/substitutions',{roleId:sueRole,substituteId:subUser,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()});assert.equal(substitution.status,200,JSON.stringify(substitution.body));
    assert.equal((await get('substitute','/api/platform/badge')).body.count,1);assert.equal((await get('sue','/api/platform/badge')).body.count,0);
    await owner.query("UPDATE app.substitutions SET ends_at=now()-interval '1 second' WHERE id=$1",[substitution.body.id]);
    assert.equal((await get('substitute','/api/platform/badge')).body.count,0);assert.equal((await get('sue','/api/platform/badge')).body.count,1);pass('Dated substitution changes active task ownership and badge, then expires');
    assert.equal((await post('process',`/api/v1/acts/${actId}/close-collection`,{reason:'Срок истёк'})).status,409);
    await owner.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[actId]);
    const deadlineRun=await post('process','/api/v1/admin/run-deadlines',{});assert.equal(deadlineRun.status,200,JSON.stringify(deadlineRun.body));assert.ok(deadlineRun.body.emitted>=6);
    assert.equal((await post('process','/api/v1/admin/run-deadlines',{})).body.emitted,0);pass('Overdue notifications and escalation journal are deduplicated');
    assert.equal((await post('tech',`/api/v1/acts/${actId}/close-collection`,{reason:'Попытка'})).status,403,'Read access does not let TECH_ADMIN act on the workflow');
    assert.equal((await post('process',`/api/v1/acts/${actId}/close-collection`,{reason:'Срок истёк'})).status,200);
    assert.equal((await owner.query("SELECT count(*) FROM app.tasks WHERE act_id=$1 AND status='CANCELLED'",[actId])).rows[0].count,'3');pass('Only scoped process admin closes expired collection, missing decisions stay missing');
    const notes=(await get('riru','/api/v1/notifications')).body;assert.ok(notes.length>0);await post('riru',`/api/v1/notifications/${notes[0].id}/read`,{});assert.equal((await get('riru','/api/platform/badge')).body.count,1);pass('Unread notifications and action badge are independent');
    // Удаление насовсем документов с полной историей (циклы, решения, неизменяемые замечания, публикации): ничего не остаётся.
    const everything=(await owner.query('SELECT id FROM app.acts')).rows.map(r=>r.id as string);assert.ok(everything.length>0);
    const withRemarks=Number((await owner.query('SELECT count(*) FROM app.comments')).rows[0].count);assert.ok(withRemarks>0,'Fixture has immutable remarks');
    for(const target of everything){const r=await post('tech','/api/v1/admin/service/purge',{kind:'document',id:target,confirm:'УДАЛИТЬ'});assert.equal(r.status,200,JSON.stringify(r.body));}
    for(const table of ['acts','versions','files','cycles','tasks','decisions','comments','comment_events','releases','notifications','technical_conditions','contracts'])
     assert.equal(Number((await owner.query(`SELECT count(*) FROM app.${table}`)).rows[0].count),0,`${table} is empty after purge`);
    assert.equal(Number((await owner.query("SELECT count(*) FROM app.audit_events WHERE action='ADMIN_PURGE_DOCUMENT'")).rows[0].count),everything.length);
    assert.equal((await post('process','/api/v1/admin/service/purge',{kind:'document',id:everything[0],confirm:'УДАЛИТЬ'})).status,403);
    pass('TECH_ADMIN purges documents with full history; immutable history is removed only by the audited purge; PROCESS_ADMIN cannot');
    console.log(`PASS: ${checks} интеграционных групп; PostgreSQL ${(await owner.query('SHOW server_version')).rows[0].server_version}`);
  } finally {await runtime.end();await owner.end();}
}