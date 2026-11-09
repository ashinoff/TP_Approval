import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {synthContract} from './synthetic-contract.js';

/** «Синхронизация» с «Учёт ПУ» (09.11.2026): сервисный API по ключу, отметка по хешу данных, область РЭС на рабочем месте. */
export async function runPuSyncChecks({app,offApp,tokens,area,syncKey}:{app:any;offApp:any;tokens:Record<string,string>;area:string;syncKey:string}){
 let n=0;const pass=(s:string)=>console.log(`PU SYNC OK ${++n}: ${s}`);
 const ok=(r:request.Response,status=200)=>{assert.equal(r.status,status,JSON.stringify(r.body));return r.body;};
 const get=(u:string,p:string)=>request(app).get(p).set('Authorization','Bearer '+tokens[u]);
 const post=(u:string,p:string,b:object)=>request(app).post(p).set('Authorization','Bearer '+tokens[u]).set('Idempotency-Key',randomUUID()).send(b);
 const service=(p:string,key=syncKey)=>request(app).get(p).set('X-Sync-Key',key);
 const mark=(number:string,body:object)=>request(app).post(`/sync/v1/contracts/${number}/synced`).set('X-Sync-Key',syncKey).send(body);

 const number=synthContract('PU-SYNC-'+Date.now());
 const act=ok(await post('riru','/api/v1/acts',{resId:area,contractNumber:number,contractDate:'2026-11-05',actNumber:number,applicant:'Синтетический заявитель',address:'Учебный адрес, д. 1'}));
 ok(await post('riru',`/api/v1/acts/${act.id}/card`,{values:[{code:'power_kw',value:'15'},{code:'voltage_kv',value:'0.4'},{code:'phases',value:'3ф'}]}));

 assert.equal((await request(offApp).get('/sync/v1/contracts').set('X-Sync-Key',syncKey)).body.error.code,'SYNC_NOT_CONFIGURED');
 assert.equal((await service('/sync/v1/contracts','')).status,401);assert.equal((await service('/sync/v1/contracts','x'.repeat(40))).status,401);
 assert.equal((await request(app).get('/sync/v1/contracts').set('Authorization','Bearer '+tokens.riru)).status,401);
 pass('Service API needs SYNC_API_KEY: off without configuration, user tokens and wrong keys rejected');

 const res=ok(await service('/sync/v1/res'));assert.ok(res.length>1&&res.every((r:any)=>r.code&&r.name));
 const one=ok(await service('/sync/v1/contracts/'+number));
 assert.equal(one.contractNumber,number);assert.equal(one.contractDate.slice(0,10),'2026-11-05');assert.ok(one.res.code&&one.res.name);
 assert.equal(one.technical.power_kw.value,'15');assert.equal(one.technical.voltage_kv.value,'0.4');assert.equal(one.technical.phases.value,'3ф');
 assert.equal(one.sync.status,'NOT_SYNCED');assert.match(one.hash,/^[0-9a-f]{32}$/);
 const listed=ok(await service(`/sync/v1/contracts?res=${one.res.code}&q=${encodeURIComponent(number)}`));assert.equal(listed.total,1);assert.equal(listed.items[0].hash,one.hash);
 assert.equal(ok(await service(`/sync/v1/contracts?status=NOT_SYNCED&q=${encodeURIComponent(number)}`)).total,1);
 assert.equal((await service('/sync/v1/contracts/99999-26-00000000-9')).status,404);assert.equal((await service('/sync/v1/contracts/abc')).status,422);
 pass('Contract by number and per-RES list with search: RES, requisites and technical characteristics from the card');

 assert.equal(ok(await mark(number,{hash:'0'.repeat(32)}),409).error.code,'SYNC_STALE');
 const synced=ok(await mark(number,{hash:one.hash,externalId:'PU-77'}));assert.equal(synced.sync.status,'SYNCED');assert.equal(synced.sync.externalId,'PU-77');assert.equal(synced.sync.count,1);
 const row=(u:string)=>get(u,`/api/v1/sync?q=${encodeURIComponent(number)}`).then(r=>ok(r));
 const mine=await row('riru');assert.equal(mine.total,1);assert.equal(mine.items[0].sync_status,'SYNCED');assert.equal(mine.counts.SYNCED>=1,true);assert.equal(mine.configured,true);
 assert.equal((await row('other')).total,0);assert.equal((await row('sue')).total,1);
 assert.equal(ok(await get('riru','/api/v1/acts/'+act.id)).puSync.status,'SYNCED');
 pass('Mark only for current data hash; workplace shows the check mark within RES scope and in the document card');

 ok(await post('riru',`/api/v1/acts/${act.id}/card`,{values:[{code:'power_kw',value:'20'}]}));
 const changed=ok(await service('/sync/v1/contracts/'+number));assert.equal(changed.sync.status,'CHANGED');assert.notEqual(changed.hash,one.hash);
 assert.equal((await row('riru')).items[0].sync_status,'CHANGED');assert.equal(ok(await mark(number,{hash:one.hash}),409).error.code,'SYNC_STALE');
 const again=ok(await mark(number,{hash:changed.hash}));assert.equal(again.sync.status,'SYNCED');assert.equal(again.sync.count,2);assert.equal(again.sync.externalId,'PU-77');
 pass('Data changed after sync is flagged; stale hash rejected; re-sync keeps the external id and counts attempts');
}
