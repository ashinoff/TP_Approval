import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {type DB,HttpError,requireValue} from './db.js';
import {audit,lockAct,role,revision} from './workflow.js';
import {documentModel} from './documents.js';
import {compareRequisites,RULES_VERSION} from './tu-rules.js';
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
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);if(!['DRAFT','RETURNED','REVISING'].includes(a.state))throw new HttpError(409,'INVALID_STATE');
 if(!a.tu_check_required)return {status:'LEGACY',findings:[],message:'Учебный сценарий прежнего маршрута без проверки ТУ.'};
 const s=await sources(db,storage,a,versionId);const models=await Promise.all(s.bytes.map(b=>documentModel(b)));
 if(models.some(m=>m.blocks.reduce((sum,b)=>sum+b.text.length,0)>200000))throw new HttpError(422,'TU_TEXT_TOO_LARGE','Документ слишком большой для текущих правил сверки.');
 const findings=compareRequisites(models[0].blocks,models[1].blocks,a.contract_number),status=findings.every(f=>f.status==='MATCH')?'PASS':'BLOCKED';
 const result=(await db.query('INSERT INTO app.tu_checks(act_id,version_id,technical_conditions_id,act_hash,tu_hash,rules_version,status,findings,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,app.uid()) RETURNING *',[a.id,versionId,s.tu.id,s.version.sha256,s.tu.sha256,RULES_VERSION,status,JSON.stringify(findings)])).rows[0];
 await audit(db,a.id,'TU_CHECKED',{checkId:result.id,versionId,technicalConditionsId:s.tu.id,status});return result;
}
export async function enforceTechnicalConditions(db:DB,storage:string,actId:string,versionId:string,expectedRevision:number){
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);if(!a.tu_check_required)return;
 const s=await sources(db,storage,a,versionId);
 const check=(await db.query('SELECT * FROM app.tu_checks WHERE act_id=$1 AND version_id=$2 AND technical_conditions_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[a.id,versionId,s.tu.id])).rows[0];
 if(!check||check.status!=='PASS'||check.act_hash!==s.version.sha256||check.tu_hash!==s.tu.sha256||check.rules_version!==RULES_VERSION)throw new HttpError(409,'TU_CHECK_REQUIRED','Отправка запрещена: выполните проверку текущего акта по выбранной редакции ТУ и устраните расхождения. Нераспознанные реквизиты не считаются проверенными.');
 return check.id;
}
