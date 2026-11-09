import {useEffect,useState} from 'react';
import {Icon,dateTime} from './Ui.js';

type Row=Record<string,any>;
type Status='all'|'NOT_SYNCED'|'SYNCED'|'CHANGED';
const tabs:[Status,string,string][]=[['all','Все договоры','stack'],['NOT_SYNCED','Не синхронизированы','clock'],['SYNCED','Синхронизированы','okcircle'],['CHANGED','Изменены после синхронизации','alert']];
const stateNames:Record<string,string>={DRAFT:'Черновик',RIRU_REVIEW:'На согласовании',RES_REVIEW:'На согласовании',CENTRAL_REVIEW:'На согласовании',CENTRAL_COLLECTING:'На согласовании',RETURNED:'На доработке',REVISING:'На пересмотре',APPROVED:'Согласован'};
const shortDate=(v?:string|null)=>v?String(v).slice(0,10).split('-').reverse().join('.'):'';
/** Технические характеристики в одну строку: «15 кВт · 0,4 кВ · 3ф · исполнение 15.12.2026». */
function techLine(t:Row){
 const v=(code:string)=>t?.[code]?.value as string|undefined;
 const parts=[v('power_kw')&&`${v('power_kw')!.replace('.',',')} кВт`,v('voltage_kv')&&`${v('voltage_kv')!.replace('.',',')} кВ`,v('phases'),v('plan_date')&&`исполнение ${shortDate(v('plan_date'))}`];
 for(const [code,f]of Object.entries(t??{}))if(!['power_kw','voltage_kv','phases','plan_date'].includes(code))parts.push(`${(f as Row).label}: ${(f as Row).value}${(f as Row).unit?' '+(f as Row).unit:''}`);
 return parts.filter(Boolean) as string[];
}

/**
 * «Синхронизация» (решение владельца 09.11.2026): договоры ТП, которые «Учёт ПУ» забирает по номеру —
 * РЭС, реквизиты и технические характеристики из ТУ. Отметку «синхронизирован» ставит «Учёт ПУ» через сервисный API;
 * если данные потом поменялись, договор показан как «изменён после синхронизации».
 */
