import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {type DB,HttpError,requireValue} from './db.js';
import {audit,lockAct,role,revision} from './workflow.js';
import {documentModel} from './documents.js';
import {compareRequisites,findingsPass,BLOCKING_STATUSES,CONFIRMABLE_STATUSES} from './tu-rules.js';
import {nominalFindings} from './nominal-rules.js';
import {actFindings} from './act-rules.js';
import {noticeFindings} from './notice-rules.js';
import {currentRulesVersion,loadReferences,rulesVersion} from './references.js';

const PREPARATION_STATES=['DRAFT','RETURNED','REVISING'];

async function sources(db:DB,storage:string,act:any,versionId:string){
 const version=requireValue((await db.query("SELECT v.*,f.sha256 FROM app.versions v JOIN app.files f ON f.id=v.file_id WHERE v.id=$1 AND v.act_id=$2 AND f.scan_status='READY'",[versionId,act.id])).rows[0]);
 if(!act.technical_conditions_id)throw new HttpError(409,'TU_REQUIRED','Прикрепите ТУ к договору перед отправкой.');
 const tu=requireValue((await db.query("SELECT t.*,f.sha256 FROM app.technical_conditions t JOIN app.files f ON f.id=t.file_id WHERE t.id=$1 AND t.contract_id=$2 AND f.scan_status='READY'",[act.technical_conditions_id,act.contract_id])).rows[0]);
 if(version.sha256===tu.sha256)throw new HttpError(409,'ACT_TU_IDENTICAL','Акт и ТУ не могут быть одним и тем же файлом. Загрузите отдельные технические условия.');
 const bytes=await Promise.all([readFile(resolve(storage,version.file_id)),readFile(resolve(storage,tu.file_id))]);
 if(bytes.some((b,i)=>createHash('sha256').update(b).digest('hex')!==[version.sha256,tu.sha256][i]))throw new HttpError(500,'FILE_INTEGRITY_FAILURE');
 return {version,tu,bytes};
}

export async function checkTechnicalConditions(db:DB,storage:string,actId:string,versionId:string,expectedRevision:number){
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
 if(!PREPARATION_STATES.includes(a.state))throw new HttpError(409,'INVALID_STATE');
 if(!a.tu_check_required)return {status:'LEGACY',findings:[],message:'Учебный сценарий прежнего маршрута без проверки ТУ.'};
 const s=await sources(db,storage,a,versionId);
 const models=await Promise.all(s.bytes.map(b=>documentModel(b)));
 if(models.some(m=>m.blocks.reduce((sum,b)=>sum+b.text.length,0)>200000))throw new HttpError(422,'TU_TEXT_TOO_LARGE','Документ слишком большой для текущих правил сверки.');
 // Номиналы (ВА, ТТ, сечение) — по справочникам администратора; фазность и мощность из карточки, если заполнены.
 const refs=await loadReferences(db);
 const card=Object.fromEntries((await db.query('SELECT field_code,value FROM app.card_values WHERE act_id=$1',[a.id])).rows.map(r=>[r.field_code,r.value]));
 const actChecks=actFindings(models[0] as Parameters<typeof actFindings>[0]);
 // Уведомление (09.11.2026): свои проверки по разбору владельца; п. 8.1 по схеме заменяет общий вопрос «подтвердите сторону».
 const notice=a.act_type==='NOTICE'?noticeFindings(models[0] as Parameters<typeof noticeFindings>[0],{tuBlocks:models[1].blocks,attorneys:refs.attorneys.rows,tg:refs.tg.rows,contractDate:(await db.query("SELECT to_char(contract_date,'YYYY-MM-DD') AS d FROM app.acts WHERE id=$1",[a.id])).rows[0].d,
  psuAttached:!!(await db.query("SELECT 1 FROM app.extra_documents e JOIN app.acts o ON o.id=e.act_id WHERE o.contract_id=$1 AND e.kind='PSU' LIMIT 1",[a.contract_id])).rowCount}):[];
 const replaced=new Set(notice.map(f=>f.field));
 const findings=[...compareRequisites(models[0].blocks,models[1].blocks,a.contract_number),...nominalFindings(models[0].blocks,models[1].blocks,refs,{phases:card.phases,powerKw:card.power_kw}),...actChecks.filter(f=>!replaced.has(f.field)),...notice];
 const status=findingsPass(findings)?'PASS':'BLOCKED';
 const result=(await db.query('INSERT INTO app.tu_checks(act_id,version_id,technical_conditions_id,act_hash,tu_hash,rules_version,status,findings,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,app.uid()) RETURNING *',[a.id,versionId,s.tu.id,s.version.sha256,s.tu.sha256,rulesVersion(refs),status,JSON.stringify(findings)])).rows[0];
 await audit(db,a.id,'TU_CHECKED',{checkId:result.id,versionId,technicalConditionsId:s.tu.id,status});
 return {...result,confirmations:[]};
}

