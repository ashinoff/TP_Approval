import {useState,useEffect,useCallback,useRef} from 'react';
import ApprovalMatrix from './ApprovalMatrix.js';
import Registry,{emptyFilters,type Filters} from './Registry.js';
import ActDocument from './ActDocument.js';
import RouteFlow from './RouteFlow.js';
import Timeline from './Timeline.js';
import DecisionDialog from './DecisionDialog.js';
import WordWorkspace from './WordWorkspace.js';
import {Icon,StatusBadge,IconButton,roleNames,dateTime,shortDate} from './Ui.js';
type Row=Record<string,any>;
const stageNames:Record<string,string>={DRAFT:'Черновик',RES_REVIEW:'Начальник РЭС',CENTRAL_REVIEW:'СУЭ · СТП · ГИ',CENTRAL_COLLECTING:'Сбор замечаний',RETURNED:'На доработке',APPROVED:'Согласовано',REVISING:'Пересмотр'};
const messages:Record<string,string>={RETURN_REASON_REQUIRED:'Укажите замечание для возврата документа.',COMMENT_VERIFICATION_REQUIRED:'Сначала подтвердите устранение своих замечаний в новой версии.',NEW_VERSION_REQUIRED:'Загрузите новую версию документа перед повторной отправкой.',INVALID_STATE:'Действие недоступно на текущем этапе. Обновите данные.',STALE_REVISION:'Документ изменился. Обновите данные и повторите действие.',INVALID_DOCX:'Файл не является корректным документом DOCX.',NOT_FOUND:'Документ не найден или недоступен.',INVALID_TOKEN:'Срок входа истёк. Войдите повторно.',ROLE_REQUIRED:'Для этого действия недостаточно прав.',CALENDAR_MISSING:'Для расчёта срока не загружен календарь.',CALENDAR_GAP:'В календаре отсутствуют даты.'};
const noRegistry={items:[] as Row[],total:0,page:1,limit:25,summary:{total:0,inReview:0,rework:0,overdue:0,approved:0}};
export default function App(){
  const [token,setToken]=useState('');const [profile,setProfile]=useState<Row>();const [resUnits,setResUnits]=useState<Row[]>([]);
  const [tasks,setTasks]=useState<Row[]>([]);const [notes,setNotes]=useState<Row[]>([]);const [badge,setBadge]=useState(0);
  const [registry,setRegistry]=useState(noRegistry);const [filters,setFilters]=useState<Filters>({...emptyFilters});const [page,setPage]=useState(1);const [tab,setTab]=useState('registry');
  const [detail,setDetail]=useState<Row>();const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [listBusy,setListBusy]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);const [dialog,setDialog]=useState<{record:Row;choice:'approve'|'return'}>();
  const [actTab,setActTab]=useState(()=>sessionStorage.getItem('tp.actTab')==='matrix'?'matrix':'document');
  const [demoUsers,setDemoUsers]=useState<Row[]>([]);const [demoUser,setDemoUser]=useState('riru-adler');
  const selectedId=useRef<string|undefined>(undefined);const generation=useRef(0);const listSequence=useRef(0);const busyRef=useRef(false);busyRef.current=busy;
  const queryRef=useRef({filters,page,tab});queryRef.current={filters,page,tab};
  const env=(import.meta as unknown as {env:Record<string,string>}).env;
  const demoOrigin=env.DEV&&env.VITE_DEMO_AUTH_ORIGIN==='http://127.0.0.1:4100'?env.VITE_DEMO_AUTH_ORIGIN:undefined;
  const platformOrigin=env.VITE_PLATFORM_ORIGIN;
  useEffect(()=>{if(demoOrigin)fetch(demoOrigin+'/users').then(r=>r.json()).then(setDemoUsers).catch(()=>setError('Тестовый сервис входа недоступен. Запустите npm run demo.'));},[demoOrigin]);
  useEffect(()=>{
    if(!platformOrigin||window.parent===window)return;
    const receive=(e:MessageEvent)=>{if(e.origin===platformOrigin&&e.source===window.parent&&e.data?.type==='platform-auth'&&typeof e.data.token==='string')setToken(e.data.token);};
    window.addEventListener('message',receive);const ready=()=>window.parent.postMessage({type:'app-ready'},platformOrigin);ready();const timer=setInterval(ready,45000);
    return()=>{window.removeEventListener('message',receive);clearInterval(timer);};
  },[platformOrigin]);
  const api=useCallback(async(path:string,body?:object|FormData)=>{
    const headers:Record<string,string>={Authorization:'Bearer '+token};
    if(body){headers['Idempotency-Key']=crypto.randomUUID();if(!(body instanceof FormData))headers['Content-Type']='application/json';}
    const response=await fetch(path,{method:body?'POST':'GET',headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined});
    if(!response.ok){const e=await response.json().catch(()=>({}));throw new Error(messages[e.error?.code]??e.error?.message??('Ошибка запроса: HTTP '+response.status));}return response.json();
  },[token]);
  const loadRegistry=useCallback(async()=>{
    const epoch=generation.current;const seq=++listSequence.current;const current=queryRef.current;
    const params=new URLSearchParams({page:String(current.page),limit:'25'});
    for(const [key,value]of Object.entries(current.filters))if(value!==''&&value!==false)params.set(key,String(value));
    if(current.tab==='tasks')params.set('action','true');setListBusy(true);
    try{const data=await api('/api/v1/registry?'+params);if(epoch===generation.current&&seq===listSequence.current)setRegistry(data);}
    catch(e){if(epoch===generation.current&&seq===listSequence.current)throw e;}
    finally{if(epoch===generation.current&&seq===listSequence.current)setListBusy(false);}
  },[api]);
  const refresh=useCallback(async()=>{
    const epoch=generation.current;const [,t,n,b]=await Promise.all([loadRegistry(),api('/api/v1/tasks/mine'),api('/api/v1/notifications'),api('/api/platform/badge')]);
    if(epoch===generation.current){setTasks(t);setNotes(n);setBadge(b.count);}
  },[api,loadRegistry]);
  useEffect(()=>{
    const epoch=++generation.current;selectedId.current=undefined;setDetail(undefined);setProfile(undefined);setRegistry(noRegistry);setTasks([]);setNotes([]);setBadge(0);setError('');setDialog(undefined);setCreateOpen(false);
    if(token)Promise.all(['/api/v1/me','/api/v1/res','/api/v1/tasks/mine','/api/v1/notifications','/api/platform/badge'].map(path=>api(path))).then(([p,r,t,n,b])=>{if(epoch===generation.current){setProfile(p);setResUnits(r);setTasks(t);setNotes(n);setBadge(b.count);}}).catch(e=>{if(epoch===generation.current)setError(e.message);});
  },[token,api]);
  const filterSignature=JSON.stringify({filters,page,tab});
  useEffect(()=>{if(!profile?.id)return;const timer=setTimeout(()=>void loadRegistry().catch(e=>setError(e.message)),200);return()=>clearTimeout(timer);},[profile?.id,filterSignature,loadRegistry]);
  const selectActTab=(value:string)=>{setActTab(value);sessionStorage.setItem('tp.actTab',value);};
  useEffect(()=>{if(!createOpen)return;const previous=document.activeElement as HTMLElement|null;const root=document.querySelector<HTMLElement>('.create-card');root?.querySelector<HTMLElement>('input')?.focus();const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!busyRef.current)setCreateOpen(false);if(e.key==='Tab'&&root){const all=[...root.querySelectorAll<HTMLElement>('button:not(:disabled),input,select')];if(e.shiftKey&&document.activeElement===all[0]){e.preventDefault();all.at(-1)?.focus();}else if(!e.shiftKey&&document.activeElement===all.at(-1)){e.preventDefault();all[0]?.focus();}}};document.addEventListener('keydown',key);return()=>{document.removeEventListener('keydown',key);previous?.focus();};},[createOpen]);
  const open=async(id:string,nextTab?:string)=>{const epoch=generation.current;const data=await api('/api/v1/acts/'+id);if(epoch===generation.current){selectedId.current=id;setDetail(data);if(nextTab)selectActTab(nextTab);}};
  const action=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();await refresh();if(selectedId.current)await open(selectedId.current);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const view=async(id:string,nextTab?:string)=>{setBusy(true);setError('');try{await open(id,nextTab);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  useEffect(()=>{
    const id=detail?.id;if(!id)return;let active=true;let pending=false;
    const update=async()=>{if(pending||busyRef.current||document.visibilityState!=='visible')return;pending=true;try{const data=await api('/api/v1/acts/'+id);if(active&&selectedId.current===id&&!busyRef.current)setDetail(data);}catch(e){if(active)setError((e as Error).message);}finally{pending=false;}};
    const timer=setInterval(()=>void update(),15000);return()=>{active=false;clearInterval(timer);};
  },[detail?.id,api]);
  const loadFile=useCallback(async(fileId:string)=>{const r=await fetch('/api/v1/files/'+fileId+'/download',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw new Error('Документ недоступен');return r.arrayBuffer();},[token]);
  const closeCard=()=>{selectedId.current=undefined;setDetail(undefined);};
  const navigate=(value:string)=>{closeCard();setTab(value);setPage(1);setCreateOpen(false);};
  const logout=()=>{generation.current++;setToken('');setProfile(undefined);closeCard();};
  const demoLogin=async()=>{setError('');try{const response=await fetch(demoOrigin+'/token',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({subject:demoUser})});if(!response.ok)throw new Error('Тестовый вход недоступен');setToken((await response.json()).token);}catch(e){setError((e as Error).message);}};
  const download=async(fileId:string,version:number)=>{const response=await fetch('/api/v1/files/'+fileId+'/download',{headers:{Authorization:'Bearer '+token}});if(!response.ok)throw new Error('Документ недоступен');const url=URL.createObjectURL(await response.blob());const link=document.createElement('a');link.href=url;link.download='акт-v'+version+'.docx';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  const focusPart=(kind:string,id:string)=>{if(kind==='cycle'){sessionStorage.setItem('tp.matrix.cycle.'+detail!.id,id);selectActTab('matrix');return;}selectActTab('document');setTimeout(()=>document.getElementById((kind==='comment'?'comment-':'version-')+id)?.scrollIntoView({behavior:'smooth',block:'center'}),80);};
  const onRowAction=(kind:string,row:Row)=>{
    if(kind==='approve'||kind==='return'){setDialog({record:row,choice:kind});return;}
    if(kind==='download'){void action(()=>download(row.actions.downloadFileId,row.version));return;}
    void view(row.id,kind==='matrix'?'matrix':kind==='history'?'history':'document').then(()=>{
      if(kind==='comments')setTimeout(()=>document.getElementById('document-comments')?.scrollIntoView({behavior:'smooth',block:'center'}),80);
    });
  };
  const roles:Row[]=profile?.roles??[];const canCreate=roles.some(r=>r.role==='RIRU_HEAD');const presentation=detail?.presentation;
  const unavailable=busy||listBusy;
  return <div className="layout">
    <aside><div className="brand"><span className="brand-mark"><Icon name="branch" size={27}/></span><div>ТП<span>СОГЛАСОВАНИЕ</span></div></div><p className="sub">Сочинский ПЭС</p>
      <nav>{[['registry','Реестр актов','file'],['tasks','Мои задачи','check'],['notifications','Уведомления','comment']].map(([id,label,icon])=><button key={id} className={tab===id?'selected':''} onClick={()=>navigate(id)} aria-label={id==='registry'?label:label+' · '+(id==='tasks'?badge:notes.filter(n=>!n.read_at).length)}><Icon name={icon}/><span>{label}</span>{id!=='registry'&&<b>{id==='tasks'?badge:notes.filter(n=>!n.read_at).length}</b>}</button>)}</nav>
      <div className="sidebar-footer"><small>Единый реестр<br/>технологического присоединения</small><span className="environment-label"><i/>{demoOrigin?'Локальный стенд':'TP Approval'}</span></div>
    </aside>
    <main>
      {demoOrigin&&<div className="demo-banner" role="note"><Icon name="alert" size={14}/>Демонстрационный стенд · Только синтетические данные · Учебный календарь</div>}
      <header className="page-header"><div><p className="eyebrow">СОЧИНСКИЙ ПЭС / ТЕХНОЛОГИЧЕСКОЕ ПРИСОЕДИНЕНИЕ</p><h1>{detail?'Карточка акта':tab==='tasks'?'Мои задачи':tab==='notifications'?'Уведомления':'Реестр актов ТП'}</h1><p className="page-subtitle">{detail?'Документ, маршрут и полная история согласования':'Контроль документов и решений в одном рабочем пространстве'}</p></div>
        {profile&&<div className="identity"><span className="avatar">{profile.name.replace('Демо · ','').slice(0,1)}</span><div><span>{profile.name}</span><small>{roles.map(r=>roleNames[r.role]??r.role).join(' · ')}</small></div><button className="icon-button" aria-label="Выйти" title="Выйти" onClick={logout}><Icon name="logout"/></button><button className="secondary-button refresh-button" disabled={unavailable} onClick={()=>void action(async()=>{})}><Icon name="refresh" size={15}/>Обновить данные</button></div>}
      </header>
      {error&&<div role="alert" className="error"><Icon name="alert"/><span>{error}</span><button className="icon-button" aria-label="Скрыть ошибку" onClick={()=>setError('')}><Icon name="x"/></button></div>}
      {!profile?<section className="card login-card"><span className="login-emblem"><Icon name="file" size={32}/></span><h2>Авторизация</h2>
        {demoOrigin?<form onSubmit={e=>{e.preventDefault();void demoLogin();}}><p>Выберите учебного пользователя для проверки приложения.</p><label>Демонстрационный пользователь<select value={demoUser} onChange={e=>setDemoUser(e.target.value)}>{demoUsers.map(u=><option value={u.subject} key={u.subject}>{u.name}</option>)}</select></label><button className="primary-button" disabled={!demoUsers.length}>Войти в тестовый стенд<Icon name="arrow"/></button></form>
        :<form onSubmit={e=>{e.preventDefault();setToken(String(new FormData(e.currentTarget).get('jwt')));}}><p>Войдите через SUE_system или передайте JWT для локальной проверки.</p><label>JWT Keycloak<input name="jwt" type="password" required autoComplete="off"/></label><button className="primary-button">Войти</button></form>}
      </section>:<>
        {!detail&&tab!=='notifications'&&<><Registry data={registry} filters={filters} onFilters={f=>{setFilters(f);setPage(1);setError('');}} resUnits={resUnits} page={page} onPage={setPage} busy={unavailable} canCreate={canCreate} onCreate={()=>setCreateOpen(true)} onAction={onRowAction} tasksMode={tab==='tasks'}/>
          {createOpen&&canCreate&&<div className="dialog-backdrop"><section className="card create-card" role="dialog" aria-modal="true" aria-label="Создание акта"><div className="section-heading"><div><span className="eyebrow">НОВЫЙ ДОКУМЕНТ</span><h2>Реквизиты нового акта</h2></div><button className="icon-button" aria-label="Закрыть создание акта" onClick={()=>setCreateOpen(false)}><Icon name="x"/></button></div><form onSubmit={e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.currentTarget));void action(async()=>{const a=await api('/api/v1/acts',data);setCreateOpen(false);await open(a.id,'document');});}}><div className="fields"><label>РЭС<select name="resId">{resUnits.filter(r=>roles.some(role=>role.role==='RIRU_HEAD'&&role.resId===r.id)).map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>{[['contractNumber','Номер договора','text'],['contractDate','Дата договора','date'],['actNumber','Номер акта','text'],['applicant','Заявитель','text'],['address','Адрес объекта','text']].map(([n,label,type])=><label key={n}>{label}<input name={n} type={type} required maxLength={2000}/></label>)}</div><div className="dialog-actions"><button type="button" className="secondary-button" onClick={()=>setCreateOpen(false)}>Отмена</button><button className="primary-button" disabled={busy}><Icon name="plus"/>Создать карточку</button></div></form></section></div>}
        </>}
        {!detail&&tab==='notifications'&&<section className="card notifications-card"><div className="section-heading"><h2>Персональные уведомления</h2><span className="count-label">{notes.filter(n=>!n.read_at).length} непрочитанных</span></div>{!notes.length&&<p className="helper-text">Уведомлений пока нет.</p>}{notes.map(n=><div className={'note notification '+(n.read_at?'':'unread')} key={n.id}><span className="notification-icon"><Icon name={n.type==='APPROVED'?'check':n.type==='RETURNED'?'return':'comment'}/></span><div><b>{({TASK_ASSIGNED:'Поступил документ на согласование',RETURNED:'Документ возвращён на доработку',APPROVED:'Согласование завершено',WARNING:'Приближается срок',OVERDUE:'Нарушен срок',ESCALATION:'Эскалация просрочки'} as Record<string,string>)[n.type]??n.type} · {dateTime(n.created_at)}</b></div><button className="secondary-button" disabled={busy} onClick={()=>void action(async()=>{await api('/api/v1/notifications/'+n.id+'/read',{});await open(n.act_id,'document');})}>{n.read_at?'Открыть':'Прочитать'}</button></div>)}</section>}
        {detail&&presentation&&<section className="act-detail" aria-label="Карточка акта">
          <div className="card-breadcrumb"><button className="text-button" onClick={closeCard}><Icon name="back" size={16}/>Вернуться к реестру</button><span>/</span><span>{detail.act_number}</span></div>
          <section className="card act-summary"><div className="summary-main"><span className="document-emblem"><Icon name="file" size={30}/></span><div><span className="eyebrow">АКТ ТЕХНОЛОГИЧЕСКОГО ПРИСОЕДИНЕНИЯ</span><h2>Акт {detail.act_number}</h2><p>Договор <b>{detail.contract_number}</b> от {shortDate(detail.contract_date)}</p></div><StatusBadge status={presentation.status}/><div className="summary-actions"><IconButton icon="print" label="Печать DOCX" disabled reason="Генератор чистовой и служебной печати ещё не проверен" onClick={()=>{}}/><IconButton icon="download" label="Скачать Word" disabled={!presentation.actions.downloadFileId||busy} reason="Документ Word ещё не загружен" onClick={()=>void action(()=>download(presentation.actions.downloadFileId,presentation.version))}/><button className="icon-button" aria-label="Закрыть карточку" onClick={closeCard}><Icon name="x"/></button></div></div>
            <div className="summary-data"><div><small>Заявитель</small><strong>{detail.applicant}</strong><span>{detail.address}</span></div><div><small>Подразделение</small><strong>{presentation.res_name}</strong><span className="status" data-testid="act-current-stage">{presentation.status==='REVOKED'?'Публикация отозвана':stageNames[detail.state]}</span></div><div><small>Версия / цикл</small><strong>Word v{presentation.version??'—'} · Цикл {presentation.cycle??'—'}</strong><span>Замечаний в истории: {presentation.commentCount}</span></div><div><small>Срок согласования, МСК</small><strong className={presentation.overdue?'deadline-danger':''}>{dateTime(presentation.due_at)}</strong><span>{presentation.overdue?'Просрочено':presentation.due_at?'По действующей задаче':'Нет открытых задач'}</span></div></div>
          </section>
          <section className="card route-card"><div className="section-heading"><div><span className="eyebrow">ХОД СОГЛАСОВАНИЯ</span><h3>Маршрут документа</h3></div><button className="text-button" onClick={()=>selectActTab('matrix')}><Icon name="matrix" size={16}/>Подробная матрица</button></div><RouteFlow route={presentation.route}/></section>
          <div role="tablist" aria-label="Вкладки карточки акта" className="act-tabs">
            <button type="button" role="tab" aria-selected={actTab==='word'} aria-controls="act-word-panel" id="act-word-tab" onClick={()=>selectActTab('word')}><Icon name="file" size={16}/>Документ</button>
            <button type="button" role="tab" aria-selected={actTab==='document'} aria-controls="act-document-panel" id="act-document-tab" onClick={()=>{selectActTab('document');void view(detail.id);}}><Icon name="file" size={16}/>Документ и замечания</button>
            <button type="button" role="tab" aria-selected={actTab==='matrix'} aria-controls="act-matrix-panel" id="act-matrix-tab" onClick={()=>selectActTab('matrix')}><Icon name="matrix" size={16}/>Матрица согласования</button>
            <button type="button" role="tab" aria-selected={actTab==='history'} aria-controls="act-history-panel" id="act-history-tab" onClick={()=>selectActTab('history')}><Icon name="history" size={16}/>История</button>
          </div>
          {actTab==='matrix'&&<section className="card" role="tabpanel" id="act-matrix-panel" aria-labelledby="act-matrix-tab"><ApprovalMatrix key={detail.id} actId={detail.id} api={api}/></section>}
          {actTab==='word'&&<section role="tabpanel" id="act-word-panel" aria-labelledby="act-word-tab"><WordWorkspace key={detail.id} detail={detail} profile={profile!} tasks={tasks} api={api} loadFile={loadFile} action={action} busy={busy} onDownload={download}/></section>}
          <div role="tabpanel" id="act-document-panel" aria-labelledby="act-document-tab" hidden={actTab!=='document'}><div className="card-workspace"><ActDocument key={detail.id} detail={detail} profile={profile} tasks={tasks} api={api} action={action} busy={busy} onDownload={download}/><Timeline events={detail.timeline.events} onLink={focusPart} compact/></div></div>
          {actTab==='history'&&<section className="card" role="tabpanel" id="act-history-panel" aria-labelledby="act-history-tab"><Timeline events={detail.timeline.events} onLink={focusPart}/></section>}
        </section>}
      </>}
      <footer>TP Approval · Электронное согласование не является электронной подписью.</footer>
      {dialog&&<DecisionDialog record={dialog.record} choice={dialog.choice} busy={busy} onClose={()=>setDialog(undefined)} onSubmit={reason=>void action(async()=>{await api('/api/v1/tasks/'+dialog.record.actions.taskId+'/decision',{decision:dialog.choice==='approve'?'APPROVE':'RETURN',reason});setDialog(undefined);})}/>}
    </main>
  </div>;
}
