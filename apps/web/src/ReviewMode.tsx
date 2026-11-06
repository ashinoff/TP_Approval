import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import DocumentViewer,{type SelectionAnchor,type DocumentViewerHandle} from './DocumentViewer.js';
import {Icon,StatusBadge,dateTime,roleNames} from './Ui.js';
import TuPreflight from './TuPreflight.js';
import DecisionDialog from './DecisionDialog.js';
import {SendButton,checkFor,isPreparing,openBlockers} from './ActDocument.js';
import {initialVersion,remarkBlockReason,type Section} from './workplace.js';
import {RossetiLoader} from './Brand.js';
import {extraNames} from './ContractDocuments.js';
import {checkMarks,changedMarks,pairedBlock,findingTone} from './review-marks.js';
import './review.css';

type Row=Record<string,any>;
type Api=(p:string,b?:object|FormData)=>Promise<any>;
type Loaded={model:Row;bytes:ArrayBuffer};
const states:Record<string,string>={OPEN:'Открыто',REPORTED_FIXED:'Исправлено, ждёт проверки',VERIFIED:'Устранено',REOPENED:'Исправление отклонено'};
const BLOCKING=['DIFFERENCE','MANUAL_REVIEW','UNKNOWN'];

/** Загрузка предпросмотра документа: версия акта либо редакция ТУ. Последний запрос побеждает. */
function usePreview(key:string|undefined,fetcher:(key:string)=>Promise<Loaded>){
 const [state,setState]=useState<{key?:string;data?:Loaded;error?:string}>({});
 useEffect(()=>{if(!key){setState({});return;}let active=true;setState({key});fetcher(key).then(data=>{if(active)setState({key,data});}).catch(e=>{if(active)setState({key,error:(e as Error).message});});return()=>{active=false;};},[key]);
 return state.key===key?state:{key};
}

/**
 * Режим проверки документов: слева проверяемый акт/АВТУ (замечания только к нему), справа ТУ или другая
 * версия — только для просмотра; сбоку замечания и автосверка с ТУ. Инженер до отправки только сверяет,
 * согласующий оставляет замечания и принимает решение.
 */
