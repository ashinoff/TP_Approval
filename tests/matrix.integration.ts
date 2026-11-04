import {completeRiruReview} from './riru-review.fixture.js';
import assert from 'node:assert/strict';
import pg from 'pg';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {generateKeyPair,exportJWK,createLocalJWKSet,SignJWT} from 'jose';
import {createApp} from '../apps/api/src/app.js';
import {verifier} from '../apps/api/src/auth.js';
import {transaction} from '../apps/api/src/db.js';
import {zip,docxParts} from './zip.js';
import {runRegistryChecks} from './registry.integration.js';
import {runDocumentChecks} from './documents.integration.js';
import {runContractDocumentChecks} from './contract-documents.integration.js';
import {runRiruChecks} from './riru-review.integration.js';
import {runEngineerChecks} from './engineer.integration.js';
import {synthContract} from './synthetic-contract.js';

export async function runMatrixIntegration(ownerUrl:string,runtimeUrl:string,root:string){
  const owner=new pg.Pool({connectionString:ownerUrl});const runtime=new pg.Pool({connectionString:runtimeUrl});
  const keys=await generateKeyPair('RS256');const jwk=await exportJWK(keys.publicKey);jwk.kid='matrix';
  const config={issuer:'https://matrix.synthetic.test',audience:'tp-approval',jwksUrl:'https://matrix.synthetic.test/jwks',platformOrigin:'https://platform.test',storagePath:resolve(root,'matrix-files'),maxFileBytes:1024*1024,production:false};
  const app=createApp(runtime,config,verifier(config,createLocalJWKSet({keys:[jwk]})));
  const tokens:Record<string,string>={};const users:Record<string,string>={};let checks=0;
  const pass=(name:string)=>console.log(`MATRIX OK ${++checks}: ${name}`);
  try{
    const areas=(await owner.query("SELECT id,code FROM app.res_units WHERE code IN ('ADLER','HOSTA') ORDER BY code")).rows;
    const area=areas[0].id;const other=areas[1].id;
    for(const [subject,role,scope] of [['riru','RIRU_ENGINEER',area],['riru-head','RIRU_HEAD',area],['chief','RES_HEAD',area],['sue','SUE',null],['stp','STP',null],['gi','GI',null],['other','RIRU_ENGINEER',other],['process','PROCESS_ADMIN',null],['tech','TECH_ADMIN',null],['substitute',null,null]]){
      users[subject!]=(await owner.query('INSERT INTO app.users(issuer,subject,name) VALUES($1,$2,$3) RETURNING id',[config.issuer,subject,`Матрица · ${subject}`])).rows[0].id;
      if(role)await owner.query('INSERT INTO app.roles(user_id,role,res_id) VALUES($1,$2,$3)',[users[subject!],role,scope]);
      tokens[subject!]=await new SignJWT({realm_access:{roles:['tp-approval-user']}}).setProtectedHeader({alg:'RS256',kid:'matrix'}).setIssuer(config.issuer).setAudience(config.audience).setSubject(subject!).setIssuedAt().setExpirationTime('1h').sign(keys.privateKey);
    }
    await owner.query("INSERT INTO app.calendar_days SELECT d::date,extract(isodow FROM d)<6,'SYNTHETIC MATRIX CALENDAR',1 FROM generate_series(current_date-1,current_date+450,'1 day') d");
    const get=(user:string,path:string)=>request(app).get(path).set('Authorization',`Bearer ${tokens[user]}`);
    const post=(user:string,path:string,body:object)=>completeRiruReview(request(app).post(path).set('Authorization',`Bearer ${tokens[user]}`).set('Idempotency-Key',randomUUID()).send(body),app,tokens,owner);
    const ensure=(response:request.Response)=>{assert.equal(response.status,200,JSON.stringify(response.body));return response.body;};
    const create=async(number:string)=>ensure(await post('riru','/api/v1/acts',{resId:area,contractNumber:synthContract(`MATRIX-${number}`),contractDate:'2026-10-31',actNumber:number,applicant:'Синтетический заявитель',address:'Учебный адрес'}));
    const a=await create('MATRIX-1');const path=`/api/v1/acts/${a.id}/approval-matrix`;
    const matrix=async(cycleId?:string)=>ensure(await get('riru',`${path}${cycleId?`?cycleId=${cycleId}`:''}`));
    const blank=await matrix();assert.equal(blank.rows.length,5);assert.ok(blank.rows.every((r:any)=>r.status==='NOT_STARTED'));assert.equal(blank.version,null);
    assert.equal((await get('other',path)).status,404);assert.equal((await get('tech',path)).status,404);assert.equal((await request(app).get(path)).status,401);assert.equal((await get('riru',`${path}?cycleId=${randomUUID()}`)).status,404);
    pass('initial draft, all five stages unstarted, API and RLS access restrictions');
    async function version(actId=a.id){const uploaded=await request(app).post(`/api/v1/acts/${actId}/files`).set('Authorization',`Bearer ${tokens.riru}`).attach('file',zip(docxParts),'matrix.docx');assert.equal(uploaded.status,201);const act=ensure(await get('riru',`/api/v1/acts/${actId}`));return ensure(await post('riru',`/api/v1/acts/${actId}/versions`,{fileId:uploaded.body.id,expectedRevision:act.revision}));}
    async function submitVersion(v:any,actId=a.id){const act=ensure(await get('riru',`/api/v1/acts/${actId}`));return ensure(await post('riru',`/api/v1/acts/${actId}/submit`,{versionId:v.id,expectedRevision:act.revision}));}
    async function decide(user:string,choice='APPROVE',reason='',actId=a.id){const tasks=ensure(await get(user,'/api/v1/tasks/mine'));const task=tasks.find((t:any)=>t.act_id===actId);assert.ok(task);return ensure(await post(user,`/api/v1/tasks/${task.id}/decision`,{decision:choice,reason}));}
    const v1=await version();assert.equal((await matrix()).version.number,1);
    const cycle1=await submitVersion(v1);const resMatrix=await matrix();assert.equal(resMatrix.cycle.number,1);assert.equal(resMatrix.rows[1].status,'PENDING');assert.equal(resMatrix.rows[1].person.name,'Матрица · chief');assert.equal(resMatrix.rows[1].policy.workingDays,1);assert.ok(resMatrix.rows.slice(2).every((r:any)=>r.status==='NOT_STARTED'));
    pass('submitted Word version, cycle and real RES task/policy/person');
    await decide('chief');const parallel=await matrix();assert.equal(parallel.rows[1].status,'APPROVED');assert.ok(parallel.rows[1].decidedAt);assert.ok(parallel.rows.slice(2).every((r:any)=>r.status==='PENDING'&&r.policy.workingDays===2));assert.equal(new Set(parallel.rows.slice(2).map((r:any)=>r.receivedAt)).size,1);
    pass('RIRU head then RES, then three simultaneous independent tasks');
    const sueRole=(await owner.query("SELECT id FROM app.roles WHERE user_id=$1 AND role='SUE'",[users.sue])).rows[0].id;
    const substitution=ensure(await post('process','/api/v1/admin/substitutions',{roleId:sueRole,substituteId:users.substitute,startsAt:new Date(Date.now()-5000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()}));
    const substituted=(await matrix()).rows[2];assert.equal(substituted.person.name,'Матрица · substitute');assert.equal(substituted.substitution,true);assert.equal(substituted.assignment.principal.name,'Матрица · sue');
    await decide('substitute','RETURN','Ошибка мощности: нужно 15 кВт');let rejected=await matrix();assert.equal(rejected.overall,'COLLECTING');assert.equal(rejected.rows[2].status,'RETURNED');assert.equal(rejected.rows[2].commentCount,1);assert.equal(rejected.rows[2].comments[0].text,'Ошибка мощности: нужно 15 кВт');assert.equal(rejected.rows[3].status,'PENDING');assert.equal(rejected.rows[4].status,'PENDING');
    await owner.query("UPDATE app.substitutions SET ends_at=now()-interval '1 second' WHERE id=$1",[substitution.id]);await owner.query("UPDATE app.users SET name='Переименованный заместитель' WHERE id=$1",[users.substitute]);
    assert.equal((await matrix()).rows[2].person.name,'Матрица · substitute');
    pass('active substitution and RETURN, exact comments and immutable decision name after expiry/rename');
    await decide('stp');await decide('gi');const old=await matrix(cycle1.id);assert.equal(old.overall,'REQUIRES_REWORK');
    await assert.rejects(transaction(runtime,users.riru,db=>db.query("UPDATE app.tasks SET due_at=due_at+interval '1 day' WHERE id=$1",[old.rows[2].taskId])),(e:any)=>e.code==='55000');
    const v2=await version();const beforeSubmit=await matrix();assert.equal(beforeSubmit.version.number,1);assert.equal(beforeSubmit.latestVersionNumber,2);
    ensure(await post('riru',`/api/v1/comments/${old.rows[2].comments[0].id}/events`,{versionId:v2.id,type:'REPORTED_FIXED',explanation:'Исправлено в v2'}));
    const cycle2=await submitVersion(v2);const restarted=await matrix();assert.equal(restarted.cycle.number,2);assert.equal(restarted.version.number,2);assert.equal(restarted.rows[1].status,'PENDING');assert.ok(restarted.rows.slice(2).every((r:any)=>r.status==='NOT_STARTED'));
    const oldAgain=await matrix(cycle1.id);assert.deepEqual(oldAgain.rows,old.rows);
    pass('repeat cycle includes RIRU head then RES; previous rows, durations, dates and comments immutable');
    ensure(await post('process','/api/v1/admin/substitutions',{roleId:sueRole,substituteId:users.substitute,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()}));
    await decide('chief');ensure(await post('substitute',`/api/v1/comments/${old.rows[2].comments[0].id}/events`,{versionId:v2.id,type:'VERIFIED',explanation:'Автор проверил исправление'}));
    await Promise.all(['substitute','stp','gi'].map(u=>decide(u)));const approved=await matrix();assert.equal(approved.overall,'APPROVED');assert.ok(approved.rows.every((r:any)=>r.status==='APPROVED'));assert.ok(approved.rows.every((r:any)=>r.decidedAt&&r.elapsedSeconds>=0));assert.equal(approved.rows[2].person.name,'Переименованный заместитель');assert.equal((await matrix(cycle1.id)).rows[2].person.name,'Матрица · substitute');
    assert.equal((await get('riru',`${path}?cycleId=${randomUUID()}`)).status,404);
    pass('concurrent final approvals, selected cycles and historical names remain correct');
    const overdueAct=await create('MATRIX-OVERDUE');await submitVersion(await version(overdueAct.id),overdueAct.id);
    await owner.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[overdueAct.id]);
    const overduePath=`/api/v1/acts/${overdueAct.id}/approval-matrix`;const overdue=ensure(await get('riru',overduePath));assert.equal(overdue.overall,'IN_REVIEW');assert.equal(overdue.overdue,true);assert.equal(overdue.rows[1].overdue,true);assert.equal(overdue.rows[1].decidedAt,null);
    await decide('chief','APPROVE','',overdueAct.id);const late=ensure(await get('riru',overduePath));assert.equal(late.rows[1].wasOverdue,true);assert.equal(late.rows[1].overdue,false);
    pass('overdue pending stage and late decision are distinct, no invented decision date');
    await owner.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[overdueAct.id]);
    ensure(await post('process',`/api/v1/acts/${overdueAct.id}/close-collection`,{reason:'Срок истёк'}));
    const cancelled=ensure(await get('riru',overduePath));assert.equal(cancelled.overall,'REQUIRES_REWORK');assert.ok(cancelled.rows.slice(2).every((r:any)=>r.status==='NO_DECISION'&&r.decidedAt===null));
    await owner.query("UPDATE app.users SET name='Новое имя СТП' WHERE id=$1",[users.stp]);assert.deepEqual(ensure(await get('riru',overduePath)).rows,cancelled.rows);
    pass('collection closed without decision, cancelled-stage identity and durations frozen');
    const rel=(await owner.query('SELECT id FROM app.releases WHERE cycle_id=$1',[cycle2.id])).rows[0];
    ensure(await post('process',`/api/v1/releases/${rel.id}/revoke`,{reason:'Учебный отзыв'}));assert.equal((await matrix()).overall,'REVOKED');assert.equal((await matrix(cycle1.id)).overall,'REQUIRES_REWORK');
    const counts=(await owner.query('SELECT (SELECT count(*) FROM app.notifications) AS n,(SELECT count(*) FROM app.audit_events) AS a')).rows[0];await matrix();assert.deepEqual((await owner.query('SELECT (SELECT count(*) FROM app.notifications) AS n,(SELECT count(*) FROM app.audit_events) AS a')).rows[0],counts);
    pass('revoked release, history selection and side-effect-free matrix reads');
    const canSee=await transaction(runtime,users.other,db=>db.query('SELECT app.matrix_task_identity($1) AS identity',[old.rows[1].taskId]));assert.equal(canSee.rows[0].identity,null);pass('identity helper also rejects other RES at database level');
    console.log(`PASS: ${checks} matrix integration groups`);
    await runRegistryChecks({owner,runtime,app,tokens,users,area,other,approvedActId:a.id,returnedActId:overdueAct.id});
    await runDocumentChecks({owner,runtime,app,tokens,users,area});
    await runContractDocumentChecks({owner,runtime,app:createApp(runtime,config,verifier(config,createLocalJWKSet({keys:[jwk]}))),tokens,users,area});
    await runRiruChecks({owner,app:createApp(runtime,config,verifier(config,createLocalJWKSet({keys:[jwk]}))),tokens,users,area});
    await runEngineerChecks({owner,runtime,app:createApp(runtime,config,verifier(config,createLocalJWKSet({keys:[jwk]}))),tokens,users,area});
  }finally{await runtime.end();await owner.end();}
}
