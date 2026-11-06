import {useCallback,useEffect,useMemo,useState} from 'react';
import './accounts.css';
type Row=Record<string,any>;
type Slot={role:string;title:string;single:boolean};
type Unit={key:string;name:string;resId:string|null;slots:Slot[]};

/** Должности подразделений (решение владельца 06.11.2026): в РЭС один начальник РЭС и один начальник РИРУ, инженеров — сколько нужно;
 *  в службах задачу согласования получает начальник (главный инженер ТЕХБЛОКА), инженеры службы видят документы. */
const resSlots:Slot[]=[{role:'RES_HEAD',title:'Начальник РЭС',single:true},{role:'RIRU_HEAD',title:'Начальник РИРУ',single:true},{role:'RIRU_ENGINEER',title:'Инженеры РИРУ',single:false}];
const services:Unit[]=[
 {key:'SUE',name:'СУЭ',resId:null,slots:[{role:'SUE',title:'Начальник СУЭ',single:true},{role:'SUE_ENGINEER',title:'Инженеры СУЭ',single:false}]},
 {key:'STP',name:'СТП',resId:null,slots:[{role:'STP',title:'Начальник СТП',single:true},{role:'STP_ENGINEER',title:'Инженеры СТП',single:false}]},
 {key:'GI',name:'ТЕХБЛОК',resId:null,slots:[{role:'GI',title:'Главный инженер',single:true},{role:'GI_ENGINEER',title:'Инженеры ТЕХБЛОКА',single:false}]},
];
const positionTitle:Record<string,string>={RES_HEAD:'Начальник РЭС',RIRU_HEAD:'Начальник РИРУ',RIRU_ENGINEER:'Инженер РИРУ',SUE:'Начальник СУЭ',SUE_ENGINEER:'Инженер СУЭ',STP:'Начальник СТП',STP_ENGINEER:'Инженер СТП',GI:'Главный инженер',GI_ENGINEER:'Инженер ТЕХБЛОКА'};

/**
 * Структура подразделений: таблетка подразделения (РЭС, СУЭ, СТП, ТЕХБЛОК) → таблетка должности → сотрудники.
 * Назначение и снятие — та же правка учётной записи, что и в «Сотрудниках» (роль + область РЭС), с записью в журнал.
 */
