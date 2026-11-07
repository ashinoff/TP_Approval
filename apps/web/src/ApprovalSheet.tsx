import {useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {roleNames} from './Ui.js';
import './sheet.css';
import {RossetiLoader} from './Brand.js';
type Row=Record<string,any>;
const decisionNames:Record<string,string>={APPROVED:'Согласовано',RETURNED:'Возвращено с замечаниями',PENDING:'Ожидает решения',NOT_STARTED:'Этап не начат',NO_DECISION:'Без решения'};
const remarkState:Record<string,string>={OPEN:'Не устранено',REPORTED_FIXED:'Исправлено, ожидает проверки',VERIFIED:'Устранено',REOPENED:'Исправление отклонено'};
const dt=(v?:string|null)=>v?new Date(v).toLocaleString('ru-RU',{timeZone:'Europe/Moscow',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
const d=(v?:string|null)=>v?new Date(v+(v.length===10?'T00:00:00Z':'')).toLocaleDateString('ru-RU',{timeZone:v.length===10?'UTC':'Europe/Moscow'}):'—';

/**
 * Лист согласования для печати: реквизиты, кто подготовил, итоговое согласование (ФИО, должность, дата),
 * история циклов с возвратами и все замечания с отметкой об устранении. Данные — только из фактических записей.
 */
/** Служебный значок в углу листа (как на экземпляре к печати): затрудняет подмену листа. */
const Corner=({at}:{at:string})=><span className={`sheet-corner sheet-corner-${at}`} aria-hidden="true"><svg viewBox="0 0 24 24" fill="#fff"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg></span>;

/** inline — лист внутри раздела «Печать» (без отдельного окна); печатается только сам лист. */
export default function ApprovalSheet({detail,api,profile,onClose,inline=false}:{detail:Row;api:(p:string)=>Promise<any>;profile:Row;onClose?:()=>void;inline?:boolean}){
 const [matrices,setMatrices]=useState<Row[]>(),[people,setPeople]=useState<Record<string,Row>>({}),[error,setError]=useState('');
 useEffect(()=>{let active=true;
  Promise.all([Promise.all(detail.cycles.map((c:Row)=>api(`/api/v1/acts/${detail.id}/approval-matrix?cycleId=${c.id}`))),api(`/api/v1/acts/${detail.id}/people`)])
   .then(([m,p])=>{if(active){setMatrices(m);setPeople(Object.fromEntries((p as Row[]).map(x=>[x.id,x])));}}).catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};},[detail.id,detail.cycles.length,api]);
 // Встроенный лист на время печати показывается отдельным окном: печатные стили скрывают всё остальное.
 const [printing,setPrinting]=useState(false);
 const framed=!inline||printing;
 useEffect(()=>{if(!framed)return;document.body.classList.add('sheet-open');return()=>document.body.classList.remove('sheet-open');},[framed]);
 useEffect(()=>{if(!printing)return;const t=setTimeout(()=>{window.print();setPrinting(false);},50);return()=>clearTimeout(t);},[printing]);
 const print=()=>{if(inline)setPrinting(true);else window.print();};
 const pub=detail.presentation?.approvedPublication;
 const kind=detail.act_type==='AVTU'?'АВТУ':'Акт ТП';
 const finalCycle=pub?detail.cycles.find((c:Row)=>c.id===pub.cycleId):detail.cycles.at(-1);
 const finalMatrix=matrices?.find(m=>m.cycle?.id===finalCycle?.id);
 const earlier=(matrices??[]).filter(m=>m.cycle?.id!==finalCycle?.id);
 const position=(id?:string)=>id?people[id]?.position:undefined;
 const author=people[detail.author_id];
 const snapshot:Row=finalCycle?.card_snapshot??{};
 const versionNo=(id:string)=>detail.versions.find((v:Row)=>v.id===id)?.number;
 const lastEvent=(c:Row)=>c.events.at(-1);
 const approved=detail.state==='APPROVED'&&!!pub;
 const row=(r:Row,i:number)=><tr key={r.role}><td>{i+1}</td><td>{r.department}</td><td>{r.person?.name??'—'}{position(r.person?.id)?<small>{position(r.person?.id)}</small>:null}</td>
  <td className={`decision-${r.status}`}>{decisionNames[r.status]??r.status}{r.substitution?<small>по замещению</small>:null}</td><td>{dt(r.decidedAt??r.completedAt)}</td></tr>;

 const body=<div className={`sheet-root${framed?'':' sheet-inline'}`} role={framed?'dialog':'region'} aria-modal={framed?true:undefined} aria-label="Лист согласования">
  <div className="sheet-toolbar">
   <b>Лист согласования</b>
   <span className="sheet-spacer"/>
   <button type="button" className="primary-button" disabled={!matrices} onClick={print}>Печать / PDF</button>
   {onClose&&<button type="button" className="secondary-button" onClick={onClose}>Закрыть</button>}
  </div>
  <div className="sheet-scroll">
   {error&&<p role="alert">{error}</p>}
   {!matrices&&!error&&<RossetiLoader label="Формируем лист согласования…"/>}
   {matrices&&<article className="sheet-page">
    <Corner at="tl"/><Corner at="tr"/><Corner at="bl"/><Corner at="br"/>
    {!approved&&<div className="sheet-draft">Согласование не завершено — предварительный лист</div>}
    <h1>ЛИСТ СОГЛАСОВАНИЯ</h1>
    <p className="sheet-subtitle">{kind} № {detail.act_number} по договору об осуществлении технологического присоединения № {detail.contract_number}{detail.contract_date?` от ${d(detail.contract_date)}`:''}</p>
    <table className="sheet-facts"><tbody>
     <tr><th>РЭС</th><td>{detail.presentation?.res_name??'—'}</td></tr>
     <tr><th>Заявитель</th><td>{detail.applicant||'—'}</td></tr>
     <tr><th>Адрес объекта</th><td>{detail.address||'—'}</td></tr>
     {Object.entries(snapshot).map(([code,v]:[string,any])=><tr key={code}><th>{v.label}</th><td>{v.value.replace(/^(\d{4})-(\d{2})-(\d{2})$/,'$3.$2.$1').replace(/^(\d+)\.(\d+)$/,'$1,$2')}{v.unit?` ${v.unit}`:''}</td></tr>)}
     <tr><th>Версия к печати</th><td>{pub?`версия ${pub.versionNumber} — согласована ${dt(finalCycle?.closed_at)}`:finalCycle?`версия ${versionNo(finalCycle.version_id)} (на согласовании)`:'не отправлялась'}</td></tr>
    </tbody></table>

    <h2>Подготовил</h2>
    <p className="sheet-line">{roleNames.RIRU_ENGINEER}: <b>{author?.name??'—'}</b>{author?.position?`, ${author.position}`:''}{detail.cycles[0]?` · отправлено ${dt(detail.cycles[0].started_at??detail.cycles[0].created_at)}`:''}</p>

    <h2>Согласование{finalCycle?` (цикл ${finalCycle.number}, версия ${versionNo(finalCycle.version_id)})`:''}</h2>
    {finalMatrix?<table className="sheet-table"><thead><tr><th>№</th><th>Подразделение</th><th>ФИО, должность</th><th>Решение</th><th>Дата и время (МСК)</th></tr></thead>
     <tbody>{finalMatrix.rows.map(row)}</tbody></table>:<p>Документ ещё не отправлялся на согласование.</p>}

    {earlier.length>0&&<><h2>Предыдущие циклы</h2>
     {earlier.map(m=><div key={m.cycle.id} className="sheet-cycle"><h3>Цикл {m.cycle.number} · версия {m.version?.number} · {m.overall==='APPROVED'?'согласован':m.requiresRework?'возвращён на доработку':'закрыт'}</h3>
      <table className="sheet-table compact"><thead><tr><th>№</th><th>Подразделение</th><th>ФИО, должность</th><th>Решение</th><th>Дата и время (МСК)</th></tr></thead><tbody>{m.rows.filter((r:Row)=>r.status!=='NOT_STARTED').map(row)}</tbody></table></div>)}</>}

    <h2>Замечания в ходе согласования{detail.comments.length?` (${detail.comments.length})`:''}</h2>
    {detail.comments.length?<table className="sheet-table"><thead><tr><th>№</th><th>Версия</th><th>Автор</th><th>Замечание</th><th>Устранение</th></tr></thead><tbody>
     {detail.comments.map((c:Row,i:number)=>{const e=lastEvent(c);return <tr key={c.id}><td>{i+1}</td><td>{versionNo(c.version_id)}</td>
      <td>{c.author_name}{position(c.author_id)?<small>{position(c.author_id)}</small>:<small>{roleNames[c.author_role]??''}</small>}<small>{dt(c.created_at)}</small></td>
      <td>{c.original_value&&<q>{c.original_value}</q>}{c.text}{c.suggested_value&&<small>Предложено: {c.suggested_value}</small>}</td>
      <td className={`remark-${e?.type??'OPEN'}`}>{remarkState[e?.type??'OPEN']}{e&&<small>{dt(e.created_at)}{e.version_id?` · версия ${versionNo(e.version_id)}`:''}</small>}{e?.explanation&&<small>{e.explanation}</small>}</td></tr>;})}
    </tbody></table>:<p>Замечаний не было.</p>}

    <footer className="sheet-footer">Сформировано {dt(new Date().toISOString())} · {profile.name} · ТП Согласование. Электронное согласование в системе не является электронной подписью.</footer>
   </article>}
  </div>
 </div>;
 return framed?createPortal(body,document.body):body;
}
