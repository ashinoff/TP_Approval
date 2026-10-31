import {useEffect,useState} from 'react';

type MatrixRow={role:string;department:string;person:{id:string;name:string;source:string}|null;
  assignment:{assigned?:{id:string;name:string};principal?:{id:string;name:string};source?:string}|null;
  substitution:boolean;status:string;receivedAt:string|null;dueAt:string|null;decidedAt:string|null;
  policy:{workingDays:number;preliminary:boolean}|null;elapsedSeconds:number|null;durationRunning:boolean;
  overdue:boolean;wasOverdue:boolean;commentCount:number;comments:{id:string;text:string;createdAt:string}[]};
type Matrix={actId:string;asOf:string;cycle:{id:string;number:number;closedAt:string|null}|null;
  version:{id:string;number:number}|null;latestVersionNumber:number|null;
  cycles:{id:string;number:number;versionNumber:number}[];overall:string;overdue:boolean;requiresRework:boolean;publicationStatus:string|null;rows:MatrixRow[]};
const statuses:Record<string,{icon:string;text:string;css:string}>={
  APPROVED:{icon:'✓',text:'Согласовано',css:'approved'},RETURNED:{icon:'✕',text:'Отклонено с замечаниями',css:'returned'},
  PENDING:{icon:'◷',text:'Ожидает решения',css:'pending'},NOT_STARTED:{icon:'○',text:'Этап не начался',css:'not-started'},
  NO_DECISION:{icon:'⊘',text:'Без решения · сбор закрыт',css:'not-started'},
  IN_REVIEW:{icon:'◷',text:'На согласовании',css:'pending'},REQUIRES_REWORK:{icon:'✕',text:'Требует доработки',css:'returned'},
  OVERDUE:{icon:'⏰',text:'Просрочено',css:'overdue'},REVOKED:{icon:'⊘',text:'Отозвано',css:'not-started'}
};
function indicator(status:string){const s=statuses[status];return <span className={`matrix-status matrix-${s.css}`}><span aria-hidden="true">{s.icon}</span> <span>{s.text}</span></span>;}
const time=(value:string|null)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
function duration(value:number|null){if(value===null)return '—';const days=Math.floor(value/86400);const hours=Math.floor(value%86400/3600);const minutes=Math.floor(value%3600/60);const seconds=value%60;return `${days?`${days} д `:''}${hours} ч ${minutes} мин ${seconds} с`;}
export default function ApprovalMatrix({actId,api}:{actId:string;api:(path:string)=>Promise<any>}){
  const key=`tp.matrix.cycle.${actId}`;
  const [selected,setSelected]=useState(()=>sessionStorage.getItem(key)??'current');
  const [data,setData]=useState<Matrix>();const [error,setError]=useState('');const [reload,setReload]=useState(0);const [commentsRole,setCommentsRole]=useState<string>();
  useEffect(()=>{
    let active=true;let pending=false;
    const load=async()=>{
      if(pending||!active)return;pending=true;
      try{
        const result:Matrix=await api(`/api/v1/acts/${actId}/approval-matrix${selected==='current'?'':`?cycleId=${encodeURIComponent(selected)}`}`);
        if(active){setData(result);setError('');}
      }catch(e){if(active){setData(undefined);setError((e as Error).message);}}
      finally{pending=false;}
    };
    setData(undefined);void load();
    const timer=setInterval(()=>{if(document.visibilityState==='visible')void load();},5000);
    const visible=()=>{if(document.visibilityState==='visible')void load();};
    document.addEventListener('visibilitychange',visible);window.addEventListener('focus',visible);
    return()=>{active=false;clearInterval(timer);document.removeEventListener('visibilitychange',visible);window.removeEventListener('focus',visible);};
  },[actId,api,selected,reload]);
  const select=(value:string)=>{setSelected(value);setCommentsRole(undefined);sessionStorage.setItem(key,value);};
  const row=data?.rows.find(r=>r.role===commentsRole);
  return <section aria-label="Матрица согласования" className="approval-matrix">
    <div className="matrix-toolbar"><h3>Матрица согласования</h3><button type="button" className="link" onClick={()=>setReload(n=>n+1)}>Обновить матрицу</button></div>
    <label className="matrix-cycle-label">Цикл согласования<select aria-label="Цикл согласования" value={selected} onChange={e=>select(e.target.value)}>
      <option value="current">Текущий цикл</option>{data?.cycles.map(c=><option key={c.id} value={c.id}>Цикл {c.number} · Word v{c.versionNumber}</option>)}
    </select></label>
    {error&&<p role="alert" className="error">Не удалось загрузить матрицу: {error}</p>}
    {!data&&!error&&<p role="status">Загрузка матрицы…</p>}
    {data&&<>
      <div className="matrix-summary" role="region" aria-label="Итог согласования">{indicator(data.overall)}
        {data.overdue&&data.overall!=='OVERDUE'&&indicator('OVERDUE')}
        {data.requiresRework&&data.overall==='OVERDUE'&&indicator('REQUIRES_REWORK')}
        <span>Версия Word: <b>{data.version?.number??'не загружена'}</b> · Цикл: <b>{data.cycle?.number??'не начат'}</b></span>
      </div>
      {!data.cycle&&<p>Документ ещё не направлен на согласование. Этапы не начались.</p>}
      {data.cycle?.closedAt&&<p className="matrix-history-note">Исторический цикл завершён {time(data.cycle.closedAt)} МСК. Решения и даты сохранены; отсутствующее решение не считается согласованием.</p>}
      {data.publicationStatus==='UNDER_REVISION'&&<p>Утверждённая версия находится на пересмотре. Её завершённое согласование сохранено; новая версия проходит отдельный полный цикл.</p>}
      {data.latestVersionNumber!==data.version?.number&&<p>В карточке уже есть новая версия Word: {data.latestVersionNumber}. Здесь показана версия выбранного цикла.</p>}
      <div className="matrix-scroll" tabIndex={0} aria-label="Таблица согласующих, горизонтальная прокрутка"><table className="matrix-table">
        <caption>Сначала Начальник РЭС, затем СУЭ, СТП и ГИ параллельно. Даты и время — МСК.</caption>
        <thead><tr><th scope="col">Подразделение</th><th scope="col">ФИО</th><th scope="col">Статус</th><th scope="col">Поступление</th><th scope="col">Нормативный срок</th><th scope="col">Решение</th><th scope="col">Продолжительность</th><th scope="col">Замечания</th></tr></thead>
        <tbody>{data.rows.map(r=><tr key={r.role} data-testid={`matrix-row-${r.role}`}>
          <th scope="row">{r.department}</th>
          <td><span>{r.person?.name??'Не назначен'}</span>{r.person?.source==='LEGACY_ASSIGNEE'&&<small>Исходное назначение до фиксации истории; решение отсутствует</small>}{r.substitution&&<small className="matrix-substitution">↔ Замещение · {r.assignment?.principal?.name??'основной согласующий'}</small>}</td>
          <td>{indicator(r.status)}{(r.overdue||r.wasOverdue)&&<span className="matrix-late"><span aria-hidden="true">⏰</span> <span>{r.overdue?'Просрочено':'Завершено с просрочкой'}</span></span>}</td>
          <td><time>{time(r.receivedAt)}</time></td>
          <td>{r.policy?<>{r.policy.workingDays} раб. дн.{r.policy.preliminary&&<small>Предварительный норматив</small>}<small>До {time(r.dueAt)}</small></>:'—'}</td>
          <td><time>{time(r.decidedAt)}</time></td>
          <td>{duration(r.elapsedSeconds)}{r.durationRunning&&<small>В работе</small>}</td>
          <td><button type="button" className="matrix-comments" disabled={!r.commentCount} aria-label={`Замечания ${r.department}: ${r.commentCount}`} onClick={()=>setCommentsRole(r.role)}>{r.commentCount}</button></td>
        </tr>)}</tbody>
      </table></div>
      <p className="matrix-footnote">Продолжительность — календарное время от поступления до решения или закрытия задачи; для ожидания — по состоянию на {time(data.asOf)} МСК. Норматив указан в рабочих днях по сохранённой политике и календарю.</p>
      {row&&<section className="matrix-comments-panel" aria-label={`Замечания согласующего ${row.department}`}><div className="detailHeader"><h3>Замечания: {row.department}</h3><button type="button" className="link" onClick={()=>setCommentsRole(undefined)}>Скрыть замечания</button></div>
        {row.comments.map(c=><article className="comment unresolved" key={c.id}><strong>{c.text}</strong><p>{row.person?.name??'Согласующий'} · {time(c.createdAt)} МСК · Word v{data.version?.number}</p></article>)}
      </section>}
    </>}
  </section>;
}
