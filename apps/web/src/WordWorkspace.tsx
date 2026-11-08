import {useEffect,useRef,useState,useMemo,type ReactNode} from 'react';
import {RossetiLoader} from './Brand.js';
import DocumentViewer,{type SelectionAnchor,type DocumentViewerHandle} from './DocumentViewer.js';
import {Icon,dateTime,roleNames,shortDate} from './Ui.js';
import PreparationControls,{SendButton,checkFor,isPreparing,openBlockers,type Action} from './ActDocument.js';
import PackagePanel,{extraNames} from './ContractDocuments.js';
import DocTabs,{type Panel} from './DocTabs.js';
import {uploadDocument} from './document-upload.js';
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

/** Read-only preview of a reference document: a TU revision (`tu:<id>`) or an extra document (`x:<id>`). No decisions, no remarks. */
function RefViewer({detail,docKey,api,loadFile}:{detail:Row;docKey:string;api:Api;loadFile:(id:string)=>Promise<ArrayBuffer>}){
 const [kind,id]=docKey.split(':');
 const tu=kind==='tu'?(detail.contractDocuments?.technicalConditions??[]).find((t:Row)=>t.id===id):undefined;
 const extra=kind==='x'?(detail.contractDocuments?.extraDocuments??[]).find((x:Row)=>x.id===id):undefined;
 const doc=tu??extra;
 const [model,setModel]=useState<Row>(),[bytes,setBytes]=useState<ArrayBuffer>(),[error,setError]=useState('');
 useEffect(()=>{
  if(!doc)return;
  let active=true;setModel(undefined);setBytes(undefined);setError('');
  const preview=tu?`/api/v1/acts/${detail.id}/technical-conditions/${doc.id}/preview`:`/api/v1/acts/${detail.id}/extra/${doc.id}/preview`;
  Promise.all([api(preview),loadFile(doc.file_id)])
   .then(([m,b])=>{if(active){setModel(m);setBytes(b);}})
   .catch(e=>{if(active)setError(e.message);});
  return()=>{active=false;};
 },[doc?.id,doc?.file_id,api,loadFile,detail.id]);
 if(!doc)return null;
 const title=tu?`ТУ${tu.document_number?` № ${tu.document_number}`:''}, редакция ${tu.number}`:`${extraNames[extra.kind]??'Документ'}${extra.number>1?` (${extra.number})`:''}`;
 return <section className="tu-view" aria-label={tu?'Просмотр технических условий':'Просмотр дополнительного документа'}>
  <p className="tu-view-note">{title} — справочный документ: замечания и решения относятся к акту.</p>
  {error&&<p role="alert">{error}</p>}
  {bytes&&model?<DocumentViewer bytes={bytes} model={model} comments={[]} onSelection={()=>{}} onComment={()=>{}}/>:!error&&<RossetiLoader label={tu?'Загрузка ТУ…':'Загрузка документа…'}/>}
 </section>;
}

/**
 * Document workplace: package on the left, the document in the middle, TU check and remarks on the right.
 * The act preview stays mounted (hidden) while a TU is open, so an unsaved remark is not lost.
 */
