import {useEffect,useState} from 'react';
import {dateTime} from './Ui.js';
import './accounts.css';
type Row=Record<string,any>;
type Api=(p:string,b?:object|FormData)=>Promise<any>;
type Tab='health'|'documents'|'backups'|'errors';
const tabs:[Tab,string][]=[['health','Состояние'],['documents','Документы'],['backups','Резервные копии'],['errors','Журнал ошибок']];
const bytes=(n?:number|null)=>n==null?'—':n<1024?`${n} Б`:n<1048576?`${(n/1024).toFixed(1)} КБ`:n<1073741824?`${(n/1048576).toFixed(1)} МБ`:`${(n/1073741824).toFixed(2)} ГБ`;
const levelName:Record<string,string>={error:'Ошибка',warn:'Внимание',info:'Для сведения'};
const stateName:Record<string,string>={DRAFT:'Черновик',RIRU_REVIEW:'У начальника РИРУ',RES_REVIEW:'У начальника РЭС',CENTRAL_REVIEW:'У служб',RETURNED:'Возвращён',REVISING:'Пересмотр',APPROVED:'Согласован'};
const counts:[string,string][]=[['documents','Документы'],['contracts','Договоры'],['versions','Версии'],['technicalConditions','Редакции ТУ'],['files','Файлы'],['cycles','Циклы'],['openTasks','Открытые задачи'],['remarks','Замечания'],['users','Пользователи'],['auditEvents','Записи журнала']];

/** Подтверждение опасного действия вводом слова: случайный клик ничего не удалит. */
function Confirm({word,label,busy,onConfirm,onCancel}:{word:string;label:string;busy:boolean;onConfirm:()=>void;onCancel:()=>void}){
 const [text,setText]=useState('');
 return <form className="service-confirm" onSubmit={e=>{e.preventDefault();if(text.trim().toUpperCase()===word)onConfirm();}}>
  <p>{label}</p>
  <label>Для подтверждения введите <b>{word}</b><input autoFocus value={text} onChange={e=>setText(e.target.value)} aria-label={`Подтверждение: ${word}`}/></label>
  <div className="card-actions"><button className="danger-button" disabled={busy||text.trim().toUpperCase()!==word}>Подтвердить</button><button type="button" onClick={onCancel}>Отмена</button></div>
 </form>;
}

/**
 * Сервисное меню администратора системы: состояние базы и хранилища, проверки и очистка, удаление документов насовсем
 * (целиком, редакция ТУ, неотправленная версия), резервные копии «база + файлы» с восстановлением, журнал ошибок сервера.
 */
