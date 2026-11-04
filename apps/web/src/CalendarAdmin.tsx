import './accounts.css';
import {useEffect,useMemo,useState} from 'react';
type Row=Record<string,any>;
type Day={day:string;working:boolean;source:string;revision:number};
const months=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
const weekdays=['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const iso=(y:number,m:number,d:number)=>`${y}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;

/** Производственный календарь: клик по дню меняет рабочий/выходной, сохранение — с основанием (приказ организации и т.п.). */
export default function CalendarAdmin({api}:{api:(p:string,b?:object)=>Promise<any>}){
 const [year,setYear]=useState(()=>new Date().getFullYear());
 const [days,setDays]=useState<Record<string,Day>>({}),[changes,setChanges]=useState<Record<string,boolean>>({});
 const [source,setSource]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=async(y:number)=>{setBusy(true);setError('');try{const rows:Day[]=await api('/api/v1/admin/calendar?year='+y);setDays(Object.fromEntries(rows.map(r=>[r.day,r])));setChanges({});}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 useEffect(()=>{void load(year);},[year]);
 const working=(day:string)=>changes[day]??days[day]?.working;
 const toggle=(day:string)=>{if(!days[day]&&changes[day]===undefined){setChanges(c=>({...c,[day]:new Date(day+'T00:00:00Z').getUTCDay()%6!==0}));return;}
  const next=!working(day);setChanges(c=>{const copy={...c};if(days[day]&&days[day].working===next)delete copy[day];else copy[day]=next;return copy;});setNotice('');};
 const pending=Object.keys(changes).length;
 const total=useMemo(()=>{let w=0,known=0;for(let m=0;m<12;m++)for(let d=1;d<=new Date(Date.UTC(year,m+1,0)).getUTCDate();d++){const k=iso(year,m,d);const v=working(k);if(v!==undefined){known++;if(v)w++;}}return {w,known};},[days,changes,year]);
 const save=async()=>{if(!source.trim()){setError('Укажите основание изменения, например «Приказ № 15 от 01.12.2026».');return;}
  setBusy(true);setError('');try{await api('/api/v1/admin/calendar',{days:Object.entries(changes).map(([day,w])=>({day,working:w,source:source.trim()}))});setNotice(`Сохранено дней: ${pending}.`);setSource('');await load(year);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="card calendar-admin" aria-label="Производственный календарь">
  <div className="calendar-toolbar">
   <button type="button" disabled={busy||pending>0} onClick={()=>setYear(y=>y-1)} aria-label="Предыдущий год">‹</button><h2>{year}</h2><button type="button" disabled={busy||pending>0} onClick={()=>setYear(y=>y+1)} aria-label="Следующий год">›</button>
   <span className="calendar-stat">Рабочих дней: <b>{total.w}</b>{total.known<365&&<> · заполнено {total.known} дн.</>}</span>
   <span className="calendar-legend"><i className="cal-work"/>рабочий<i className="cal-off"/>выходной<i className="cal-changed"/>изменён<i className="cal-missing"/>не задан</span>
  </div>
  <p className="helper-text">Нажмите на день, чтобы сделать его рабочим или выходным. Сроки уже назначенных задач не пересчитываются — изменения действуют для новых отправок на согласование. Незаполненный день останавливает отправку.</p>
  {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
  <div className="calendar-grid">{months.map((name,m)=>{const first=(new Date(Date.UTC(year,m,1)).getUTCDay()+6)%7,count=new Date(Date.UTC(year,m+1,0)).getUTCDate();
   return <div className="calendar-month" key={m}><h3>{name}</h3><div className="calendar-days">{weekdays.map(w=><span className="cal-head" key={w}>{w}</span>)}{Array.from({length:first},(_,i)=><span key={'e'+i}/>)}
    {Array.from({length:count},(_,i)=>{const k=iso(year,m,i+1),v=working(k),info:Row|undefined=days[k];
     return <button type="button" key={k} disabled={busy} className={`cal-day ${v===undefined?'cal-missing':v?'cal-work':'cal-off'}${k in changes?' cal-changed':''}`} title={`${new Date(k+'T00:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC'})}: ${v===undefined?'не задан':v?'рабочий':'выходной'}${info?` · ${info.source}`:''}`} aria-pressed={v===false} onClick={()=>toggle(k)}>{i+1}</button>;})}
   </div></div>;})}</div>
  {pending>0&&<div className="calendar-save">
   <label>Основание изменения<input value={source} maxLength={300} placeholder="Приказ № … от …" onChange={e=>setSource(e.target.value)}/></label>
   <button className="primary-button" disabled={busy} onClick={()=>void save()}>Сохранить изменения ({pending})</button>
   <button type="button" disabled={busy} onClick={()=>{setChanges({});setNotice('');}}>Отменить</button>
  </div>}
 </section>;
}
