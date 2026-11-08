import {useState} from 'react';
import {Icon} from './Ui.js';
import {uploadDocument,EXTRA_KINDS} from './document-upload.js';
import {extraNames} from './ContractDocuments.js';

type Row=Record<string,any>;
type Api=(p:string,b?:object|FormData)=>Promise<any>;
/** Runs a request; resolves to the error text (shown by the caller when `quiet`), or nothing on success. */
export type Action=(fn:()=>Promise<unknown>,quiet?:boolean)=>Promise<string|void>;

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

/**
 * «Отправить на согласование»: uses the existing fresh report (keeps manual confirmations), runs a check only if there is none.
 * What blocks the submission (empty card fields, open TU findings) is known before the click: the button stays disabled
 * and the reason is shown right next to it; a server refusal is shown there too, not only at the top of the page.
 */
export function SendButton({detail,api,action,busy,onFillCard,onCheck}:{detail:Row;api:Api;action:Action;busy:boolean;onFillCard?:()=>void;onCheck?:()=>void}){
 const [failure,setFailure]=useState('');
 const latest=detail.versions.at(-1);
 const used=detail.cycles.some((c:Row)=>c.version_id===latest?.id);
 if(!isPreparing(detail)||!latest||used)return null;
 const fresh=checkFor(detail,latest.id,detail.technical_conditions_id);
 const blockers=detail.tu_check_required?openBlockers(fresh):[];
 const missing:string[]=detail.cardMissing??[];
 const blocked=missing.length>0||blockers.length>0;
 const hint=missing.length?`Заполните карточку документа: ${missing.join(', ')}.`:blockers.length?`Сверка с ТУ: осталось ${blockers.map((b:Row)=>b.label).join(', ')}.`:!detail.tu_check_required?'':!fresh?'Перед отправкой будет выполнена сверка с ТУ.':'Сверка пройдена.';
 const send=async()=>{
  let report=fresh;
  if(detail.tu_check_required&&!report)report=await api(`/api/v1/acts/${detail.id}/check-tu`,{versionId:latest.id,expectedRevision:detail.revision});
  if(report&&report.status!=='LEGACY'&&openBlockers(report).length)throw new Error('Отправка заблокирована: исправьте расхождения с ТУ, а спорные пункты подтвердите вручную в разделе «Сверка с ТУ».');
  return api(`/api/v1/acts/${detail.id}/submit`,{versionId:latest.id,expectedRevision:detail.revision});
 };
 return <span className={`send-wrap${blocked||failure?' send-blocked':''}`}>
  <button className="primary-button" disabled={busy||blocked} title={hint||undefined} onClick={()=>void action(send,true).then(e=>setFailure(e||''))}><Icon name="arrow"/>Отправить на согласование</button>
  {(blocked||failure)&&<span className="send-reason" role="status">
   <Icon name="alert" size={14}/>{failure||hint}
   {missing.length>0&&onFillCard&&<button type="button" className="text-button" onClick={onFillCard}>Заполнить</button>}
   {!missing.length&&blockers.length>0&&onCheck&&<button type="button" className="text-button" onClick={onCheck}>К сверке</button>}
   {failure&&<button type="button" className="send-reason-close" aria-label="Скрыть" onClick={()=>setFailure('')}>×</button>}
  </span>}
 </span>;
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
 const uploadLabel=type==='TU'?'Загрузить редакцию ТУ':EXTRA_KINDS.includes(type)?`Загрузить: ${extraNames[type]}`:detail.state==='DRAFT'?(latest?`Заменить файл · версия ${latest.number+1}`:'Загрузить PDF · версия 1'):`Исправленный документ · версия ${(latest?.number??0)+1}`;
 return <section className="preparation-controls" aria-label="Подготовка документа">
  <h3 className="panel-subtitle"><Icon name="upload" size={16}/>Загрузить документ</h3>
  <label>Тип загружаемого документа
   <select aria-label="Тип загружаемого документа" value={type} disabled={busy} onChange={e=>setType(e.target.value)}>
    <option value="ACT_TP" disabled={!!latest&&detail.act_type!=='ACT_TP'}>Акт ТП</option>
    <option value="AVTU" disabled={!!latest&&detail.act_type!=='AVTU'}>АВТУ</option>
    <option value="TU">ТУ</option>
    <optgroup label="Дополнительные документы">{EXTRA_KINDS.map(k=><option key={k} value={k}>{extraNames[k]}</option>)}</optgroup>
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
  {EXTRA_KINDS.includes(type)&&<small>Дополнительный документ прикладывается к договору и виден в «Просмотре» и режиме проверки. Версию акта не создаёт.</small>}
  {detail.state==='RETURNED'&&<small>Перед повторной отправкой укажите исправления в замечаниях.</small>}
 </section>;
}
