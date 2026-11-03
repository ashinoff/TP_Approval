import type {ReactNode} from 'react';
import {dateTime,shortDate} from './Ui.js';

type Row=Record<string,any>;
const stateNames:Record<string,string>={DRAFT:'черновик',RIRU_REVIEW:'на согласовании',RES_REVIEW:'на согласовании',CENTRAL_REVIEW:'на согласовании',CENTRAL_COLLECTING:'сбор замечаний',RETURNED:'на доработке',REVISING:'пересмотр',APPROVED:'согласован'};

/**
 * Left panel of the document workplace: the documents of the contract package.
 * The act is reviewed; TU revisions are reference documents (view and download only).
 * Upload controls for the engineer are passed in as children.
 */
export default function PackagePanel({detail,cycle,openTu,onOpenTu,action,busy,api,onDownload,children}:{detail:Row;cycle?:Row;openTu?:string;onOpenTu:(id?:string)=>void;action:(fn:()=>Promise<unknown>)=>Promise<void>;busy:boolean;api:(p:string,b?:object)=>Promise<any>;onDownload:(id:string,n:number)=>Promise<void>;children?:ReactNode}){
 const folder=detail.contractDocuments??{technicalConditions:[],acts:[],contract:{number:detail.contract_number}};
 const tus:Row[]=folder.technicalConditions;
 const cycleTu=cycle?cycle.technical_conditions_id:detail.technical_conditions_id;
 const canPrepare=detail.presentation.canPrepare&&['DRAFT','RETURNED','REVISING'].includes(detail.state);
 const latest=detail.versions.at(-1);
 const kind=detail.act_type==='AVTU'?'АВТУ':'АКТ ТП';
 const others=folder.acts.filter((a:Row)=>a.id!==detail.id);
 return <details className="contract-documents package-panel" open>
  <summary>Пакет документов</summary>
  <p className="package-contract">Договор № {folder.contract.number}</p>
  <ul className="package-list">
   <li className={`package-item${openTu?'':' is-open'}`}>
    <button type="button" className="package-open" aria-pressed={!openTu} onClick={()=>onOpenTu(undefined)}>
     <b>{kind}</b>
     <small>{latest?`версия ${latest.number} · ${stateNames[detail.state]??''}`:'файл ещё не загружен'}</small>
    </button>
   </li>
   {tus.map(t=><li key={t.id} className={`package-item contract-document-row${openTu===t.id?' is-open':''}`}>
    <div className="package-item-main">
     <b>ТУ{t.document_number?` № ${t.document_number}`:''}</b>
     <small>
      редакция {t.number}{t.document_date?` от ${shortDate(t.document_date)}`:''}
      {t.id===cycleTu?(cycle?' · зафиксированы в цикле':' · для отправки'):''}
     </small>
     <small className="package-meta">загружено {dateTime(t.created_at)}</small>
    </div>
    <div className="package-item-actions">
     <button type="button" disabled={busy} onClick={()=>onOpenTu(openTu===t.id?undefined:t.id)}>{openTu===t.id?'Закрыть ТУ':'Открыть ТУ'}</button>
     <button type="button" disabled={busy} onClick={()=>void action(()=>onDownload(t.file_id,t.number))}>Скачать ТУ</button>
     {canPrepare&&t.id!==detail.technical_conditions_id&&<button type="button" disabled={busy} onClick={()=>void action(()=>api(`/api/v1/acts/${detail.id}/technical-conditions/select`,{technicalConditionsId:t.id,expectedRevision:detail.revision}))}>Использовать эти ТУ</button>}
    </div>
   </li>)}
   {!tus.length&&<li className="package-item package-missing"><b>ТУ</b><small>не прикреплены — без них отправка невозможна</small></li>}
  </ul>
  {others.length>0&&<div className="package-others">
   <small>Другие акты этого договора:</small>
   {others.map((a:Row)=><a key={a.id} href={`#/acts/${a.id}?section=work`}>{a.act_type==='AVTU'?'АВТУ':'АКТ ТП'} № {a.act_number}</a>)}
  </div>}
  {children}
 </details>;
}