/**
 * Findings that still block submission for this report: any DIFFERENCE, and MANUAL_REVIEW / UNKNOWN
 * without an engineer confirmation.
 */
export function openBlockers(findings:{field:string;status:string}[],confirmedFields:string[]){
 return findings.filter(f=>BLOCKING_STATUSES.includes(f.status as never)&&!(CONFIRMABLE_STATUSES.includes(f.status as never)&&confirmedFields.includes(f.field)));
}

/** Engineer confirms one MANUAL_REVIEW / UNKNOWN finding of the latest report for the current version and TU. */
export async function confirmTuFinding(db:DB,storage:string,actId:string,checkId:string,field:string,comment:string,expectedRevision:number){
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
 if(!PREPARATION_STATES.includes(a.state))throw new HttpError(409,'INVALID_STATE');
 const check=(await db.query('SELECT * FROM app.tu_checks WHERE id=$1 AND act_id=$2',[checkId,a.id])).rows[0];
 if(!check)throw new HttpError(404,'NOT_FOUND');
 const latestVersion=(await db.query('SELECT id FROM app.versions WHERE act_id=$1 ORDER BY number DESC LIMIT 1',[a.id])).rows[0];
 const latestCheck=(await db.query('SELECT id FROM app.tu_checks WHERE act_id=$1 AND version_id=$2 AND technical_conditions_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[a.id,check.version_id,check.technical_conditions_id])).rows[0];
 if(check.version_id!==latestVersion?.id||check.technical_conditions_id!==a.technical_conditions_id||check.rules_version!==await currentRulesVersion(db)||latestCheck?.id!==check.id){
  throw new HttpError(409,'TU_CHECK_STALE','Отчёт сверки устарел. Выполните проверку текущей версии заново.');
 }
 const s=await sources(db,storage,a,check.version_id);
 if(check.act_hash!==s.version.sha256||check.tu_hash!==s.tu.sha256)throw new HttpError(409,'TU_CHECK_STALE','Отчёт сверки устарел. Выполните проверку текущей версии заново.');
 const finding=(check.findings as {field:string;status:string}[]).find(f=>f.field===field);
 if(!finding)throw new HttpError(404,'NOT_FOUND');
 if(!CONFIRMABLE_STATUSES.includes(finding.status as never))throw new HttpError(409,'TU_FINDING_NOT_CONFIRMABLE','Расхождение нельзя подтвердить вручную — исправьте документ.');
 const existing=(await db.query('SELECT * FROM app.tu_check_confirmations WHERE check_id=$1 AND field=$2',[check.id,field])).rows[0];
 if(existing)return existing;
 const created=(await db.query('INSERT INTO app.tu_check_confirmations(check_id,act_id,field,comment) VALUES($1,$2,$3,$4) RETURNING *',[check.id,a.id,field,comment.trim()])).rows[0];
 await audit(db,a.id,'TU_FINDING_CONFIRMED',{checkId:check.id,field,status:finding.status});
 return created;
}

export async function enforceTechnicalConditions(db:DB,storage:string,actId:string,versionId:string,expectedRevision:number){
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
 if(!a.tu_check_required)return;
 const s=await sources(db,storage,a,versionId);
 const check=(await db.query('SELECT * FROM app.tu_checks WHERE act_id=$1 AND version_id=$2 AND technical_conditions_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[a.id,versionId,s.tu.id])).rows[0];
 const fresh=check&&check.act_hash===s.version.sha256&&check.tu_hash===s.tu.sha256&&check.rules_version===await currentRulesVersion(db);
 const refuse=()=>new HttpError(409,'TU_CHECK_REQUIRED','Отправка запрещена: выполните проверку текущего акта по выбранной редакции ТУ, устраните расхождения и подтвердите спорные пункты. Нераспознанные реквизиты без подтверждения не считаются проверенными.');
 if(!fresh)throw refuse();
 if(check.status!=='PASS'){
  const confirmed=(await db.query('SELECT field FROM app.tu_check_confirmations WHERE check_id=$1',[check.id])).rows.map(r=>r.field as string);
  if(openBlockers(check.findings,confirmed).length)throw refuse();
 }
 return check.id;
}