export default function ServiceMenu({api,downloadPath,onRestored}:{api:Api;downloadPath:(path:string,name:string)=>Promise<void>;onRestored:()=>void}){
 const [tab,setTab]=useState<Tab>('health'),[health,setHealth]=useState<Row>(),[docs,setDocs]=useState<Row[]>(),[search,setSearch]=useState(''),
  [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirm,setConfirm]=useState<{word:string;label:string;run:()=>Promise<unknown>}>(),
  [upload,setUpload]=useState<File>();
 const run=async(fn:()=>Promise<unknown>,done?:string)=>{setBusy(true);setError('');setNotice('');try{await fn();if(done)setNotice(done);}catch(e){setError((e as Error).message);}finally{setBusy(false);setConfirm(undefined);}};
 const loadHealth=()=>run(async()=>setHealth(await api('/api/v1/admin/service/health')));
 const loadDocs=(q=search)=>run(async()=>setDocs(await api('/api/v1/admin/service/documents?q='+encodeURIComponent(q))));
 useEffect(()=>{void loadHealth();},[]);
 useEffect(()=>{if(tab==='documents'&&!docs)void loadDocs();},[tab]);
 const purge=(kind:'document'|'tu'|'version',id:string,label:string)=>setConfirm({word:'УДАЛИТЬ',label,run:async()=>{
  await api('/api/v1/admin/service/purge',{kind,id,confirm:'УДАЛИТЬ'});setDocs(await api('/api/v1/admin/service/documents?q='+encodeURIComponent(search)));setHealth(await api('/api/v1/admin/service/health'));}});
 const restore=(source:{name?:string;file?:File},label:string)=>setConfirm({word:'ВОССТАНОВИТЬ',label,run:async()=>{
  let body:object|FormData={name:source.name,confirm:'ВОССТАНОВИТЬ'};
  if(source.file){const form=new FormData();form.append('confirm','ВОССТАНОВИТЬ');form.append('file',source.file);body=form;}
  await api('/api/v1/admin/service/restore',body);onRestored();}});
 const issues:Row[]=health?.issues??[];const problems=issues.filter(i=>i.count>0&&i.level!=='info');
 return <section className="card service-menu" aria-label="Сервисное меню">
  <div className="queue-switch" role="group" aria-label="Раздел сервиса">{tabs.map(([key,label])=><button key={key} type="button" aria-pressed={tab===key} onClick={()=>{setTab(key);setConfirm(undefined);}}>{label}{key==='health'&&problems.length>0?<b className="tab-count" data-tab="corrections">{problems.length}</b>:null}</button>)}</div>
  {error&&<p role="alert" className="service-error">{error}</p>}
  {notice&&<p role="status" className="service-notice">{notice}</p>}
  {confirm&&<Confirm word={confirm.word} label={confirm.label} busy={busy} onCancel={()=>setConfirm(undefined)} onConfirm={()=>void run(confirm.run,confirm.word==='УДАЛИТЬ'?'Удалено.':undefined)}/>}

  {tab==='health'&&<div className="service-health">
   <div className="service-head"><p className="helper-text">{health?`Проверено ${dateTime(health.checkedAt)} · PostgreSQL ${health.postgres} · сервер работает ${Math.floor(health.uptimeSeconds/3600)} ч ${Math.floor(health.uptimeSeconds%3600/60)} мин`:'Проверяем…'}</p>
    <div className="card-actions"><button type="button" disabled={busy} onClick={()=>void loadHealth()}>Обновить</button>
     <button type="button" className="primary-button" disabled={busy} onClick={()=>void run(async()=>{const r=await api('/api/v1/admin/service/cleanup',{});setHealth(await api('/api/v1/admin/service/health'));setNotice(`Очистка: файлов удалено ${r.files+r.orphans}, сеансов ${r.sessions}.`);})}>Удалить мусор</button></div></div>
   {health&&<>
    <div className="service-tiles">
     <div><span>База данных</span><b>{bytes(health.dbBytes)}</b></div>
     <div><span>Файлы документов</span><b>{bytes(health.storage.bytes)}</b><small>{health.storage.files} шт.</small></div>
     <div><span>Свободно на диске</span><b>{bytes(health.storage.freeBytes)}</b><small>из {bytes(health.storage.totalBytes)}</small></div>
     <div className={health.antivirus==='работает'?'ok':'bad'}><span>Антивирус</span><b>{health.antivirus}</b></div>
     <div><span>Резервные копии</span><b>{health.backups.length}</b><small>{health.backups[0]?`последняя ${dateTime(health.backups[0].createdAt)}`:'ещё не делались'}</small></div>
    </div>
    <h3>Проверки</h3>
    <ul className="service-issues">{issues.map(i=><li key={i.code} className={i.count?`level-${i.level}`:'level-ok'}>
     <div><b>{i.count?'⚠':'✓'} {i.label}</b><span>{i.count?`${levelName[i.level]}: ${i.count}`:'в порядке'}</span></div>
     {i.count>0&&i.items?.length>0&&<details><summary>Показать</summary><ul>{i.items.map((x:Row,n:number)=><li key={n}><code>{x.id??''}</code> {[x.kind,x.act,x.role,x.state,x.number,x.size!=null?bytes(x.size):null,x.created_at?dateTime(x.created_at):null].filter(Boolean).join(' · ')}</li>)}</ul></details>}
    </li>)}</ul>
    <p className="helper-text">«Удалить мусор» убирает непривязанные файлы старше суток, файлы на диске без записи в базе, записи о пропавших файлах (если на них ничего не ссылается) и истёкшие сеансы. Документы и история не затрагиваются.</p>
    <h3>Записи в базе</h3>
    <dl className="service-counts">{counts.map(([k,l])=><div key={k}><dt>{l}</dt><dd>{health.counts[k]}</dd></div>)}</dl>
    <details className="service-migrations"><summary>Миграции базы: {health.migrations?.length}</summary><p>{health.migrations?.join(' · ')}</p></details>
   </>}
  </div>}

  {tab==='documents'&&<div className="service-docs">
   <form className="service-search" onSubmit={e=>{e.preventDefault();void loadDocs();}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Номер договора или документа" aria-label="Поиск документа"/><button disabled={busy}>Найти</button></form>
   <p className="helper-text">Удаление насовсем: документ стирается вместе с версиями, циклами, замечаниями, сверками и файлами; в журнале остаётся запись, кто и когда удалил. Отправленную на согласование версию отдельно удалить нельзя — только документ целиком.</p>
   {docs&&!docs.length&&<p>Ничего не найдено.</p>}
   <ul className="service-doc-list">{docs?.map(d=><li key={d.id}>
    <div className="service-doc-head"><div><b>{d.act_type==='AVTU'?'АВТУ':'Акт ТП'} · договор {d.contract_number}</b><small>{d.res} · {d.author} · {stateName[d.state]??d.state} · создан {dateTime(d.created_at)} · циклов: {d.cycles}</small></div>
     <button type="button" className="danger-button" disabled={busy} onClick={()=>purge('document',d.id,`Удалить насовсем документ «${d.act_type==='AVTU'?'АВТУ':'Акт ТП'}» по договору ${d.contract_number} со всеми версиями, циклами, замечаниями и файлами?`)}>Удалить документ</button></div>
    <div className="service-parts">
     {d.versions.map((v:Row)=><span key={v.id} className="service-part">Версия {v.number}{v.in_cycle?<small> · в цикле</small>:<button type="button" className="text-button" disabled={busy} onClick={()=>purge('version',v.id,`Удалить версию ${v.number} документа по договору ${d.contract_number}?`)}>удалить</button>}</span>)}
     {d.technical_conditions.map((t:Row)=><span key={t.id} className="service-part">ТУ ред. {t.number}{t.in_cycle?<small> · в цикле</small>:<button type="button" className="text-button" disabled={busy} onClick={()=>purge('tu',t.id,`Удалить редакцию ТУ ${t.number} по договору ${d.contract_number}?`)}>удалить</button>}</span>)}
    </div>
   </li>)}</ul>
  </div>}

  {tab==='backups'&&<div className="service-backups">
   <div className="service-head"><p className="helper-text">Копия — один архив: база целиком и все файлы документов. На сервере хранятся последние 10 копий; скачивайте важные к себе.</p>
    <button type="button" className="primary-button" disabled={busy} onClick={()=>void run(async()=>{const b=await api('/api/v1/admin/service/backups',{});setHealth(await api('/api/v1/admin/service/health'));setNotice(`Копия создана: ${b.name} (${bytes(b.size)}, документов ${b.documents}, файлов ${b.files}).`);})}>Создать копию</button></div>
   <table className="reference-table"><thead><tr><th>Копия</th><th>Размер</th><th>Создана</th><th/></tr></thead><tbody>
    {(health?.backups??[]).map((b:Row)=><tr key={b.name}><td>{b.name}{b.name.includes('-before')&&<small> · автоматически перед восстановлением</small>}</td><td>{bytes(b.size)}</td><td>{dateTime(b.createdAt)}</td>
     <td className="card-row-actions"><button type="button" disabled={busy} onClick={()=>void run(()=>downloadPath(`/api/v1/admin/service/backups/${b.name}/download`,b.name))}>Скачать</button>
      <button type="button" disabled={busy} onClick={()=>restore({name:b.name},`Восстановить копию ${b.name}? Все текущие данные и файлы будут заменены содержимым копии, все пользователи войдут заново. Перед восстановлением текущее состояние будет сохранено отдельной копией.`)}>Восстановить</button>
      <button type="button" className="text-button" disabled={busy} onClick={()=>void run(async()=>{await api(`/api/v1/admin/service/backups/${b.name}/delete`,{});setHealth(await api('/api/v1/admin/service/health'));})}>удалить</button></td></tr>)}
   </tbody></table>
   {!health?.backups?.length&&<p>Копий пока нет.</p>}
   <h3>Восстановить из файла</h3>
   <div className="upload-field upload-pill"><span className="upload-pill-title">{upload?upload.name:'Архив копии (.zip), скачанный ранее'}</span>
    <label className={`secondary-button file-button${busy?' is-disabled':''}`}>Выбрать архив<input className="sr-only" type="file" accept=".zip" aria-label="Архив резервной копии" disabled={busy} onChange={e=>setUpload(e.target.files?.[0])}/></label>
    {upload&&<button type="button" className="danger-button" disabled={busy} onClick={()=>restore({file:upload},`Восстановить из файла ${upload.name}? Все текущие данные и файлы будут заменены, все пользователи войдут заново. Перед восстановлением текущее состояние будет сохранено.`)}>Восстановить</button>}</div>
   <p className="helper-text">Восстановить можно только копию той же версии программы (тот же набор миграций базы).</p>
  </div>}

  {tab==='errors'&&<div className="service-errors">
   <div className="service-head"><p className="helper-text">Ошибки сервера с момента последнего запуска (до 50 последних). Код запроса совпадает с тем, что видит пользователь в сообщении об ошибке.</p><button type="button" disabled={busy} onClick={()=>void loadHealth()}>Обновить</button></div>
   {!health?.errors?.length?<p>Ошибок нет.</p>:<table className="reference-table"><thead><tr><th>Время</th><th>Запрос</th><th>Ошибка</th><th>Код запроса</th></tr></thead><tbody>
    {health.errors.map((e:Row,i:number)=><tr key={i}><td>{dateTime(e.at)}</td><td>{e.method} {e.path}</td><td>{e.status} · {e.code}{e.detail?` (${e.detail})`:''}</td><td><code>{e.requestId}</code></td></tr>)}
   </tbody></table>}
  </div>}
 </section>;
}