export default function OrgStructure({api,resUnits}:{api:(p:string,b?:object)=>Promise<any>;resUnits:Row[]}){
 const units=useMemo<Unit[]>(()=>[...resUnits.map(r=>({key:r.id,name:r.name,resId:r.id,slots:resSlots})),...services],[resUnits]);
 const [users,setUsers]=useState<Row[]>([]),[unitKey,setUnitKey]=useState<string>(),[slotRole,setSlotRole]=useState<string>(),[pick,setPick]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const load=useCallback(async()=>setUsers(await api('/api/v1/admin/local-users')),[api]);
 useEffect(()=>{void load().catch(e=>setError((e as Error).message));},[load]);
 const unit=units.find(u=>u.key===unitKey)??units[0];
 const slot=unit?.slots.find(s=>s.role===slotRole)??unit?.slots[0];
 const holds=(u:Row,role:string,resId:string|null)=>(u.roles??[]).some((r:Row)=>r.role===role&&(r.resId??null)===resId);
 const members=(role:string)=>users.filter(u=>u.active&&holds(u,role,unit.resId));
 const save=async(user:Row,assignments:Row[],position?:string)=>{if(!user.email)throw new Error(`У сотрудника «${user.name}» не указан email — заполните его во вкладке «Сотрудники», затем назначьте.`);return api(`/api/v1/admin/local-users/${user.id}/profile`,{login:user.login,name:user.name,email:user.email??'',position:position??user.position??'',expectedRevision:user.revision,assignments});};
 const run=async(fn:()=>Promise<unknown>,done:string)=>{setBusy(true);setError('');setNotice('');try{await fn();await load();setNotice(done);setPick('');}catch(e){setError((e as Error).message);await load().catch(()=>{});}finally{setBusy(false);}};
 const assign=(user:Row)=>run(async()=>{
  const current=slot.single?members(slot.role):[];
  for(const old of current)if(old.id!==user.id)await save(old,(old.roles??[]).filter((r:Row)=>!(r.role===slot.role&&(r.resId??null)===unit.resId)));
  const fresh=(await api('/api/v1/admin/local-users') as Row[]).find(u=>u.id===user.id)!;
  await save(fresh,[...(fresh.roles??[]),{role:slot.role,resId:unit.resId}],fresh.position||positionTitle[slot.role]);
 },`${user.name} назначен(а): ${slot.title} — ${unit.name}.`);
 const remove=(user:Row)=>run(()=>save(user,(user.roles??[]).filter((r:Row)=>!(r.role===slot.role&&(r.resId??null)===unit.resId))),`${user.name} снят(а): ${slot.title} — ${unit.name}.`);
 if(!unit)return null;
 const people=members(slot.role);
 const candidates=users.filter(u=>u.active&&!holds(u,slot.role,unit.resId)).sort((a,b)=>a.name.localeCompare(b.name,'ru'));
 const count=(u:Unit)=>u.slots.reduce((n,s)=>n+users.filter(x=>x.active&&holds(x,s.role,u.resId)).length,0);
 const missing=(u:Unit)=>u.slots.some(s=>s.single&&users.filter(x=>x.active&&holds(x,s.role,u.resId)).length!==1);
 return <section className="card org-structure" aria-label="Структура подразделений">
  <div className="queue-switch org-units" role="group" aria-label="Подразделение">
   {units.map(u=><button key={u.key} type="button" aria-pressed={u.key===unit.key} onClick={()=>{setUnitKey(u.key);setSlotRole(undefined);setPick('');setNotice('');}}>
    {u.name}<b className={`tab-count${missing(u)?' needs':''}`} title={missing(u)?'Не назначен или назначено несколько руководителей':undefined}>{count(u)}</b></button>)}
  </div>
  <div className="queue-switch org-slots" role="group" aria-label="Должность">
   {unit.slots.map(s=>{const n=members(s.role).length;return <button key={s.role} type="button" aria-pressed={s.role===slot.role} onClick={()=>{setSlotRole(s.role);setPick('');setNotice('');}}>
    {s.title}<b className={`tab-count${s.single&&n!==1?' needs':n?'':' is-zero'}`}>{n}</b></button>;})}
  </div>
  {error&&<p role="alert" className="service-error">{error}</p>}
  {notice&&<p role="status" className="service-notice">{notice}</p>}
  <div className="org-slot">
   <h3>{slot.title} · {unit.name}</h3>
   {slot.single&&people.length>1&&<p className="service-error">Назначено несколько человек — на этап согласования некого выбрать. Оставьте одного.</p>}
   {slot.single&&!people.length&&<p className="helper-text">Никто не назначен — документы этого {unit.resId?'РЭС':'подразделения'} не смогут пройти этап «{slot.title}».</p>}
   <ul className="org-people">{people.map(u=><li key={u.id}><div><b>{u.name}</b><small>{[u.position,u.login].filter(Boolean).join(' · ')}</small></div>
    <button type="button" className="danger-button" disabled={busy} onClick={()=>void remove(u)}>Снять</button></li>)}</ul>
   <div className="org-assign">
    <label>{slot.single&&people.length?'Заменить на':'Назначить сотрудника'}<select aria-label="Сотрудник для назначения" value={pick} disabled={busy} onChange={e=>setPick(e.target.value)}>
     <option value="">Выберите сотрудника</option>{candidates.map(u=><option key={u.id} value={u.id}>{u.name}{u.position?` — ${u.position}`:''}</option>)}</select></label>
    <button type="button" className="primary-button" disabled={busy||!pick} onClick={()=>{const u=users.find(x=>x.id===pick);if(u)void assign(u);}}>{slot.single&&people.length?'Заменить':'Назначить'}</button>
   </div>
   <p className="helper-text">Новых сотрудников заводите во вкладке «Сотрудники», затем назначайте здесь. Сотрудник с изменёнными ролями входит заново.</p>
  </div>
 </section>;
}
