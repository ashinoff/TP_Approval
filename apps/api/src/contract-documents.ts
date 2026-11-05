import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {type DB,HttpError,requireValue} from './db.js';
import {audit,lockAct,role,revision} from './workflow.js';
import {documentModel} from './documents.js';

export const documentKinds={ACT_TP:'ACT_DOCX',AVTU:'AVTU_DOCX',TU:'TU_DOCX'} as const;
export const pdfKinds={ACT_TP:'ACT_PDF',AVTU:'AVTU_PDF',TU:'TU_PDF'} as const;
/** Вид файла по типу документа и формату (PDF — основной, DOCX — для ранее загруженных). */
export const fileKind=(type:keyof typeof documentKinds,pdf:boolean)=>(pdf?pdfKinds:documentKinds)[type];
export const documentLabels={ACT_TP:'Акт ТП',AVTU:'АВТУ',TU:'ТУ'} as const;
export async function contractDocuments(db:DB,act:Record<string,any>){
 return {contract:requireValue((await db.query('SELECT * FROM app.contracts WHERE id=$1',[act.contract_id])).rows[0]),
  technicalConditions:(await db.query('SELECT * FROM app.technical_conditions WHERE contract_id=$1 ORDER BY number',[act.contract_id])).rows,
  acts:(await db.query('SELECT id,act_number,act_type,state FROM app.acts WHERE contract_id=$1 ORDER BY created_at,id',[act.contract_id])).rows};
}
export async function registerDocument(db:DB,act:Record<string,any>,fileId:string,type:keyof typeof documentKinds,documentNumber?:string,documentDate?:string){
 if(type!=='TU'){
  if(act.act_type!==type){
   if((await db.query('SELECT 1 FROM app.versions WHERE act_id=$1 LIMIT 1',[act.id])).rowCount)throw new HttpError(409,'ACT_TYPE_LOCKED','Вид акта уже зафиксирован. Для другого вида создайте отдельный акт по этому договору.');
   await db.query('UPDATE app.acts SET act_type=$2,revision=revision+1 WHERE id=$1',[act.id,type]);
  }
  return null;
 }
 // All cards of the contract serialize TU revision allocation, not only this act.
 await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,1))',[act.contract_id]);
 const tu=(await db.query('INSERT INTO app.technical_conditions(contract_id,res_id,source_act_id,file_id,number,document_number,document_date,created_by) SELECT $1,$2,$3,$4,coalesce(max(number),0)+1,$5,$6,app.uid() FROM app.technical_conditions WHERE contract_id=$1 RETURNING *',[act.contract_id,act.res_id,act.id,fileId,documentNumber??null,documentDate??null])).rows[0];
 await db.query('UPDATE app.acts SET technical_conditions_id=$2,revision=revision+1 WHERE id=$1',[act.id,tu.id]);
 await audit(db,act.id,'TECHNICAL_CONDITIONS_UPLOADED',{technicalConditionsId:tu.id,number:tu.number});
 return tu;
}
export async function selectTechnicalConditions(db:DB,actId:string,tuId:string,expectedRevision:number){
 const a=await lockAct(db,actId);revision(a,expectedRevision);await role(db,'RIRU_ENGINEER',a.res_id);
 if(!['DRAFT','RETURNED','REVISING'].includes(a.state))throw new HttpError(409,'INVALID_STATE');
 requireValue((await db.query('SELECT id FROM app.technical_conditions WHERE id=$1 AND contract_id=$2',[tuId,a.contract_id])).rows[0]);
 await db.query('UPDATE app.acts SET technical_conditions_id=$2,revision=revision+1 WHERE id=$1',[a.id,tuId]);
 await audit(db,a.id,'TECHNICAL_CONDITIONS_SELECTED',{technicalConditionsId:tuId});return {technicalConditionsId:tuId};
}
export async function tuPreview(db:DB,storage:string,actId:string,tuId:string){
 const a=requireValue((await db.query('SELECT * FROM app.acts WHERE id=$1',[actId])).rows[0]);
 const tu=requireValue((await db.query('SELECT t.*,f.sha256 FROM app.technical_conditions t JOIN app.files f ON f.id=t.file_id WHERE t.id=$1 AND t.contract_id=$2 AND f.scan_status=\'READY\'',[tuId,a.contract_id])).rows[0]);
 const bytes=await readFile(resolve(storage,tu.file_id));
 if(createHash('sha256').update(bytes).digest('hex')!==tu.sha256)throw new HttpError(500,'FILE_INTEGRITY_FAILURE');
 await audit(db,a.id,'TECHNICAL_CONDITIONS_VIEWED',{technicalConditionsId:tu.id});
 return {...await documentModel(bytes),sha256:tu.sha256,versionNumber:tu.number,technicalConditionsId:tu.id};
}
export function documentFilename(kind:string,contractNumber:string,number?:number){
 const label=kind.startsWith('TU_')?'ТУ':kind.startsWith('AVTU_')?'АВТУ':'АКТ ТП';
 return `${contractNumber.replace(/[\\/:*?"<>|\r\n]/g,'_').slice(0,120)} ${label}${number&&number>1?` — редакция ${number}`:''}.${kind.endsWith('_PDF')?'pdf':'docx'}`;
}
