import {Icon,dateTime,shortDate} from './Ui.js';

type Row=Record<string,any>;
export const extraNames:Record<string,string>={PSU:'ПСУ',PREV_ACT:'Предыдущий акт ТП',POLE_SCHEME:'Поопорная схема',TU_CHANGE:'Изменения к ТУ',PROJECT:'Проект'};
const stateNames:Record<string,string>={DRAFT:'черновик',RIRU_REVIEW:'на согласовании',RES_REVIEW:'на согласовании',CENTRAL_REVIEW:'на согласовании',CENTRAL_COLLECTING:'сбор замечаний',RETURNED:'на доработке',REVISING:'пересмотр',APPROVED:'согласован'};

/**
 * Documents of the contract package (section «Данные»): the act versions, TU revisions and extra documents.
 * A row opens the document in «Просмотр»; TU revisions and extra documents are reference documents (view and download only).
 */
export default function PackagePanel({detail,cycle,onOpen,action,busy,api,onDownload}:{detail:Row;cycle?:Row;onOpen:(key?:string)=>void;action:(fn:()=>Promise<unknown>)=>Promise<unknown>;busy:boolean;api:(p:string,b?:object)=>Promise<any>;onDownload:(id:string,n:number)=>Promise<void>}){
 const folder=detail.contractDocuments??{technicalConditions:[],acts:[],contract:{number:detail.contract_number}};
 const tus:Row[]=folder.technicalConditions;
 const cycleTu=cycle?cycle.technical_conditions_id:detail.technical_conditions_id;
 const canPrepare=detail.presentation.canPrepare&&['DRAFT','RETURNED','REVISING'].includes(detail.state);
 const latest=detail.versions.at(-1);
 // Согласованная версия — единственная «к печати»; остальные версии остаются историей.
 const pub=detail.presentation.approvedPublication;
 const kind=detail.act_type==='AVTU'?'АВТУ':'АКТ ТП';
 const others=folder.acts.filter((a:Row)=>a.id!==detail.id);
 return <section className="data-block contract-documents package-panel" aria-label="Пакет документов">
  <h3 className="data-title"><Icon name="file" size={16}/>Пакет документов<small>договор № {folder.contract.number}</small></h3>
  <ul className="package-list">
   <li className="package-item">
    <button type="button" className="package-open" title="Открыть в просмотре" onClick={()=>onOpen(undefined)}>
     <Icon name="file"/><span><b>{kind}</b><small>{latest?`версия ${latest.number} · ${stateNames[detail.state]??''}`:'файл ещё не загружен'}</small>{pub&&<small className="package-print">к печати: версия {pub.versionNumber}</small>}</span>
    </button>
    {latest&&<button type="button" className="icon-button package-download" aria-label={pub?`Скачать ${kind} к печати`:`Скачать ${kind}`} title={pub?`Скачать согласованную версию ${pub.versionNumber} (к печати)`:`Скачать ${kind}`} disabled={busy} onClick={()=>void action(()=>pub?onDownload(pub.fileId,pub.versionNumber):onDownload(latest.file_id,latest.number))}><Icon name="download"/></button>}
   </li>
   {tus.map(t=><li key={t.id} className="package-item contract-document-row">
    <button type="button" className="package-open" aria-label="Открыть ТУ" title="Открыть ТУ в просмотре" onClick={()=>onOpen('tu:'+t.id)}>
     <Icon name="file"/><span><b>ТУ{t.document_number?` № ${t.document_number}`:''}</b>
     <small>редакция {t.number}{t.document_date?` от ${shortDate(t.document_date)}`:''}{t.id===cycleTu?(cycle?' · зафиксированы в цикле':' · для отправки'):''}</small>
     <small className="package-meta">загружено {dateTime(t.created_at)}</small></span>
    </button>
    <button type="button" className="icon-button package-download" aria-label="Скачать ТУ" title="Скачать ТУ" disabled={busy} onClick={()=>void action(()=>onDownload(t.file_id,t.number))}><Icon name="download"/></button>
    {canPrepare&&t.id!==detail.technical_conditions_id&&<button type="button" className="package-use" disabled={busy} onClick={()=>void action(()=>api(`/api/v1/acts/${detail.id}/technical-conditions/select`,{technicalConditionsId:t.id,expectedRevision:detail.revision}))}>Использовать эти ТУ</button>}
   </li>)}
   {!tus.length&&<li className="package-item package-missing"><b>ТУ</b><small>не прикреплены — без них отправка невозможна</small></li>}
   {(folder.extraDocuments??[]).map((x:Row)=><li key={x.id} className="package-item package-extra">
    <button type="button" className="package-open" title="Открыть в просмотре" onClick={()=>onOpen('x:'+x.id)}><Icon name="file"/><span><b>{extraNames[x.kind]??'Документ'}{x.number>1?` (${x.number})`:''}</b><small>к {x.act_type==='AVTU'?'АВТУ':'акту ТП'} · загружено {dateTime(x.created_at)}</small></span></button>
    <button type="button" className="icon-button package-download" aria-label={`Скачать: ${extraNames[x.kind]}`} title="Скачать" disabled={busy} onClick={()=>void action(()=>onDownload(x.file_id,x.number))}><Icon name="download"/></button>
   </li>)}
  </ul>
  {others.length>0&&<div className="package-others">
   <small>Другие акты этого договора:</small>
   {others.map((a:Row)=><a key={a.id} href={`#/acts/${a.id}?section=work`}>{a.act_type==='AVTU'?'АВТУ':'АКТ ТП'} № {a.act_number}</a>)}
  </div>}
 </section>;
}
