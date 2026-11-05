import {useState} from 'react';
import {Icon} from './Ui.js';
import {uploadDocument} from './document-upload.js';

type Row=Record<string,any>;
type Api=(p:string,b?:object|FormData)=>Promise<any>;
type Action=(fn:()=>Promise<unknown>)=>Promise<void>;

const PREPARATION_STATES=['DRAFT','RETURNED','REVISING'];
const BLOCKING=['DIFFERENCE','MANUAL_REVIEW','UNKNOWN'];
const CONFIRMABLE=['MANUAL_REVIEW','UNKNOWN'];

export const isPreparing=(detail:Row)=>detail.presentation.canPrepare&&PREPARATION_STATES.includes(detail.state);

/** Latest TU check for a version and the TU it was (or will be) submitted with, under the current rules. */
export function checkFor(detail:Row,versionId:string|undefined,tuId:string|undefined){
 if(!versionId)return undefined;
 return (detail.checks as Row[]|undefined)?.find(c=>c.version_id===versionId&&c.technical_conditions_id===tuId&&c.rules_version===detail.checkRulesVersion);
}

/** Findings that still block submission: any DIFFERENCE and unconfirmed MANUAL_REVIEW / UNKNOWN. Mirrors the server rule. */
export function openBlockers(check?:Row){
 if(!check)return [];
 const confirmed=new Set((check.confirmations??[]).map((c:Row)=>c.field));
 return (check.findings??[]).filter((f:Row)=>BLOCKING.includes(f.status)&&!(CONFIRMABLE.includes(f.status)&&confirmed.has(f.field)));
}

/** «Отправить на согласование»: uses the existing fresh report (keeps manual confirmations), runs a check only if there is none. */
export function SendButton({detail,api,action,busy}:{detail:Row;api:Api;action:Action;busy:boolean}){
 const latest=detail.versions.at(-1);
 const used=detail.cycles.some((c:Row)=>c.version_id===latest?.id);
 if(!isPreparing(detail)||!latest||used)return null;
 const fresh=checkFor(detail,latest.id,detail.technical_conditions_id);
 const blockers=detail.tu_check_required?openBlockers(fresh):[];
 const hint=!detail.tu_check_required?'':!fresh?'Перед отправкой будет выполнена сверка с ТУ.':blockers.length?`Осталось: ${blockers.map((b:Row)=>b.label).join(', ')}.`:'Сверка пройдена.';
 const send=async()=>{
  let report=fresh;
  if(detail.tu_check_required&&!report)report=await api(`/api/v1/acts/${detail.id}/check-tu`,{versionId:latest.id,expectedRevision:detail.revision});
  if(report&&report.status!=='LEGACY'&&openBlockers(report).length)throw new Error('Отправка заблокирована: исправьте расхождения с ТУ, а спорные пункты подтвердите вручную в разделе «Сверка с ТУ».');
  return api(`/api/v1/acts/${detail.id}/submit`,{versionId:latest.id,expectedRevision:detail.revision});
 };
 return <button className="primary-button" disabled={busy} title={hint||undefined} onClick={()=>void action(send)}><Icon name="arrow"/>Отправить на согласование</button>;
}

/** Upload of a new act version or TU revision and the revision start for approved documents. Lives in the package panel. */
export default function PreparationControls({detail,api,action,busy,onVersion}:{detail:Row;api:Api;action:Action;busy:boolean;onVersion:(id:string)=>void}){
 const [type,setType]=useState(detail.act_type??'ACT_TP'),[number,setNumber]=useState(''),[date,setDate]=useState('');
 const [revisionReason,setRevisionReason]=useState('');
 if(detail.presentation.canPrepare&&detail.state==='APPROVED'){
  return <details className="preparation-controls revision-start">
   <summary>Создать исправленную редакцию / начать пересмотр</summary>
   <label>Причина пересмотра<input aria-label="Причина пересмотра" value={revisionReason} maxLength={2000} onChange={e=>setRevisionReason(e.target.value)}/></label>
   <button disabled={busy||!revisionReason.trim()} onClick={()=>void action(()=>api(`/api/v1/acts/${detail.id}/revise`,{reason:revisionReason.trim(),expectedRevision:detail.revision}))}>Начать пересмотр</button>
   <small>Утверждённый файл останется неизменным. Новая редакция пройдёт полный маршрут.</small>
  </details>;
 }
 if(!isPreparing(detail))return null;
 const latest=detail.versions.at(-1);
 const upload=async(file:File)=>{const result=await uploadDocument(api,detail.id,file,type,number,date);if(result.version)onVersion(result.version.id);};
 const uploadLabel=type==='TU'?'Загрузить редакцию ТУ':detail.state==='DRAFT'?'Загрузить PDF':'Загрузить исправленную версию';
 return <section className="preparation-controls" aria-label="Подготовка документа">
  <h3 className="panel-subtitle">Загрузить</h3>
  <label>Тип загружаемого документа
   <select aria-label="Тип загружаемого документа" value={type} disabled={busy} onChange={e=>setType(e.target.value)}>
    <option value="ACT_TP" disabled={!!latest&&detail.act_type!=='ACT_TP'}>Акт ТП</option>
    <option value="AVTU" disabled={!!latest&&detail.act_type!=='AVTU'}>АВТУ</option>
    <option value="TU">ТУ</option>
   </select>
  </label>
  {type==='TU'&&<>
   <label>Собственный номер ТУ<input aria-label="Собственный номер ТУ" value={number} maxLength={200} onChange={e=>setNumber(e.target.value)}/></label>
   <label>Дата ТУ<input aria-label="Дата ТУ" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label>
  </>}
  <div className="upload-field upload-pill">
   <span className="upload-pill-title">{uploadLabel}</span>
   <label className={`primary-button file-button${busy?' is-disabled':''}`}>Выбрать файл PDF
    <input className="sr-only" aria-label="Новая версия DOCX" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void action(()=>upload(f));e.target.value='';}}/>
   </label>
  </div>
  {type==='TU'&&<small>ТУ прикрепляются к договору; номер договора не меняется. Формат — PDF, сохранённый из Word или Excel (сканы не принимаются).</small>}
  {detail.state==='RETURNED'&&<small>Перед повторной отправкой укажите исправления в замечаниях.</small>}
 </section>;
}