export default function ReviewMode({detail,profile,tasks,api,loadFile,action,busy,section,startVersion,onClose}:{detail:Row;profile:Row;tasks:Row[];api:Api;loadFile:(id:string)=>Promise<ArrayBuffer>;action:(fn:()=>Promise<unknown>)=>Promise<void>;busy:boolean;section:Section;startVersion?:string;onClose:()=>void}){
 const root=useRef<HTMLDivElement>(null),left=useRef<DocumentViewerHandle>(null),right=useRef<DocumentViewerHandle>(null);
 const [versionId,setVersionId]=useState<string>(()=>startVersion??initialVersion(detail,tasks,section));
 const version=detail.versions.find((v:Row)=>v.id===versionId);
 const newest=detail.versions.at(-1);
 const cycle=detail.cycles.find((c:Row)=>c.version_id===versionId);
 const task=tasks.find(t=>t.act_id===detail.id&&t.cycle_id===cycle?.id&&t.role!=='RIRU_ENGINEER');
 const effective=!!task&&detail.author_id!==profile.id&&version?.created_by!==profile.id;
 const preparing=isPreparing(detail)&&versionId===newest?.id;
 const tus:Row[]=detail.contractDocuments?.technicalConditions??[];
 const extras:Row[]=detail.contractDocuments?.extraDocuments??[];
 const checkTuId=cycle?.technical_conditions_id??detail.technical_conditions_id;
 const check=checkFor(detail,versionId,checkTuId);

 // Справа по умолчанию — ТУ, по которым идёт сверка; без ТУ — предыдущая версия акта.
 const defaultSource=()=>{const tu=tus.find(t=>t.id===checkTuId)??tus.at(-1);if(tu)return 'tu:'+tu.id;const prev=detail.versions.filter((v:Row)=>v.id!==versionId).at(-1);return prev?'v:'+prev.id:undefined;};
 const [source,setSource]=useState<string|undefined>(defaultSource);
 const [sync,setSync]=useState(false),[panel,setPanel]=useState(true),[tab,setTab]=useState<'remarks'|'check'>(preparing?'check':'remarks'),[noteTab,setNoteTab]=useState<'open'|'resolved'>('open');
 const [selection,setSelection]=useState<SelectionAnchor|null>(null),[form,setForm]=useState<SelectionAnchor>(),[focused,setFocused]=useState<string>(),[focusRequest,setFocusRequest]=useState(0);
 const [categories,setCategories]=useState<Row[]>([]),[choice,setChoice]=useState<'approve'|'return'>(),[error,setError]=useState('');
 const explanations=useRef<Record<string,string>>({});

 const fetchVersion=useCallback(async(id:string)=>{const v=detail.versions.find((x:Row)=>x.id===id)!;const [model,bytes]=await Promise.all([api(`/api/v1/acts/${detail.id}/versions/${id}/preview`),loadFile(v.file_id)]);return {model,bytes};},[detail.id,detail.versions,api,loadFile]);
 const fetchSource=useCallback(async(key:string)=>{
  const [kind,id]=key.split(':');
  if(kind==='v')return fetchVersion(id);
  if(kind==='x'){const x=extras.find(e=>e.id===id)!;const [model,bytes]=await Promise.all([api(`/api/v1/acts/${detail.id}/extra/${id}/preview`),loadFile(x.file_id)]);return {model,bytes};}
  const tu=tus.find(t=>t.id===id)!;const [model,bytes]=await Promise.all([api(`/api/v1/acts/${detail.id}/technical-conditions/${id}/preview`),loadFile(tu.file_id)]);return {model,bytes};
 },[fetchVersion,tus,extras,detail.id,api,loadFile]);
 // Справа не может быть та же версия, что слева.
 useEffect(()=>{if(source==='v:'+versionId)setSource(defaultSource());},[versionId]);
 const leftDoc=usePreview(version?versionId:undefined,fetchVersion);
 const rightDoc=usePreview(source,fetchSource);
 useEffect(()=>{api('/api/v1/error-categories').then(setCategories).catch(()=>{});},[api]);

 // Цветная разметка: со сверкой ТУ — зелёный/красный/жёлтый в обоих окнах; с другой версией акта — синие изменённые абзацы.
 const rightTuId=source?.startsWith('tu:')?source.slice(3):undefined;
 const rightVersion=source?.startsWith('v:')?detail.versions.find((v:Row)=>v.id===source.slice(2)):undefined;
 const pairedTu=!!check&&rightTuId===check.technical_conditions_id;
 const [showMarks,setShowMarks]=useState(true);
 const flagged=useMemo(()=>(check?.findings??[]).filter((f:Row)=>BLOCKING.includes(f.status)&&!check?.confirmations?.some((c:Row)=>c.field===f.field)),[check]);
 const leftMarks=useMemo(()=>!showMarks?[]:rightVersion?changedMarks(leftDoc.data?.model,rightDoc.data?.model,`версии ${rightVersion.number}`):checkMarks(check,'act'),[showMarks,rightVersion,leftDoc.data,rightDoc.data,check]);
 const rightMarks=useMemo(()=>!showMarks?[]:rightVersion?changedMarks(rightDoc.data?.model,leftDoc.data?.model,`версии ${version?.number}`):pairedTu?checkMarks(check,'tu'):[],[showMarks,rightVersion,leftDoc.data,rightDoc.data,check,pairedTu,version]);
 const [nav,setNav]=useState(-1);
 const goFlag=(step:number)=>{if(!flagged.length)return;const i=(nav+step+flagged.length)%flagged.length;setNav(i);const f=flagged[i];const tone=findingTone(check,f);if(f.act?.[0]?.blockId)left.current?.scrollToBlock(f.act[0].blockId,{text:f.act[0].shown??f.act[0].value,tone});if(pairedTu&&f.tu?.[0]?.blockId)right.current?.scrollToBlock(f.tu[0].blockId,{text:f.tu[0].shown??f.tu[0].value,tone});};
 const blocked=remarkBlockReason(detail,tasks,profile,versionId);
 const addRemark=()=>{if(blocked){setError(blocked);return;}if(selection){setForm(selection);setPanel(true);setTab('remarks');}else setError('Выделите текст внутри одного абзаца, затем нажмите «＋ Замечание».');};

 const notes:Row[]=detail.comments;
 const statusOf=(c:Row)=>c.events.filter((e:Row)=>e.version_id===versionId).at(-1)?.type??c.events.at(-1)?.type??'OPEN';
 const openNotes=notes.filter(c=>statusOf(c)!=='VERIFIED'),resolvedNotes=notes.filter(c=>statusOf(c)==='VERIFIED');
 const versionNotes=useMemo(()=>notes.filter(c=>c.version_id===versionId),[notes,versionId]);
 const goToNote=(c:Row)=>{if(c.version_id!==versionId){setVersionId(c.version_id);}setFocused(c.id);setFocusRequest(n=>n+1);};
 const jump=(blockId:string,side:'act'|'tu',text?:string,tone?:'ok'|'bad'|'warn')=>{if(side==='act')left.current?.scrollToBlock(blockId,{text,tone});else if(pairedTu)right.current?.scrollToBlock(blockId,{text,tone});};
 // Клик по отмеченному реквизиту прокручивает второе окно к парному пункту.
 const pairFromLeft=(blockId:string)=>{const b=pairedTu&&pairedBlock(check,blockId,'act');if(!b)return;left.current?.pointAt(blockId,b.own);right.current?.scrollToBlock(b.blockId,b);};
 const pairFromRight=(blockId:string)=>{const b=pairedTu&&pairedBlock(check,blockId,'tu');if(!b)return;right.current?.pointAt(blockId,b.own);left.current?.scrollToBlock(b.blockId,b);};
 const runCheck=()=>void action(()=>api(`/api/v1/acts/${detail.id}/check-tu`,{versionId:newest.id,expectedRevision:detail.revision}));
 const confirm=(field:string,comment:string)=>void action(()=>api(`/api/v1/acts/${detail.id}/check-tu/${check!.id}/confirm`,{field,comment,expectedRevision:detail.revision}));
 const event=async(c:Row,type:string)=>{const explanation=explanations.current[c.id]?.trim();if(!explanation){setError('Опишите результат проверки исправления.');return;}setError('');await action(async()=>{await api(`/api/v1/comments/${c.id}/events`,{versionId,type,explanation});explanations.current[c.id]='';});};
 const close=()=>{if(form&&!window.confirm('Закрыть режим проверки? Несохранённое замечание будет потеряно.'))return;if(document.fullscreenElement)void document.exitFullscreen();onClose();};
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'&&!choice&&!form&&!document.fullscreenElement)onClose();};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[choice,form,onClose]);
 useEffect(()=>{document.body.classList.add('review-open');return()=>document.body.classList.remove('review-open');},[]);
 const fullscreen=()=>{if(document.fullscreenElement)void document.exitFullscreen();else void root.current?.requestFullscreen?.();};

 const kind=detail.act_type==='AVTU'?'АВТУ':'Акт ТП';
 const sourceLabel=(t:Row)=>`Технические условия · ред. ${t.number}${t.document_number?` № ${t.document_number}`:''}${t.id===checkTuId?' · по ним сверка':''}`;
 const ownRemark=!!task&&notes.some(c=>c.task_id===task.id&&c.version_id===versionId);
 const viewerTitle=(d:typeof leftDoc,label:string)=>d.error?<p role="alert" className="review-error">{d.error}</p>:<RossetiLoader label={`Загрузка: ${label}…`}/>;

 // Портал в body: фиксированное окно не зависит от трансформаций и прокрутки страницы.
 return createPortal(<div ref={root} className={`review-mode${panel?'':' panel-hidden'}`} role="dialog" aria-modal="true" aria-label="Режим проверки документов">
  <header className="review-top">
   <button type="button" className="review-back" aria-label="Закрыть режим проверки" onClick={close}><Icon name="return"/></button>
   <h2>Режим проверки документов</h2>
   <span className="review-contract">Договор {detail.contract_number}</span>
   <StatusBadge status={detail.presentation.status}/>
   <span className="review-spacer"/>
   <label className="review-switch"><input type="checkbox" checked={showMarks} onChange={e=>setShowMarks(e.target.checked)}/><span aria-hidden="true"/>Подсветка</label>
   <label className="review-switch"><input type="checkbox" checked={sync} onChange={e=>setSync(e.target.checked)}/><span aria-hidden="true"/>Синхронная прокрутка</label>
   <button type="button" className="review-toggle" aria-pressed={panel} onClick={()=>setPanel(v=>!v)}><Icon name="file"/>Замечания · {notes.length}</button>
   <button type="button" className="review-icon" aria-label="Во весь экран" title="Во весь экран" onClick={fullscreen}>⛶</button>
  </header>
  {error&&<p role="alert" className="review-error top">{error}<button type="button" aria-label="Скрыть" onClick={()=>setError('')}>×</button></p>}
  <div className="review-body">
   <section className="review-pane review-pane-main" aria-label="Проверяемый документ">
    <div className="review-pane-head"><Icon name="file"/>
     <select aria-label="Версия проверяемого документа" value={versionId} onChange={e=>{if(form&&!window.confirm('Переключить версию? Несохранённое замечание будет потеряно.'))return;setForm(undefined);setSelection(null);setVersionId(e.target.value);}}>
      {detail.versions.map((v:Row)=><option key={v.id} value={v.id}>{kind} · версия {v.number}{v.id===newest?.id?' · последняя':''}</option>)}
     </select>
    </div>
    {showMarks&&(leftMarks.length>0)&&<div className="mark-legend review-legend">{rightVersion?<span><i className="changed"/>отличается от версии {rightVersion.number}</span>:<><span><i className="ok"/>совпадает с ТУ</span><span><i className="bad"/>расхождение</span><span><i className="warn"/>проверить вручную</span>{pairedTu&&<span className="legend-hint">клик по пункту — парный пункт в ТУ</span>}</>}</div>}
    {leftDoc.data?<DocumentViewer key={versionId} ref={left} bytes={leftDoc.data.bytes} model={leftDoc.data.model} comments={versionNotes} onSelection={setSelection} onComment={id=>{setFocused(id);setPanel(true);setTab('remarks');}} focusedId={focused} focusRequest={focusRequest} onScrollRatio={sync?r=>right.current?.scrollToRatio(r):undefined} marks={leftMarks} onMarkClick={pairedTu?pairFromLeft:undefined} onAddRemark={addRemark} remarkBlocked={blocked}/>:viewerTitle(leftDoc,kind)}
   </section>
   <section className="review-pane" aria-label="Документ для сравнения">
    <div className="review-pane-head"><Icon name="file"/>
     <select aria-label="Документ для сравнения" value={source??''} onChange={e=>setSource(e.target.value||undefined)}>
      {!source&&<option value="">Нет документа для сравнения</option>}
      {tus.length>0&&<optgroup label="Технические условия">{[...tus].reverse().map(t=><option key={t.id} value={'tu:'+t.id}>{sourceLabel(t)}</option>)}</optgroup>}
      {extras.length>0&&<optgroup label="Дополнительные документы">{extras.map(x=><option key={x.id} value={'x:'+x.id}>{extraNames[x.kind]??'Документ'}{x.number>1?` (${x.number})`:''}</option>)}</optgroup>}
      {detail.versions.length>1&&<optgroup label={`Другие версии (${kind})`}>{detail.versions.filter((v:Row)=>v.id!==versionId).map((v:Row)=><option key={v.id} value={'v:'+v.id}>{kind} · версия {v.number}</option>)}</optgroup>}
     </select>
     <span className="review-readonly">только просмотр</span>
    </div>
    {!source?<div className="review-empty">Загрузите ТУ в пакет документов, чтобы сверять акт с ними.</div>:rightDoc.data?<DocumentViewer key={source} ref={right} bytes={rightDoc.data.bytes} model={rightDoc.data.model} comments={[]} onSelection={()=>{}} onComment={()=>{}} onScrollRatio={sync?r=>left.current?.scrollToRatio(r):undefined} marks={rightMarks} onMarkClick={pairedTu?pairFromRight:undefined}/>:viewerTitle(rightDoc,'документ')}
   </section>
   {!panel&&<button type="button" className="review-edge" onClick={()=>setPanel(true)} aria-label={`Показать замечания: ${notes.length}`}><span>Замечания · {notes.length}</span></button>}
   {panel&&<aside className="review-side" aria-label="Замечания и сверка">
    <div className="review-side-head">
     <div className="review-tabs" role="tablist">
      <button role="tab" aria-selected={tab==='remarks'} onClick={()=>setTab('remarks')}>Замечания <b>{notes.length}</b></button>
      {detail.tu_check_required!==false&&<button role="tab" aria-selected={tab==='check'} onClick={()=>setTab('check')}>Сверка с ТУ{check?<b className={openBlockers(check).length?'warn':'ok'}>{openBlockers(check).length||'✓'}</b>:null}</button>}
     </div>
     <button type="button" className="review-icon" aria-label="Скрыть панель" onClick={()=>setPanel(false)}>»</button>
    </div>
    {tab==='check'?<div className="review-side-scroll">
     {flagged.length>0&&<div className="review-nav"><button type="button" aria-label="Предыдущее расхождение" onClick={()=>goFlag(-1)}>‹</button><span>{nav>=0?`${nav+1} из ${flagged.length}`:`Требуют внимания: ${flagged.length}`}</span><button type="button" aria-label="Следующее расхождение" onClick={()=>goFlag(1)}>›</button></div>}
     {check&&<p className="helper-text">Пункты акта{pairedTu?' и ТУ':''} размечены цветом: зелёный — совпадает, красный — расхождение, жёлтый — проверить вручную. Нажмите на значение или на пункт в документе, чтобы перейти к паре.</p>}
     <TuPreflight check={check} required={detail.tu_check_required} busy={busy} editable={preparing} onCheck={preparing?runCheck:undefined} onConfirm={preparing?confirm:undefined} onJump={jump} tuJump/>
    </div>:<div className="review-side-scroll">
     <div className="review-subtabs" role="group" aria-label="Фильтр замечаний">
      <button aria-pressed={noteTab==='open'} onClick={()=>setNoteTab('open')}>Открытые <b>{openNotes.length}</b></button>
      <button aria-pressed={noteTab==='resolved'} onClick={()=>setNoteTab('resolved')}>Устранённые <b>{resolvedNotes.length}</b></button>
     </div>
     {(noteTab==='open'?openNotes:resolvedNotes).map((c,i)=>{
      const status=statusOf(c),v=detail.versions.find((x:Row)=>x.id===c.version_id);
      const canVerify=effective&&c.author_id===profile.id&&status==='REPORTED_FIXED';
      return <article key={c.id} className={`review-note note-${status}${focused===c.id?' is-focused':''}`}>
       <div className="review-note-head"><span className="review-num">{i+1}</span><button type="button" className="text-button" onClick={()=>goToNote(c)}>{kind} · версия {v?.number}{c.anchor?'':' · общее'}</button></div>
       {c.original_value&&<mark className="review-quote">«{c.original_value}»</mark>}
       <p className={status==='VERIFIED'?'resolved-text':''}>{c.text}</p>
       {c.suggested_value&&<p className="review-suggest">Предлагается: {c.suggested_value}</p>}
       <div className="review-note-foot"><span><Icon name="file" size={14}/>{c.author_name} · {roleNames[c.author_role]??''}</span><span className={`review-state state-${status}`}>{states[status]}</span></div>
       {canVerify&&<div className="review-verify"><textarea aria-label="Результат проверки исправления" placeholder="Что проверено" maxLength={2000} onChange={e=>{explanations.current[c.id]=e.target.value;}}/><div><button disabled={busy} onClick={()=>void event(c,'VERIFIED')}>Подтвердить устранение</button><button className="danger-button" disabled={busy} onClick={()=>void event(c,'REOPENED')}>Отклонить</button></div></div>}
      </article>;})}
     {!(noteTab==='open'?openNotes:resolvedNotes).length&&<p className="helper-text">{noteTab==='open'?'Открытых замечаний нет.':'Устранённых замечаний пока нет.'}</p>}
    </div>}
    <div className="review-side-foot">
     {effective&&<>
      {form?<form className="review-form" aria-label="Новое замечание" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);void action(async()=>{await api(`/api/v1/acts/${detail.id}/comments`,{versionId,taskId:task!.id,categoryId:f.get('category'),text:f.get('description'),suggestedValue:f.get('suggestion'),discussion:'',anchor:form});setForm(undefined);setSelection(null);setTab('remarks');setNoteTab('open');});}}>
       <select name="category" aria-label="Категория ошибки" required>{categories.filter(c=>c.active).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>
       <textarea name="description" aria-label="Текст замечания" placeholder="Текст замечания" required maxLength={10000}/>
       <input name="suggestion" aria-label="Предлагаемый текст" placeholder="Как должно быть (необязательно)" maxLength={5000}/>
       <span className="review-chip"><Icon name="file" size={14}/>{kind} · версия {version?.number}: «{form.quote.slice(0,40)}{form.quote.length>40?'…':''}»<button type="button" aria-label="Отменить" onClick={()=>setForm(undefined)}>×</button></span>
       <button className="primary-button" disabled={busy}>Сохранить замечание</button>
      </form>:<button type="button" className="primary-button review-wide" disabled={!selection||busy} title={selection?undefined:'Выделите фрагмент в левом документе'} onClick={()=>{if(selection){setForm(selection);setPanel(true);}}}>+ Добавить замечание</button>}
      {!selection&&!form&&<p className="helper-text">Как оставить замечание: выделите мышью текст в документе слева — рядом появится кнопка «＋ Замечание».</p>}
      <p className="task-deadline">Ваша задача: {roleNames[task!.role]} · срок {dateTime(task!.due_at)} МСК</p>
      <div className="review-decide">
       <button className="danger-button" disabled={busy||!!form} onClick={()=>setChoice('return')}><Icon name="return"/>Вернуть</button>
       <button className="primary-button" disabled={busy||!!form||!detail.presentation.actions.approve||ownRemark} title={ownRemark?'К этой версии есть ваше замечание — требуется возврат.':undefined} onClick={()=>setChoice('approve')}><Icon name="check"/>Согласовать</button>
      </div>
     </>}
     {preparing&&<SendButton detail={detail} api={api} action={action} busy={busy}/>}
     <button type="button" className="secondary-button review-wide" onClick={close}>Завершить проверку</button>
    </div>
   </aside>}
  </div>
  {choice&&effective&&<DecisionDialog record={{act_number:detail.act_number,version:version?.number,cycle:cycle?.number}} comments={notes.filter(c=>c.task_id===task!.id)} choice={choice} busy={busy} onClose={()=>setChoice(undefined)} onSubmit={reason=>void action(async()=>{await api(`/api/v1/tasks/${task!.id}/decision`,{decision:choice==='approve'?'APPROVE':'RETURN',reason,versionId});setChoice(undefined);})}/>}
 </div>,document.body);
}
