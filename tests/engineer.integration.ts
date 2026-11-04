import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {transaction} from '../apps/api/src/db.js';
import {zip,docxParts} from './zip.js';
export function checkedDocx(power='15',contract='00001-26-00000004-1',voltage='0,4',type='ACT',point='РУ-0,4 кВ ТП-У001'){
 const lines=[type==='TU'?'Технические условия — синтетический пример':'Акт ТП — синтетический пример',`Приложение к договору № ${contract}`,`Максимальная мощность: ${power} кВт, в том числе существующая мощность 7 кВт.`,...(voltage?[`Класс напряжения: ${voltage} кВ.`]:[]),'Адрес объекта: Учебный адрес, д. 15/31', `Точка присоединения: ${point}.`];
 return zip({...docxParts,'word/document.xml':'<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>'+lines.map(s=>`<w:p><w:r><w:t>${s}</w:t></w:r></w:p>`).join('')+'</w:body></w:document>'});
}
export async function runEngineerChecks({app,owner,runtime,tokens,users,area}:{app:any;owner:pg.Pool;runtime:pg.Pool;tokens:Record<string,string>;users:Record<string,string>;area:string}){
 let n=0;const pass=(s:string)=>console.log(`ENGINEER PREFLIGHT OK ${++n}: ${s}`);const ok=(r:request.Response)=>{assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const get=(u:string,p:string)=>request(app).get(p).set('Authorization','Bearer '+tokens[u]);const post=(u:string,p:string,b:object)=>request(app).post(p).set('Authorization','Bearer '+tokens[u]).set('Idempotency-Key',randomUUID()).send(b);
 const create=(number:string)=>post('riru','/api/v1/acts',{resId:area,contractNumber:'00001-26-00000004-1',contractDate:'2026-11-02',actNumber:number,applicant:'Синтетический заявитель',address:'Учебный адрес, д. 15/31'});
 const extract=(u:string,bytes:Buffer,resId=area)=>request(app).post('/api/v1/documents/extract-tu').set('Authorization','Bearer '+tokens[u]).field('resId',resId).attach('file',bytes,'tu.docx');
 const metadata=ok(await extract('riru',checkedDocx('15','00001-26-00000004-1','0,4','TU')));assert.equal(metadata.fields.contractNumber.value,'00001-26-00000004-1');assert.equal(metadata.card.power_kw.value,'15');assert.equal(metadata.card.voltage_kv.value,'0.4');assert.deepEqual([metadata.card.phases.value,metadata.card.phases.status],['3ф','DERIVED']);assert.equal(metadata.fields.contractDate.value,'');
 assert.equal((await extract('chief',checkedDocx())).status,403);assert.equal((await extract('other',checkedDocx())).status,403);assert.equal((await extract('riru',Buffer.from('invalid'))).status,415);
 pass('TU extraction is authenticated and scoped to engineer RES; absent dates remain empty; invalid DOCX rejected');
 const templateParts={...docxParts,'word/settings.xml':'<w:settings xmlns:w="w" xmlns:r="r"><w:attachedTemplate r:id="rId1"/></w:settings>','word/_rels/settings.xml.rels':'<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" TargetMode="External" Target="file:///synthetic/template.dotx"/></Relationships>'};
 const prepared=ok(await extract('riru',zip(templateParts)));assert.equal(prepared.preparedFile.removedTemplateLinks,1);assert.ok(prepared.notice);assert.ok(prepared.preparedFile.base64);
 const minimal={resId:area,contractNumber:'00001-26-00000005-1',contractDate:null,actNumber:'SYNTH-UNKNOWN-DATE',applicant:'',address:''};const minimalA=ok(await post('riru','/api/v1/acts',minimal)),minimalB=ok(await post('riru','/api/v1/acts',minimal));assert.equal(minimalA.contract_date,null);assert.equal(minimalA.contract_id,minimalB.contract_id);
 pass('Local template is removed explicitly before import; contract-only drafts save without inventing a date and share scoped container');
 const a=ok(await create('SYNTH-PREFLIGHT')),path=`/api/v1/acts/${a.id}`;const card=()=>get('riru',path).then(ok);
 const upload=async(p:string,type:string,bytes:Buffer)=>{const r=await request(app).post(p+'/files').set('Authorization','Bearer '+tokens.riru).field('documentType',type).attach('file',bytes,'synthetic.docx');assert.equal(r.status,201,JSON.stringify(r.body));return r.body;};
 const version=async(power:string)=>{const f=await upload(path,'ACT_TP',checkedDocx(power));return ok(await post('riru',path+'/versions',{fileId:f.id,expectedRevision:(await card()).revision}));};
 const check=async(v:any)=>ok(await post('riru',path+'/check-tu',{versionId:v.id,expectedRevision:(await card()).revision}));const submit=async(v:any)=>post('riru',path+'/submit',{versionId:v.id,expectedRevision:(await card()).revision});
 assert.equal(a.tu_check_required,true);const v1=await version('150');assert.equal((await submit(v1)).body.error.code,'TU_REQUIRED');await assert.rejects(transaction(runtime,users.riru,db=>db.query('UPDATE app.acts SET tu_check_required=false WHERE id=$1',[a.id])));pass('Gate enabled by default; direct API cannot submit without TU; runtime cannot disable it');
 await upload(path,'TU',checkedDocx('150'));assert.equal((await post('riru',path+'/check-tu',{versionId:v1.id,expectedRevision:(await card()).revision})).body.error.code,'ACT_TU_IDENTICAL');const tu=await upload(path,'TU',checkedDocx('15','00001-26-00000004-1','0,4','TU'));const failed=await check(v1);assert.equal(failed.status,'BLOCKED');assert.equal(failed.findings.find((f:any)=>f.field==='power').status,'DIFFERENCE');assert.ok(failed.findings.every((f:any)=>f.act[0].quote&&f.tu[0].blockId));assert.equal((await submit(v1)).body.error.code,'TU_CHECK_REQUIRED');assert.equal((await card()).cycles.length,0);assert.equal((await post('riru-head',path+'/check-tu',{versionId:v1.id,expectedRevision:(await card()).revision})).status,403);assert.equal((await get('other',path)).status,404);pass('Power discrepancy shows source fragments and blocks workflow; head cannot run engineer command');
 const v2=await version('15');assert.equal((await submit(v2)).body.error.code,'TU_CHECK_REQUIRED');assert.equal((await check(v2)).status,'PASS');
 assert.equal((await submit(v2)).body.error.code,'CARD_INCOMPLETE');
 const fields=ok(await get('chief','/api/v1/card-fields'));assert.deepEqual(fields.map((f:any)=>f.code),['power_kw','voltage_kv','phases','plan_date']);assert.equal((await get('chief','/api/v1/card-fields?all=1')).status,403);
 const fromTu=ok(await post('riru',path+'/card/from-tu',{}));const byCode=(rows:any[])=>Object.fromEntries(rows.map(r=>[r.field_code,r.value]));assert.deepEqual(byCode(fromTu.values),{power_kw:'15',voltage_kv:'0.4',phases:'3ф'});assert.ok(fromTu.values.every((r:any)=>r.origin==='TU'));
 assert.equal((await post('chief',path+'/card',{values:[{code:'plan_date',value:'2026-12-01'}]})).status,403);
 assert.equal((await post('riru',path+'/card',{values:[{code:'power_kw',value:'пятнадцать'}]})).body.error.code,'CARD_VALUE_INVALID');assert.equal((await post('riru',path+'/card',{values:[{code:'phases',value:'2ф'}]})).body.error.code,'CARD_VALUE_INVALID');
 ok(await post('riru',path+'/card',{values:[{code:'phases',value:'3фтт'},{code:'plan_date',value:'2026-12-01'},{code:'power_kw',value:'15,0'}]}));
 const again=ok(await post('riru',path+'/card/from-tu',{}));assert.deepEqual(byCode(again.values),{power_kw:'15',voltage_kv:'0.4',phases:'3фтт',plan_date:'2026-12-01'});
 pass('Card: TU suggestions fill power/voltage/phases, manual values survive refill, validation and engineer-only edits, incomplete card blocks submit');
 ok(await submit(v2));
 const snapshot=(await owner.query('SELECT card_snapshot FROM app.cycles WHERE act_id=$1 ORDER BY number DESC LIMIT 1',[a.id])).rows[0].card_snapshot;assert.equal(snapshot.power_kw.value,'15');assert.equal(snapshot.plan_date.value,'2026-12-01');assert.equal(snapshot.phases.origin,'MANUAL');
 assert.equal((await post('riru',path+'/card',{values:[{code:'plan_date',value:'2027-01-01'}]})).status,409);
 await assert.rejects(transaction(runtime,users.riru,db=>db.query("UPDATE app.cycles SET card_snapshot='{}' WHERE act_id=$1",[a.id])));
let d=await card();assert.equal(d.state,'RIRU_REVIEW');const event=(await owner.query("SELECT details FROM app.audit_events WHERE act_id=$1 AND action='SUBMITTED' ORDER BY created_at DESC,id DESC LIMIT 1",[a.id])).rows[0];assert.ok(d.checks.some((c:any)=>c.id===event.details.checkId&&c.status==='PASS'&&c.version_id===v2.id));
 for(const view of ['upload','progress','corrections']){const list=ok(await get('riru','/api/v1/registry?view='+view));const counts=ok(await get('riru','/api/v1/registry-counts'));assert.equal(list.total,counts[view]);assert.equal(list.items.some((x:any)=>x.id===a.id),view==='progress');assert.equal(ok(await get('other','/api/v1/registry?view='+view+'&q=SYNTH-PREFLIGHT')).total,0);}
 pass('Fresh matching version starts real first review; engineer sections/counts reflect actual states and RES');
 let task=d.tasks.find((t:any)=>t.status==='OPEN');ok(await post('riru-head',`/api/v1/tasks/${task.id}/decision`,{decision:'RETURN',reason:'Учебная доработка'}));d=await card();assert.equal(d.state,'RETURNED');assert.ok(ok(await get('riru','/api/v1/registry?view=corrections')).items.some((x:any)=>x.id===a.id));assert.ok(!ok(await get('riru','/api/v1/registry?view=progress')).items.some((x:any)=>x.id===a.id));const v3=await version('15');assert.equal((await submit(v3)).body.error.code,'TU_CHECK_REQUIRED');await check(v3);
 const changed=await upload(path,'TU',checkedDocx('20','00001-26-00000004-1','0,4','TU'));assert.equal((await submit(v3)).body.error.code,'TU_CHECK_REQUIRED');assert.equal((await check(v3)).status,'BLOCKED');ok(await post('riru',path+'/technical-conditions/select',{technicalConditionsId:tu.technicalConditions.id,expectedRevision:(await card()).revision}));assert.equal((await check(v3)).status,'PASS');pass('Return enters corrections; new version and changed TU cannot reuse a stale successful report');
 d=await card();for(const c of d.comments)ok(await post('riru',`/api/v1/comments/${c.id}/events`,{versionId:v3.id,type:'REPORTED_FIXED',explanation:'Учебное исправление'}));ok(await submit(v3));d=await card();for(const c of d.comments)ok(await post('riru-head',`/api/v1/comments/${c.id}/events`,{versionId:v3.id,type:'VERIFIED',explanation:'Автор проверил'}));
 for(const [u,role]of [['riru-head','RIRU_HEAD'],['chief','RES_HEAD'],['sue','SUE'],['stp','STP'],['gi','GI']]){d=await card();task=d.tasks.find((t:any)=>t.role===role&&t.status==='OPEN');ok(await post(u,`/api/v1/tasks/${task.id}/decision`,{decision:'APPROVE',versionId:v3.id}));}d=await card();assert.equal(d.state,'APPROVED');assert.ok(ok(await get('riru','/api/v1/registry?view=approved')).items.some((x:any)=>x.id===a.id));ok(await post('riru',path+'/revise',{reason:'Учебный пересмотр',expectedRevision:d.revision}));assert.ok(ok(await get('riru','/api/v1/registry?view=approved')).items.some((x:any)=>x.id===a.id));assert.ok(ok(await get('riru','/api/v1/registry?view=corrections')).items.some((x:any)=>x.id===a.id));pass('Full repeated route still requires author verification; approved publication survives revision and appears in correction work');
 const b=ok(await create('SYNTH-UNKNOWN')),bp=`/api/v1/acts/${b.id}`;const f=await upload(bp,'ACT_TP',checkedDocx('15','00001-26-00000004-1',''));let bd=ok(await get('riru',bp));const bv=ok(await post('riru',bp+'/versions',{fileId:f.id,expectedRevision:bd.revision}));bd=ok(await get('riru',bp));ok(await post('riru',bp+'/technical-conditions/select',{technicalConditionsId:tu.technicalConditions.id,expectedRevision:bd.revision}));bd=ok(await get('riru',bp));const unknown=ok(await post('riru',bp+'/check-tu',{versionId:bv.id,expectedRevision:bd.revision}));assert.equal(unknown.status,'BLOCKED');assert.equal(unknown.findings.find((x:any)=>x.field==='voltage').status,'UNKNOWN');assert.equal((await post('riru',bp+'/submit',{versionId:bv.id,expectedRevision:bd.revision})).status,409);await assert.rejects(transaction(runtime,users.riru,db=>db.query("UPDATE app.tu_checks SET status='PASS' WHERE id=$1",[unknown.id])));assert.equal((await transaction(runtime,users.other,db=>db.query('SELECT id FROM app.tu_checks WHERE act_id=$1',[b.id]))).rowCount,0);assert.ok(changed.technicalConditions.id);pass('Unknown values are blocked, not marked correct; reports are immutable and isolated by real RLS');

 // Р4: the engineer confirms MANUAL_REVIEW / UNKNOWN findings with a comment; a DIFFERENCE cannot be confirmed.
 {
  const c=ok(await create('SYNTH-CONFIRM')),cp=`/api/v1/acts/${c.id}`;const cardC=()=>get('riru',cp).then(ok);
  const point='Контакты кабеля от РУ-0,4 кВ ТП-У001';
  const versionC=async(power:string)=>{const f=await upload(cp,'ACT_TP',checkedDocx(power,'00001-26-00000004-1','0,4','ACT',point));return ok(await post('riru',cp+'/versions',{fileId:f.id,expectedRevision:(await cardC()).revision}));};
  const vA=await versionC('150');
  ok(await post('riru',cp+'/technical-conditions/select',{technicalConditionsId:tu.technicalConditions.id,expectedRevision:(await cardC()).revision}));
  const checkC=async(v:any)=>ok(await post('riru',cp+'/check-tu',{versionId:v.id,expectedRevision:(await cardC()).revision}));
  const confirm=async(u:string,checkId:string,field:string,comment='Сверено вручную по исходным ТУ')=>post(u,`${cp}/check-tu/${checkId}/confirm`,{field,comment,expectedRevision:(await cardC()).revision});
  ok(await post('riru',cp+'/card',{values:[{code:'power_kw',value:'15'},{code:'voltage_kv',value:'0.4'},{code:'phases',value:'3ф'},{code:'plan_date',value:'2026-12-15'}]}));
  const submitC=async(v:any)=>post('riru',cp+'/submit',{versionId:v.id,expectedRevision:(await cardC()).revision});
  const reportA=await checkC(vA);
  assert.equal(reportA.status,'BLOCKED');
  assert.equal(reportA.findings.find((f:any)=>f.field==='point').status,'MANUAL_REVIEW');
  assert.equal(reportA.findings.find((f:any)=>f.field==='power').status,'DIFFERENCE');
  assert.equal((await confirm('riru',reportA.id,'power')).body.error.code,'TU_FINDING_NOT_CONFIRMABLE');
  assert.equal((await confirm('riru-head',reportA.id,'point')).status,403);
  assert.equal((await confirm('other',reportA.id,'point')).status,404);
  assert.notEqual((await confirm('riru',reportA.id,'point','коротко')).status,200);
  ok(await confirm('riru',reportA.id,'point'));
  assert.equal((await submitC(vA)).body.error.code,'TU_CHECK_REQUIRED');
  pass('A confirmed MANUAL_REVIEW does not unblock a remaining DIFFERENCE; head and other RES cannot confirm; a comment is required');
  const vB=await versionC('15');
  const reportB=await checkC(vB);
  assert.equal(reportB.status,'BLOCKED');
  assert.equal((await submitC(vB)).body.error.code,'TU_CHECK_REQUIRED');
  assert.equal((await confirm('riru',reportA.id,'point')).body.error.code,'TU_CHECK_STALE');
  const first=ok(await confirm('riru',reportB.id,'point'));
  const again=ok(await confirm('riru',reportB.id,'point','Повторное подтверждение тем же инженером'));
  assert.equal(again.id,first.id);
  ok(await submitC(vB));
  const done=await cardC();
  assert.equal(done.state,'RIRU_REVIEW');
  const stored=done.checks.find((x:any)=>x.id===reportB.id);
  assert.equal(stored.confirmations.length,1);
  assert.equal(stored.confirmations[0].field,'point');
  assert.ok(stored.confirmations[0].actorName);
  assert.equal(ok(await get('riru-head',cp)).checks.find((x:any)=>x.id===reportB.id).confirmations.length,1);
  await assert.rejects(transaction(runtime,users.riru,db=>db.query("UPDATE app.tu_check_confirmations SET comment='Изменено задним числом' WHERE check_id=$1",[reportB.id])));
  assert.equal((await transaction(runtime,users.other,db=>db.query('SELECT id FROM app.tu_check_confirmations WHERE act_id=$1',[c.id]))).rowCount,0);
  pass('Confirmations do not carry over to a new version, are idempotent, visible to the head, immutable and isolated by RLS; submit proceeds');
 }
 console.log(`PASS: ${n} engineer preflight integration groups`);
}