export default function WordWorkspace({detail,profile,tasks,api,loadFile,action,busy,onDownload,onPrint,section,focusComment,focusVersion,onDirty,canLeave,panel='document',onPanel,history,matrix}:{detail:Row;profile:Row;tasks:Row[];api:Api;loadFile:(id:string)=>Promise<ArrayBuffer>;action:Action;busy:boolean;panel?:string;onPanel:(panel:Panel)=>void;history?:ReactNode;matrix?:ReactNode;onDownload:(id:string,n:number)=>Promise<void>;onPrint?:()=>Promise<void>;section:Section;focusComment?:string;focusVersion?:string;onDirty:(value:boolean)=>void;canLeave:()=>boolean}){
 const [openDoc,setOpenDoc]=useState<string>();
 const referenceView=!!openDoc;
 const checkRef=useRef<HTMLDetailsElement>(null);
 const [focusRequest,setFocusRequest]=useState(0);
 const [choice,setChoice]=useState<'approve'|'return'>();
 const [reviewOpen,setReviewOpen]=useState(false);
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
 const changeVersion=(id:string)=>{if(id!==versionId&&!canLeave())return;dirtyKeys.current.clear();onDirty(false);setForm(undefined);setSelection(null);setOpenDoc(undefined);setVersionId(id);};
 // React to an explicit comment link, not to background refreshes or manual version changes.
 useEffect(()=>{
  if(!focusComment)return;
  const c=detail.comments.find((c:Row)=>c.id===focusComment);
  if(c&&c.version_id!==versionId){if(!canLeave())return;dirtyKeys.current.clear();onDirty(false);setForm(undefined);setSelection(null);setVersionId(c.version_id);}
  setOpenDoc(undefined);setFocused(focusComment);setFocusRequest(n=>n+1);
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

 const tus:Row[]=detail.contractDocuments?.technicalConditions??[];
 const extras:Row[]=detail.contractDocuments?.extraDocuments??[];
 const kind=detail.act_type==='AVTU'?'АВТУ':'Акт ТП';
 const missingCard:string[]=preparing?detail.cardMissing??[]:[];
 // Скачать то, что сейчас открыто в просмотре: версию акта, ТУ или доп. документ.
 const shownRef=openDoc?openDoc.startsWith('tu:')?tus.find(t=>'tu:'+t.id===openDoc):extras.find(x=>'x:'+x.id===openDoc):undefined;
 const pick=(value:string)=>{if(value.includes(':')){setForm(undefined);setSelection(null);setOpenDoc(value);}else{setOpenDoc(undefined);changeVersion(value);}};
 const openInView=(key?:string)=>{setOpenDoc(key);onPanel('document');};
 const toCheck=()=>{onPanel('document');setOpenDoc(undefined);requestAnimationFrame(()=>{if(checkRef.current){checkRef.current.open=true;checkRef.current.scrollIntoView({block:'start',behavior:'smooth'});}});};
 const view=panel==='document';
 // Доработка: после возврата инженер загружает исправленный документ (новая версия), затем сверяет его с версией, где были замечания.
 const rework=isPreparing(detail)&&['RETURNED','REVISING'].includes(detail.state)&&!!newest;
 const newestSent=rework&&detail.cycles.some((c:Row)=>c.version_id===newest.id);
 const remarked=[...detail.versions].reverse().find((v:Row)=>v.id!==newest?.id&&notes.some(c=>c.version_id===v.id));
 const toFix=notes.filter(c=>{const last=c.events.filter((e:Row)=>e.version_id===newest?.id).at(-1)?.type;return last!=='REPORTED_FIXED'&&last!=='VERIFIED'&&c.events.at(-1)?.type!=='VERIFIED';}).length;
 const uploadFix=(file:File)=>void action(async()=>{const r=await uploadDocument(api,detail.id,file,detail.act_type);if(r.version)changeVersion(r.version.id);});

 return <section className="word-workspace" aria-label="Работа с документом">
  <div className="word-heading doc-bar">
   <DocTabs panel={panel} onPanel={onPanel} badges={{details:missingCard.length}}/>
   <span className="doc-bar-divider" aria-hidden="true"/>
   {view&&<label className="word-version doc-picker"><Icon name="file" size={16}/><span className="sr-only">Документ для просмотра</span>
    <select aria-label="Версия документа" value={openDoc??versionId??''} onChange={e=>pick(e.target.value)}>
     {!current&&<option value="">файл не загружен</option>}
     {detail.versions.length>0&&<optgroup label={kind}>{detail.versions.map((v:Row)=><option key={v.id} value={v.id}>{versionLabel(v)}</option>)}</optgroup>}
     {tus.length>0&&<optgroup label="Технические условия">{[...tus].reverse().map(t=><option key={t.id} value={'tu:'+t.id}>ТУ · ред. {t.number}{t.document_number?` № ${t.document_number}`:''}{t.document_date?` от ${shortDate(t.document_date)}`:''}</option>)}</optgroup>}
     {extras.length>0&&<optgroup label="Дополнительные документы">{extras.map(x=><option key={x.id} value={'x:'+x.id}>{extraNames[x.kind]??'Документ'}{x.number>1?` (${x.number})`:''}</option>)}</optgroup>}
    </select>
   </label>}
   {view&&!openDoc&&<span className="word-meta">{!current?'файл не загружен':cycle?`цикл согласования ${cycle.number}`:'ещё не отправлялась'}</span>}
   {view&&openDoc&&<span className="word-meta">справочный документ</span>}
   {current&&<button className="primary-button review-launch" onClick={()=>{if(canLeave())setReviewOpen(true);}} title="Акт и ТУ рядом, замечания и автосверка"><Icon name="view" size={16}/>Режим проверки</button>}
   {view&&(shownRef||current)&&<button className="text-button" disabled={busy} onClick={()=>void action(()=>shownRef?onDownload(shownRef.file_id,shownRef.number):onDownload(current.file_id,current.number))}><Icon name="download"/>Скачать оригинал</button>}
   <span className="word-heading-spacer"/>
   {effective&&<p className={`task-deadline ${task.overdue?'overdue':''}`}>Ваша задача: {roleNames[task.role]} · срок {dateTime(task.due_at)} МСК{task.overdue?' · Просрочено':''}</p>}
   {effective&&<div className="word-review-actions">
    <button className="danger-button" disabled={busy||!!form} onClick={()=>setChoice('return')}><Icon name="return"/>Вернуть с замечаниями</button>
    <button className="primary-button" disabled={busy||!detail.presentation.actions.approve||!!form} title={notes.some(c=>c.task_id===task.id&&c.anchor)?'К этой версии есть ваше замечание — требуется возврат.':!detail.presentation.actions.approve?'Сначала подтвердите устранение своих предыдущих замечаний.':undefined} onClick={()=>setChoice('approve')}><Icon name="check"/>Согласовать</button>
   </div>}
   {preparing&&<SendButton detail={detail} api={api} action={action} busy={busy} onFillCard={()=>onPanel('details')} onCheck={toCheck}/>}
  </div>
  {reviewOpen&&<ReviewMode detail={detail} profile={profile} tasks={tasks} api={api} loadFile={loadFile} action={action} busy={busy} section={section} startVersion={versionId} onClose={()=>setReviewOpen(false)} onFillCard={()=>{setReviewOpen(false);onPanel('details');}}/>}
  {view&&historical&&!openDoc&&<p role="note" className="historical-note">Историческая версия · только просмотр. Решения недоступны.{assigned?<button onClick={()=>changeVersion(assigned)}>Открыть назначенную версию</button>:newest&&<button onClick={()=>changeVersion(newest.id)}>Открыть последнюю версию</button>}</p>}
  {view&&rework&&<div className={`rework-banner${newestSent?'':' is-uploaded'}`} role="status">
   <span className="rework-icon" aria-hidden="true"><Icon name={newestSent?'return':'check'} size={20}/></span>
   {newestSent?<div className="rework-text"><b>{detail.state==='REVISING'?'Пересмотр согласованного документа':'Документ возвращён на доработку'}</b><span>Замечаний к исправлению: {toFix}. Исправьте документ и загрузите его — это будет <b>версия {newest.number+1}</b>.</span></div>
    :<div className="rework-text"><b>Исправленный документ загружен — версия {newest.number}</b><span>Сверьте его с версией {remarked?.number??newest.number-1}{remarked?' (там замечания)':''} в режиме проверки: две версии рядом, синхронная прокрутка. По каждому замечанию нажмите «Указать исправление»{toFix?` (осталось ${toFix})`:''}.</span></div>}
   {newestSent?<label className={`primary-button file-button${busy?' is-disabled':''}`}><Icon name="upload" size={16}/>Загрузить исправленный документ · версия {newest.number+1}
    <input className="sr-only" aria-label="Исправленный документ" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadFix(f);e.target.value='';}}/></label>
    :<><button className="primary-button" onClick={()=>{if(canLeave())setReviewOpen(true);}}><Icon name="view" size={16}/>Сверить исправления</button>
     <label className={`secondary-button file-button${busy?' is-disabled':''}`}><Icon name="upload" size={16}/>Загрузить ещё раз · версия {newest.number+1}<input className="sr-only" aria-label="Ещё одна исправленная версия" type="file" accept=".pdf,application/pdf" disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)uploadFix(f);e.target.value='';}}/></label></>}
  </div>}
  {choice&&effective&&<DecisionDialog record={{act_number:detail.act_number,version:current.number,cycle:cycle.number}} comments={notes.filter(c=>c.task_id===task.id)} choice={choice} busy={busy} onClose={()=>setChoice(undefined)} onSubmit={reason=>void action(async()=>{await api(`/api/v1/tasks/${task.id}/decision`,{decision:choice==='approve'?'APPROVE':'RETURN',reason,versionId});setChoice(undefined);})}/>}
  {error&&<p role="alert" className="error">{error}</p>}

  {panel==='print'&&<div className="doc-panel print-panel">
   <section className="data-block print-copy-block">
    <h3 className="data-title"><Icon name="printer" size={16}/>Экземпляр к печати</h3>
    {detail.presentation?.approvedPublication?<>
     <p className="helper-text">Согласованная версия {detail.presentation.approvedPublication.versionNumber} в PDF со служебными значками по углам листов — защищает от подмены страниц.</p>
     {onPrint&&<button className="primary-button print-copy" disabled={busy} onClick={()=>void action(onPrint)}><Icon name="download"/>Скачать экземпляр к печати</button>}
    </>:<p className="helper-text">Появится после завершения согласования: к печати выдаётся только согласованная версия.</p>}
    <p className="helper-text">Ниже — лист согласования: ФИО и должности согласовавших, решения и все замечания с отметкой об устранении.</p>
   </section>
   <ApprovalSheet detail={detail} api={api} profile={profile} inline/>
  </div>}

  {panel==='details'&&<div className="doc-panel data-panel">
   <div className="data-column">
    <section className="data-block" aria-label="Реквизиты">
     <h3 className="data-title"><Icon name="file" size={16}/>Реквизиты</h3>
     <dl className="data-facts">
      <div><dt>Вид документа</dt><dd>{kind}</dd></div>
      <div><dt>Номер договора</dt><dd>{detail.contract_number}{detail.contract_date?` от ${shortDate(detail.contract_date)}`:''}</dd></div>
      <div className="wide"><dt>Заявитель</dt><dd>{detail.applicant||'не указан'}</dd></div>
      <div className="wide"><dt>Адрес</dt><dd>{detail.address||'не указан'}</dd></div>
      <div><dt>РЭС</dt><dd>{detail.presentation.res_name}</dd></div>
      <div><dt>Версий / циклов</dt><dd>{detail.versions.length} / {detail.cycles.length}</dd></div>
      <div><dt>Срок задачи, МСК</dt><dd>{dateTime(detail.presentation.due_at)}</dd></div>
     </dl>
    </section>
    <DocumentCardPanel detail={detail} cycle={cycle} api={api} action={action} busy={busy}/>
   </div>
   <div className="data-column">
    <PackagePanel detail={detail} cycle={cycle} onOpen={openInView} action={action} busy={busy} api={api} onDownload={onDownload}/>
    {onLatest&&<div className="data-block upload-block"><PreparationControls detail={detail} api={api} action={action} busy={busy} onVersion={id=>{changeVersion(id);onPanel('document');}}/></div>}
   </div>
  </div>}
  {panel==='history'&&<div className="doc-panel">{history}</div>}
  {panel==='matrix'&&<div className="doc-panel">{matrix}</div>}

  <div className="act-workspace act-view" style={view?undefined:{display:'none'}}>
   <div className="act-main">
    {openDoc&&<RefViewer key={openDoc} detail={detail} docKey={openDoc} api={api} loadFile={loadFile}/>}
    {!current&&!openDoc&&<div className="empty-document"><p>Загрузите PDF в разделе «Данные», чтобы начать работу с документом.</p><button className="secondary-button" onClick={()=>onPanel('details')}><Icon name="upload" size={16}/>Перейти к загрузке</button></div>}
    {current&&<div className="word-grid" style={referenceView?{display:'none'}:undefined}>
     <div className="word-document">{model&&bytes?<DocumentViewer key={versionId} ref={viewerRef} bytes={bytes} model={model} comments={versionNotes} onSelection={setSelection} onComment={focus} focusedId={focused} focusRequest={focusRequest} marks={actMarks} onAddRemark={form?undefined:()=>{const why=remarkBlockReason(detail,tasks,profile,versionId);if(why){setError(why);return;}if(selection){setForm(selection);dirty('remark',true);}}} remarkBlocked={remarkBlockReason(detail,tasks,profile,versionId)}/>:!error&&<RossetiLoader label="Загрузка документа…"/>}</div>
     <aside className="word-remarks" aria-label="Замечания к документу">
      {showCheck&&<details ref={checkRef} className="side-block check-block" open={preparing||!!effective||undefined}>
       <summary>{checkSummary(check)}</summary>
       <TuPreflight check={check} required={detail.tu_check_required} busy={busy} editable={preparing} onCheck={preparing?runCheck:undefined} onConfirm={preparing?confirm:undefined} onJump={id=>viewerRef.current?.scrollToBlock(id)}/>
      </details>}
      {!detail.tu_check_required&&preparing&&<p className="helper-text">Проверка ТУ отключена для этой карточки. Отправка не подтверждает соответствие ТУ.</p>}

      <div className="remarks-head">
       <h3>Замечания · {notes.length}{openCount?<span className="remarks-open"> · открытых {openCount}</span>:null}</h3>
       <button className="danger-button" disabled={!effective||!selection||busy} onClick={()=>{if(selection){setForm(selection);dirty('remark',true);}}}>Добавить замечание</button>
      </div>
      {effective&&!selection&&!form&&<p className="helper-text">Выделите мышью текст в документе (внутри одного абзаца) — рядом появится кнопка «＋ Замечание».</p>}
      {actMarks.length>0&&<div className="mark-legend"><span><i className="ok"/>совпадает с ТУ</span><span><i className="bad"/>расхождение</span><span><i className="warn"/>проверить вручную</span><span><i className="same"/>одинаково во всём акте</span></div>}
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
        <button className="text-button note-jump" onClick={()=>{setOpenDoc(undefined);if(c.version_id!==versionId){changeVersion(c.version_id);setFocused(c.id);}else focus(c.id);}}>К фрагменту · v{noteVersion}{!c.anchor?' · общее замечание':''}</button>
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
