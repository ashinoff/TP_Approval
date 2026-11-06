import {useEffect,useRef,useState,useMemo} from 'react';
import {RossetiLoader} from './Brand.js';
import DocumentViewer,{type SelectionAnchor,type DocumentViewerHandle} from './DocumentViewer.js';
import {Icon,dateTime,roleNames} from './Ui.js';
import PreparationControls,{SendButton,checkFor,isPreparing,openBlockers} from './ActDocument.js';
import PackagePanel from './ContractDocuments.js';
import TuPreflight from './TuPreflight.js';
import DocumentCardPanel from './DocumentCard.js';
import ReviewMode from './ReviewMode.js';
import ApprovalSheet from './ApprovalSheet.js';
import {checkMarks} from './review-marks.js';
import DecisionDialog from './DecisionDialog.js';
import {initialVersion,assignedVersion,remarkBlockReason,type Section} from './workplace.js';

type Row=Record<string,any>;
type Api=(p:string,b?:object|FormData)=>Promise<any>;
const states:Record<string,string>={OPEN:'Не исправлено',REPORTED_FIXED:'Исправлено, ожидает проверки',VERIFIED:'Подтверждено',REOPENED:'Исправление отклонено'};
/** One-line state of the TU check for the collapsed panel header. */
function checkSummary(check?:Row){
 if(!check)return 'Сверка с ТУ · не выполнялась';
 const findings:Row[]=check.findings??[];
 const matches=findings.filter(f=>f.status==='MATCH').length;
 const manual=check.confirmations?.length??0;
 if(check.status==='PASS')return `Сверка с ТУ · совпадает ${matches}`;
 return `Сверка с ТУ · совпадает ${matches}${manual?`, подтверждено вручную ${manual}`:''}${openBlockers(check).length?', есть вопросы':''}`;
}
const initials=(name:string)=>name.replace(/^Демо\s*·\s*/,'').split(/[\s·.]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join('').toUpperCase()||'?';

/** Read-only preview of a TU revision (reference document: no decisions, no remarks). */
function TuViewer({detail,tuId,api,loadFile}:{detail:Row;tuId:string;api:Api;loadFile:(id:string)=>Promise<ArrayBuffer>}){
 const tu=(detail.contractDocuments?.technicalConditions??[]).find((t:Row)=>t.id===tuId);
 const [model,setModel]=useState<Row>(),[bytes,setBytes]=useState<ArrayBuffer>(),[error,setError]=useState('');
 useEffect(()=>{
  if(!tu)return;
  let active=true;setModel(undefined);setBytes(undefined);setError('');
  Promise.all([api(`/api/v1/acts/${detail.id}/technical-conditions/${tu.id}/preview`),loadFile(tu.file_id)])
   .then(([m,b])=>{if(active){setModel(m);setBytes(b);}})
   .catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[tu?.id,tu?.file_id,api,loadFile,detail.id]);
 if(!tu)return null;
 return <section className="tu-view" aria-label="Просмотр технических условий">
  <p className="tu-view-note">ТУ{tu.document_number?` № ${tu.document_number}`:''}, редакция {tu.number} — справочный документ: замечания и решения относятся к акту.</p>
  {error&&<p role="alert">{error}</p>}
  {bytes&&model?<DocumentViewer bytes={bytes} model={model} comments={[]} onSelection={()=>{}} onComment={()=>{}}/>:!error&&<RossetiLoader label="Загрузка ТУ…"/>}
 </section>;
}

/**
 * Document workplace: package on the left, the document in the middle, TU check and remarks on the right.
 * The act preview stays mounted (hidden) while a TU is open, so an unsaved remark is not lost.
 */
export default function WordWorkspace({detail,profile,tasks,api,loadFile,action,busy,onDownload,section,focusComment,focusVersion,onDirty,canLeave}:{detail:Row;profile:Row;tasks:Row[];api:Api;loadFile:(id:string)=>Promise<ArrayBuffer>;action:(fn:()=>Promise<unknown>)=>Promise<void>;busy:boolean;onDownload:(id:string,n:number)=>Promise<void>;section:Section;focusComment?:string;focusVersion?:string;onDirty:(value:boolean)=>void;canLeave:()=>boolean}){
 const [openTu,setOpenTu]=useState<string>();
 const referenceView=!!openTu;
 const [focusRequest,setFocusRequest]=useState(0);
 const [choice,setChoice]=useState<'approve'|'return'>();
 const [reviewOpen,setReviewOpen]=useState(false),[sheetOpen,setSheetOpen]=useState(false);
 const dirtyKeys=useRef(new Set<string>());
 const dirty=(key:string,value:boolean)=>{if(value)dirtyKeys.current.add(key);else dirtyKeys.current.delete(key);onDirty(dirtyKeys.current.size>0);};
 const [versionId,setVersionId]=useState(()=>detail.comments.find((c:Row)=>c.id===focusComment)?.version_id??(detail.versions.some((v:Row)=>v.id===focusVersion)?focusVersion!:initialVersion(detail,tasks,section)));
 const [model,setModel]=useState<Row>(),[bytes,setBytes]=useState<ArrayBuffer>(),[error,setError]=useState('');
 const [categories,setCategories]=useState<Row[]>([]);
 const [selection,setSelection]=useState<SelectionAnchor|null>(null),[form,setForm]=useState<SelectionAnchor>();
 const [focused,setFocused]=useState<string|undefined>(focusComment);
 const [compare,setCompare]=useState<Row>(),[comparing,setComparing]=useState(false);
 const [noteFilter,setNoteFilter]=useState<'all'|'open'|'waiting'|'mine'>('all');
 const explanations=useRef<Record<string,string>>({});
 const viewerRef=useRef<DocumentViewerHandle>(null);

 const newest=detail.versions.at(-1);
 const current=detail.versions.find((v:Row)=>v.id===versionId);
 const cycle=detail.cycles.find((c:Row)=>c.version_id===versionId);
 const task=tasks.find(t=>t.act_id===detail.id&&t.cycle_id===cycle?.id&&t.role!=='RIRU_ENGINEER');
 const effective=!referenceView&&task&&detail.author_id!==profile.id&&current?.created_by!==profile.id;
 const canReport=detail.presentation.canPrepare&&['RETURNED','REVISING'].includes(detail.state)&&current?.id===newest?.id;
 const onLatest=!current||current.id===newest?.id;
 const preparing=isPreparing(detail)&&onLatest;
 const historical=current&&current.id!==initialVersion(detail,tasks,section);
 const assigned=assignedVersion(detail,tasks);

 useEffect(()=>{setChoice(undefined);},[task?.id]);
 const notes:Row[]=detail.comments;
 const notesSignature=JSON.stringify(notes.filter(c=>c.version_id===versionId));
 const versionNotes:Row[]=useMemo(()=>JSON.parse(notesSignature),[notesSignature]);
 const generation=useRef(0);
 useEffect(()=>{
  if(!versionId||!current)return;
  const seq=++generation.current;
  setModel(undefined);setBytes(undefined);setForm(undefined);setSelection(null);setError('');
  Promise.all([api(`/api/v1/acts/${detail.id}/versions/${versionId}/preview`),loadFile(current.file_id),api('/api/v1/error-categories')])
   .then(([m,b,c])=>{if(seq===generation.current){setModel(m);setBytes(b);setCategories(c);}})
   .catch(e=>{if(seq===generation.current)setError(e.message);});
  return()=>{generation.current++;};
 },[detail.id,versionId,current?.file_id,api,loadFile]);
 const changeVersion=(id:string)=>{if(id!==versionId&&!canLeave())return;dirtyKeys.current.clear();onDirty(false);setForm(undefined);setSelection(null);setOpenTu(undefined);setVersionId(id);};
 // React to an explicit comment link, not to background refreshes or manual version changes.
 useEffect(()=>{
  if(!focusComment)return;
  const c=detail.comments.find((c:Row)=>c.id===focusComment);
  if(c&&c.version_id!==versionId){if(!canLeave())return;dirtyKeys.current.clear();onDirty(false);setForm(undefined);setSelection(null);setVersionId(c.version_id);}
  setOpenTu(undefined);setFocused(focusComment);setFocusRequest(n=>n+1);
 },[focusComment]);
 useEffect(()=>{if(focusVersion&&detail.versions.some((v:Row)=>v.id===focusVersion))changeVersion(focusVersion);},[focusVersion]);
 const focus=(id:string)=>{setFocused(id);setFocusRequest(n=>n+1);document.getElementById(`word-note-${id}`)?.scrollIntoView({block:'nearest',behavior:'smooth'});};
 const event=async(c:Row,type:string)=>{
  const explanation=explanations.current[c.id]?.trim();
  if(!explanation){setError('Укажите описание исправления или проверки.');return;}
  await action(async()=>{await api(`/api/v1/comments/${c.id}/events`,{versionId,type,explanation});explanations.current[c.id]='';dirty(c.id,false);});
 };

 // TU check shown next to the document: the engineer works with the latest version; reviewers see the report of the shown version.
 const checkTuId=cycle?.technical_conditions_id??detail.technical_conditions_id;
 const check=checkFor(detail,versionId,checkTuId);
 const showCheck=detail.tu_check_required!==false&&!!current&&(preparing||!!check);
 const actMarks=useMemo(()=>checkMarks(check,'act'),[check]);
 const runCheck=()=>void action(()=>api(`/api/v1/acts/${detail.id}/check-tu`,{versionId:newest.id,expectedRevision:detail.revision}));
 const confirm=(field:string,comment:string)=>void action(()=>api(`/api/v1/acts/${detail.id}/check-tu/${check!.id}/confirm`,{field,comment,expectedRevision:detail.revision}));

 const statusOf=(c:Row)=>c.events.filter((e:Row)=>e.version_id===versionId).at(-1)?.type??'OPEN';
 const shownNotes=notes.filter(c=>noteFilter==='all'||(noteFilter==='open'&&['OPEN','REOPENED'].includes(statusOf(c)))||(noteFilter==='waiting'&&statusOf(c)==='REPORTED_FIXED')||(noteFilter==='mine'&&c.author_id===profile.id));
 const openCount=notes.filter(c=>['OPEN','REOPENED'].includes(statusOf(c))).length;
 const versionLabel=(v:Row)=>`Версия ${v.number}${v.id===assigned?' · ваша задача':v.id===detail.presentation.approvedPublication?.versionId?' · согласована, к печати':v.id===newest?.id?' · последняя':''}`;

 return <section className="word-workspace" aria-label="Работа с документом">
  <div className="word-heading">
   <label className="word-version">Версия документа
    <select aria-label="Версия документа" value={versionId} onChange={e=>changeVersion(e.target.value)}>
     {detail.versions.map((v:Row)=><option key={v.id} value={v.id}>{versionLabel(v)}</option>)}
    </select>
   </label>
   <span className="word-meta">{!current?'файл не загружен':cycle?`цикл согласования ${cycle.number}`:'ещё не отправлялась'}</span>
   {current&&<button className="primary-button review-launch" onClick={()=>{if(canLeave())setReviewOpen(true);}} title="Акт и ТУ рядом, замечания и автосверка"><Icon name="file"/>Режим проверки</button>}
   {detail.cycles.length>0&&<button className="secondary-button sheet-launch" onClick={()=>setSheetOpen(true)} title="ФИО согласовавших, решения, замечания — для печати"><Icon name="check"/>Лист согласования</button>}
   {current&&<button className="text-button" disabled={busy} onClick={()=>void action(()=>onDownload(current.file_id,current.number))}><Icon name="download"/>Скачать оригинал</button>}
   <span className="word-heading-spacer"/>
   {effective&&<p className={`task-deadline ${task.overdue?'overdue':''}`}>Ваша задача: {roleNames[task.role]} · срок {dateTime(task.due_at)} МСК{task.overdue?' · Просрочено':''}</p>}
   {effective&&<div className="word-review-actions">
    <button className="danger-button" disabled={busy||!!form} onClick={()=>setChoice('return')}><Icon name="return"/>Вернуть с замечаниями</button>
    <button className="primary-button" disabled={busy||!detail.presentation.actions.approve||!!form} title={notes.some(c=>c.task_id===task.id&&c.anchor)?'К этой версии есть ваше замечание — требуется возврат.':!detail.presentation.actions.approve?'Сначала подтвердите устранение своих предыдущих замечаний.':undefined} onClick={()=>setChoice('approve')}><Icon name="check"/>Согласовать</button>
   </div>}
   {preparing&&<SendButton detail={detail} api={api} action={action} busy={busy}/>}
  </div>
  {sheetOpen&&<ApprovalSheet detail={detail} api={api} profile={profile} onClose={()=>setSheetOpen(false)}/>}
  {reviewOpen&&<ReviewMode detail={detail} profile={profile} tasks={tasks} api={api} loadFile={loadFile} action={action} busy={busy} section={section} startVersion={versionId} onClose={()=>setReviewOpen(false)}/>}
  {historical&&<p role="note" className="historical-note">Историческая версия · только просмотр. Решения недоступны.{assigned?<button onClick={()=>changeVersion(assigned)}>Открыть назначенную версию</button>:newest&&<button onClick={()=>changeVersion(newest.id)}>Открыть последнюю версию</button>}</p>}
  {choice&&effective&&<DecisionDialog record={{act_number:detail.act_number,version:current.number,cycle:cycle.number}} comments={notes.filter(c=>c.task_id===task.id)} choice={choice} busy={busy} onClose={()=>setChoice(undefined)} onSubmit={reason=>void action(async()=>{await api(`/api/v1/tasks/${task.id}/decision`,{decision:choice==='approve'?'APPROVE':'RETURN',reason,versionId});setChoice(undefined);})}/>}
  {error&&<p role="alert" className="error">{error}</p>}

  <div className="act-workspace">
   <PackagePanel detail={detail} cycle={cycle} openTu={openTu} onOpenTu={id=>setOpenTu(id)} action={action} busy={busy} api={api} onDownload={onDownload}>
    <DocumentCardPanel detail={detail} cycle={cycle} api={api} action={action} busy={busy}/>
    {onLatest&&<PreparationControls detail={detail} api={api} action={action} busy={busy} onVersion={id=>changeVersion(id)}/>}
   </PackagePanel>
   <div className="act-main">
    {openTu&&<TuViewer key={openTu} detail={detail} tuId={openTu} api={api} loadFile={loadFile}/>}
    {!current&&!openTu&&<div className="empty-document"><p>Загрузите PDF в панели «Пакет документов», чтобы начать работу с документом.</p></div>}
    {current&&<div className="word-grid" style={referenceView?{display:'none'}:undefined}>
     <div className="word-document">{model&&bytes?<DocumentViewer key={versionId} ref={viewerRef} bytes={bytes} model={model} comments={versionNotes} onSelection={setSelection} onComment={focus} focusedId={focused} focusRequest={focusRequest} marks={actMarks} onAddRemark={form?undefined:()=>{const why=remarkBlockReason(detail,tasks,profile,versionId);if(why){setError(why);return;}if(selection){setForm(selection);dirty('remark',true);}}} remarkBlocked={remarkBlockReason(detail,tasks,profile,versionId)}/>:!error&&<RossetiLoader label="Загрузка документа…"/>}</div>
     <aside className="word-remarks" aria-label="Замечания к документу">
      {showCheck&&<details className="side-block check-block" open={preparing||!!effective||undefined}>
       <summary>{checkSummary(check)}</summary>
       <TuPreflight check={check} required={detail.tu_check_required} busy={busy} editable={preparing} onCheck={preparing?runCheck:undefined} onConfirm={preparing?confirm:undefined} onJump={id=>viewerRef.current?.scrollToBlock(id)}/>
      </details>}
      {!detail.tu_check_required&&preparing&&<p className="helper-text">Проверка ТУ отключена для этой карточки. Отправка не подтверждает соответствие ТУ.</p>}

      <div className="remarks-head">
       <h3>Замечания · {notes.length}{openCount?<span className="remarks-open"> · открытых {openCount}</span>:null}</h3>
       <button className="danger-button" disabled={!effective||!selection||busy} onClick={()=>{if(selection){setForm(selection);dirty('remark',true);}}}>Добавить замечание</button>
      </div>
      {effective&&!selection&&!form&&<p className="helper-text">Выделите мышью текст в документе (внутри одного абзаца) — рядом появится кнопка «＋ Замечание».</p>}
      {actMarks.length>0&&<div className="mark-legend"><span><i className="ok"/>совпадает с ТУ</span><span><i className="bad"/>расхождение</span><span><i className="warn"/>проверить вручную</span></div>}
      {notes.length>1&&<div className="note-filter" role="group" aria-label="Фильтр замечаний">
       {([['all','Все'],['open','Открытые'],['waiting','Ждут проверки'],['mine','Мои']] as const).map(([key,label])=><button key={key} type="button" aria-pressed={noteFilter===key} onClick={()=>setNoteFilter(key)}>{label}</button>)}
      </div>}
      {form&&<form className="remark-form" aria-label="Новое замечание к фрагменту" onSubmit={e=>{
       e.preventDefault();
       if(!effective){setError('Задача или назначение изменились. Замечание не сохранено, введённый текст оставлен.');return;}
       const f=new FormData(e.currentTarget);
       void action(async()=>{await api(`/api/v1/acts/${detail.id}/comments`,{versionId,taskId:task!.id,categoryId:f.get('category'),text:f.get('description'),suggestedValue:f.get('suggestion'),discussion:f.get('discussion'),anchor:form});setForm(undefined);dirty('remark',false);});
      }}>
       <label>Категория ошибки<select name="category" required>{categories.filter(c=>c.active).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select></label>
       <label>Выделенный фрагмент<textarea value={form.quote} readOnly/></label>
       <label>Описание ошибки<textarea name="description" required maxLength={10000}/></label>
       <label>Предлагаемый правильный текст<textarea name="suggestion" maxLength={5000}/></label>
       <label>Комментарий<textarea name="discussion" maxLength={2000}/></label>
       <div className="remark-form-actions">
        <button className="primary-button" disabled={busy||!effective}>Сохранить замечание</button>
        <button type="button" onClick={()=>{if(canLeave()){setForm(undefined);dirty('remark',false);}}}>Отмена</button>
       </div>
      </form>}
      {shownNotes.map(c=>{
       const last=c.events.filter((e:Row)=>e.version_id===versionId).at(-1);
       const status=last?.type??'OPEN';
       const canVerify=effective&&c.author_id===profile.id&&last?.type==='REPORTED_FIXED';
       const noteVersion=detail.versions.find((v:Row)=>v.id===c.version_id)?.number;
       const report=canReport&&current.number>noteVersion&&status!=='VERIFIED'&&status!=='REPORTED_FIXED';
       return <article key={c.id} id={`word-note-${c.id}`} className={`word-note comment ${status==='VERIFIED'?'resolved':'unresolved'} note-${status} ${focused===c.id?'note-selected':''}`}>
        <div className="note-head">
         <span className="note-avatar" aria-hidden="true">{initials(c.author_name??'')}</span>
         <div className="note-author"><b>{c.author_name}</b><small>{roleNames[c.author_role]} · цикл/версия {noteVersion} · {dateTime(c.created_at)}</small></div>
         <span className="remark-state">{states[status]}</span>
        </div>
        <span className="note-category">{c.category_name??'Общее замечание'}</span>
        {c.original_value&&<blockquote className={c.suggested_value?'note-was':''}>{c.original_value}</blockquote>}
        {c.suggested_value&&<p className="note-suggestion"><strong>Предлагается:</strong> {c.suggested_value}</p>}
        <p>{c.text}</p>
        {c.discussion&&<p className="note-discussion">{c.discussion}</p>}
        <button className="text-button note-jump" onClick={()=>{setOpenTu(undefined);if(c.version_id!==versionId){changeVersion(c.version_id);setFocused(c.id);}else focus(c.id);}}>К фрагменту · v{noteVersion}{!c.anchor?' · общее замечание':''}</button>
        {c.version_id!==versionId&&c.anchor&&<p className="anchor-warning">Привязка относится к исходной версии. В новой редакции требует ручной проверки.</p>}
        {c.events.map((e:Row)=><p className="remark-history" key={e.id}>{states[e.type]} · v{detail.versions.find((v:Row)=>v.id===e.version_id)?.number} · {dateTime(e.created_at)}: {e.explanation}</p>)}
        {(report||canVerify)&&<div className="note-actions">
         <label>Описание исправления или проверки<textarea onChange={e=>{explanations.current[c.id]=e.target.value;dirty(c.id,!!e.target.value.trim());}} maxLength={2000}/></label>
         {report&&<button disabled={busy} onClick={()=>void event(c,'REPORTED_FIXED')}>Указать исправление</button>}
         {canVerify&&<><button disabled={busy} onClick={()=>void event(c,'VERIFIED')}>Подтвердить устранение</button><button className="danger-button" disabled={busy} onClick={()=>void event(c,'REOPENED')}>Отклонить исправление</button></>}
        </div>}
       </article>;
      })}
      {!notes.length&&<p className="helper-text">Замечаний пока нет.</p>}

      <details className="compare-extra side-block">
       <summary>Сравнение версий</summary>
       {detail.versions.length>1?<form className="word-compare-controls" onSubmit={e=>{e.preventDefault();const f=new FormData(e.currentTarget);setComparing(true);setError('');api(`/api/v1/acts/${detail.id}/compare?from=${f.get('from')}&to=${f.get('to')}`).then(setCompare).catch(e=>setError(e.message)).finally(()=>setComparing(false));}}>
        <label>Исходная версия<select name="from">{detail.versions.map((v:Row)=><option value={v.id} key={v.id}>Версия {v.number}</option>)}</select></label>
        <label>Новая версия<select name="to" defaultValue={newest?.id}>{detail.versions.map((v:Row)=><option value={v.id} key={v.id}>Версия {v.number}</option>)}</select></label>
        <button className="secondary-button" disabled={comparing}>Сравнить версии</button>
       </form>:<p className="helper-text">Сравнение появится, когда будет вторая версия.</p>}
       {compare&&<section className="word-comparison" aria-label="Сравнение версий">
        <h3>Версия {compare.from.number} → {compare.to.number}</h3>
        <p className="helper-text">{compare.limitations}</p>
        <div className="diff-legend"><span>− Удалено</span><span>+ Добавлено</span></div>
        <pre>{compare.changes.map((c:Row,i:number)=>c.type==='removed'?<del key={i}>{c.text}</del>:c.type==='added'?<ins key={i}>{c.text}</ins>:<span key={i}>{c.text}</span>)}</pre>
        <h4>Изменённые реквизиты</h4>
        {compare.fields.length?compare.fields.map((f:Row)=><p key={f.key}>{f.key}: <del>{JSON.stringify(f.before)}</del> → <ins>{JSON.stringify(f.after)}</ins></p>):<p>Сохранённые реквизиты не изменились.</p>}
        <h4>Замечания</h4>
        {compare.remarks.map((c:Row)=><p key={c.id}>{c.text} · {states[c.status]}</p>)}
       </section>}
      </details>
     </aside>
    </div>}
   </div>
  </div>
 </section>;
}