export default function SyncPanel({api,resUnits,fixedRes,onOpen}:{api:(p:string)=>Promise<any>;resUnits:Row[];fixedRes?:string;onOpen:(actId:string)=>void}){
 const [status,setStatus]=useState<Status>('all'),[q,setQ]=useState(''),[res,setRes]=useState(fixedRes??''),[page,setPage]=useState(1);
 const [data,setData]=useState<Row>(),[error,setError]=useState(''),[loading,setLoading]=useState(false);
 useEffect(()=>{let active=true;setLoading(true);const timer=setTimeout(()=>{
  const p=new URLSearchParams({status,q,res,page:String(page),limit:'50'});
  api('/api/v1/sync?'+p).then(r=>{if(active){setData(r);setError('');}}).catch(e=>{if(active)setError((e as Error).message);}).finally(()=>{if(active)setLoading(false);});
 },q?250:0);return()=>{active=false;clearTimeout(timer);};},[api,status,q,res,page]);
 const counts=data?.counts??{};const pages=data?Math.max(1,Math.ceil(data.total/data.limit)):1;
 return <section className="card sync-panel" aria-label="Синхронизация с «Учёт ПУ»">
  <div className="navy-head sync-head">
   <b className="sync-title"><Icon name="sync" size={20}/>Синхронизация с «Учёт ПУ»</b>
   <span className="sync-help">«Учёт ПУ» забирает по номеру договора ТП: РЭС, реквизиты и технические характеристики из ТУ. После переноса здесь появляется отметка «синхронизирован».</span>
  </div>
  {data&&!data.configured&&<p role="note" className="sync-off"><Icon name="alert" size={16}/>Подключение «Учёт ПУ» ещё не настроено: администратору нужно задать ключ SYNC_API_KEY. Список ниже — то, что будет передано.</p>}
  <div className="queue-switch sync-tabs" role="group" aria-label="Статус синхронизации">{tabs.map(([k,label,icon])=><button key={k} type="button" data-sync={k} aria-pressed={status===k} aria-label={`${label}: ${counts[k==='all'?'all':k]??0}`} onClick={()=>{setStatus(k);setPage(1);}}><Icon name={icon} size={16}/>{label}<b className={`tab-count${counts[k==='all'?'all':k]?'':' is-zero'}`}>{counts[k==='all'?'all':k]??0}</b></button>)}</div>
  <div className="sync-filters">
   <label className="sync-search"><Icon name="search" size={16}/><input aria-label="Поиск договора" placeholder="Номер договора, заявитель или адрес" value={q} onChange={e=>{setQ(e.target.value);setPage(1);}}/></label>
   {!fixedRes&&resUnits.length>1&&<label className="sync-res"><span className="sr-only">РЭС</span><select aria-label="РЭС" value={res} onChange={e=>{setRes(e.target.value);setPage(1);}}><option value="">Все РЭС</option>{resUnits.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
  </div>
  {error&&<p role="alert">{error}</p>}
  <div className="sync-list" aria-busy={loading}>
   {data&&!data.items.length&&<p className="sync-empty">{q||res||status!=='all'?'Ничего не найдено по выбранным условиям.':'Договоров пока нет — они появятся после загрузки ТУ и акта.'}</p>}
   {data?.items.map((r:Row)=>{const tech=techLine(r.technical);const s=r.sync_status as Exclude<Status,'all'>;
    return <article key={r.number_key} className={`sync-row sync-${s.toLowerCase()}`} aria-label={`Договор ${r.contract_number}`}>
     <div className="sync-main">
      <button type="button" className="sync-number" onClick={()=>onOpen(r.act_id)} title="Открыть документ">{r.contract_number}</button>
      <span className="sync-meta">{r.contract_day?`от ${shortDate(r.contract_day)} · `:''}{r.res_name} · {(r.act_type==='AVTU'?'АВТУ':r.act_type==='NOTICE'?'Уведомление':'Акт ТП')} · {stateNames[r.state]??r.state}{r.documents>1?` · документов: ${r.documents}`:''}</span>
      {(r.applicant||r.address)&&<span className="sync-who">{[r.applicant,r.address].filter(Boolean).join(' · ')}</span>}
     </div>
     <div className="sync-tech" aria-label="Технические характеристики">
      {tech.length?tech.map(t=><span key={t} className="sync-chip">{t}</span>):<span className="sync-missing">Технические данные не заполнены</span>}
      <span className={`sync-tu${r.tu?'':' sync-missing'}`}>{r.tu?`ТУ ред. ${r.tu.revision}${r.tu.number?` № ${r.tu.number}`:''}${r.tu.date?` от ${shortDate(r.tu.date)}`:''}`:'ТУ не загружены'}</span>
     </div>
     <div className="sync-state" role="status">
      <span className="sync-mark" aria-hidden="true"><Icon name={s==='SYNCED'?'check':s==='CHANGED'?'alert':'clock'} size={16}/></span>
      <span><b>{s==='SYNCED'?'Синхронизирован':s==='CHANGED'?'Изменён после синхронизации':'Не синхронизирован'}</b>
       {r.synced_at&&<small>{s==='CHANGED'?'передан ':''}{dateTime(r.synced_at)}{r.synced_count>1?` · раз: ${r.synced_count}`:''}</small>}</span>
     </div>
    </article>;})}
  </div>
  {pages>1&&<nav className="sync-pages" aria-label="Страницы"><button type="button" className="secondary-button" disabled={page<=1} onClick={()=>setPage(p=>p-1)}>Назад</button><span>{page} из {pages}</span><button type="button" className="secondary-button" disabled={page>=pages} onClick={()=>setPage(p=>p+1)}>Далее</button></nav>}
 </section>;
}
