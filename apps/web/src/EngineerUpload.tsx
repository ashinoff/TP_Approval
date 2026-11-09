import {useEffect,useRef,useState,type ReactNode} from 'react';
import {uploadDocument} from './document-upload.js';
import {Icon} from './Ui.js';
import {CONTRACT_NUMBER_PATTERN,normalizeContractNumber} from './workplace.js';
import {CardInputs,type CardField,type CardDraft} from './DocumentCard.js';
type Row=Record<string,any>;
const labels:Record<string,string>={ACT_TP:'АКТ ТП',AVTU:'АВТУ',NOTICE:'УВЕДОМЛЕНИЕ',TU:'ТУ'};
/** Вид документа определяется по заголовку (решение владельца 09.11.2026); кнопок выбора нет, только поправка, если не распознан. */
const docNames:Record<string,string>={ACT_TP:'Акт ТП',NOTICE:'Уведомление',AVTU:'АВТУ'};
const docTitles:Record<string,string>={ACT_TP:'Акт об осуществлении технологического присоединения',NOTICE:'Уведомление об обеспечении возможности присоединения',AVTU:'Акт о выполнении технических условий'};
type Part={type:string|null;pages:number[];range:string;contractNumber?:string|null;contractDate?:string|null};
const pagesText=(range:string)=>range?(range.includes('-')||range.includes(',')?'стр. ':'стр. ')+range.replace(/-/g,'–').replace(/,/g,', '):'';
/** Режимы формы (решение владельца 06.11.2026): новый документ и доп. документы. */
const modes=[['NEW','Новый документ'],['EXTRA','Доп. документы']] as const;
/** Необязательные документы при создании и виды доп. документов (ТУ — новая редакция к существующему документу). */
const optional=[['PSU','ПСУ'],['PREV_ACT','Предыдущий акт ТП'],['POLE_SCHEME','Поопорная схема'],['TU_CHANGE','Изменения к ТУ'],['PROJECT','Проект']] as const;
const extraKinds=[['TU','ТУ (новая редакция)'],...optional] as const;

/** Строка списка документов: название слева, имя выбранного файла, справа кнопка загрузки. */
function FileTile({title,ariaLabel,file,disabled,onFile,optional,children}:{title:string;ariaLabel:string;file?:File;disabled:boolean;onFile:(f:File|undefined)=>void;optional?:boolean;children?:ReactNode}){
 return <div className={`file-tile file-row${file?' file-tile-ready':''}${optional?' file-tile-optional':''}`}>
  <span className="file-row-icon" aria-hidden="true"><Icon name={file?'okcircle':'file'} size={18}/></span>
  <span className="file-tile-title">{title}{optional&&<small>необязательно</small>}</span>
  {children&&<span className="file-row-extra">{children}</span>}
  <span className="file-name" title={file?.name}>{file?file.name:'Файл не выбран'}</span>
  <label className={`${file?'secondary-button':'primary-button'} file-button${disabled?' is-disabled':''}`}><Icon name="upload" size={16}/>{file?'Заменить':'Загрузить PDF'}
   <input className="sr-only" aria-label={ariaLabel} type="file" accept=".pdf,application/pdf" disabled={disabled} onChange={e=>onFile(e.target.files?.[0])}/>
  </label>
 </div>;
}

type Step={key:string;label:string;status:'wait'|'run'|'done'|'fail';note?:string};
const stateNames:Record<string,string>={DRAFT:'черновик',RIRU_REVIEW:'на согласовании',RES_REVIEW:'на согласовании',CENTRAL_REVIEW:'на согласовании',CENTRAL_COLLECTING:'на согласовании',RETURNED:'на доработке',REVISING:'на пересмотре',APPROVED:'согласован'};
const stepState={wait:'ожидает',run:'выполняется',done:'готово',fail:'ошибка'};

/** Ход сохранения по шагам: инженер видит, что именно загружено и учтено, а при сбое — на каком шаге (09.11.2026). */
function UploadProgress({steps}:{steps:Step[]}){
 return <ol className="upload-progress" aria-label="Ход сохранения">
  {steps.map(s=><li key={s.key} className={`up-step up-${s.status}`}>
   <span className="up-mark" aria-hidden="true">{s.status==='done'?<Icon name="check" size={14}/>:s.status==='fail'?<Icon name="x" size={14}/>:s.status==='run'?<span className="up-spin"/>:null}</span>
   <span className="up-label">{s.label}<span className="sr-only">: {stepState[s.status]}</span></span>
   {s.note&&<small className="up-note">{s.note}</small>}
  </li>)}
 </ol>;
}

export default function EngineerUpload({api,action,busy,resUnits,profile,drafts,onRefresh,onCreated,onDirty}:{api:(p:string,b?:object|FormData)=>Promise<any>;action:(fn:()=>Promise<unknown>)=>Promise<unknown>;busy:boolean;resUnits:Row[];profile:Row;drafts?:number;onRefresh:()=>Promise<unknown>;onCreated:(id:string)=>void;onDirty:(dirty:boolean)=>void}){
 const areas=resUnits.filter(r=>profile.roles.some((role:Row)=>role.role==='RIRU_ENGINEER'&&role.resId===r.id));
 const [resId,setResId]=useState(areas[0]?.id??''),[mode,setMode]=useState<'NEW'|'EXTRA'>('NEW'),[extraKind,setExtraKind]=useState('TU'),[extras,setExtras]=useState<Record<string,File|undefined>>({}),[file,setFile]=useState<File>(),[tu,setTu]=useState<File>(),[query,setQuery]=useState(''),[targets,setTargets]=useState<Row[]>([]),[target,setTarget]=useState(''),[error,setError]=useState(''),[created,setCreated]=useState<Record<string,string>>({}),[extracting,setExtracting]=useState(false),[report,setReport]=useState<Row>();
 const [values,setValues]=useState({contractNumber:'',contractDate:'',applicant:'',address:''});
 const [inputKey,setInputKey]=useState(0);
 const [fields,setFields]=useState<CardField[]>([]),[cardDraft,setCardDraft]=useState<CardDraft>({});
 const [steps,setSteps]=useState<Step[]>([]),[done,setDone]=useState<string>(),[dupes,setDupes]=useState<Row[]>([]);
 const [parts,setParts]=useState<Part[]>([]),[inspecting,setInspecting]=useState(false),[docDate,setDocDate]=useState('');
 useEffect(()=>{let active=true;api('/api/v1/card-fields').then(f=>{if(active)setFields(f);}).catch(()=>{});return()=>{active=false;};},[api]);
 const request=useRef(0),saved=useRef({tu:undefined as File|undefined,acts:{} as Record<string,File|undefined>,extras:{} as Record<string,File|undefined>}),inspection=useRef(0);
 useEffect(()=>()=>{request.current++;},[]);
 useEffect(()=>{if(mode!=='EXTRA')return;let active=true;const timer=setTimeout(()=>{api('/api/v1/registry?view=preparation&limit=100&q='+encodeURIComponent(query)).then(r=>{if(active)setTargets(r.items.filter((a:Row)=>['DRAFT','RETURNED','REVISING'].includes(a.state)));}).catch(e=>{if(active)setError(e.message);});},200);return()=>{active=false;clearTimeout(timer);};},[mode,query,api]);
 const readTu=async(selected:File|undefined)=>{
  setTu(selected);setReport(undefined);setError('');const seq=++request.current;onDirty(true);
  if(!selected){setExtracting(false);return;}setExtracting(true);
  try{const data=new FormData();data.append('resId',resId);data.append('file',selected);const result=await api('/api/v1/documents/extract-tu',data);if(seq!==request.current)return;if(result.preparedFile){const decoded=Uint8Array.from(atob(result.preparedFile.base64),(c:string)=>c.charCodeAt(0));setTu(new File([decoded],selected.name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));}setReport(result);setCardDraft(d=>{const next={...d};for(const f of fields)if(f.tu_source){const sug=result.card?.[f.tu_source];if(sug?.value)next[f.code]={value:sug.value,origin:'TU'};else if(next[f.code]?.origin==='TU')delete next[f.code];}return next;});// Пустое значение из ТУ не стирает уже подставленное из документа (дата договора есть в уведомлении/акте, а в ТУ её нет).
   setValues(v=>({contractNumber:result.fields.contractNumber.value||v.contractNumber,contractDate:result.fields.contractDate.value||v.contractDate,applicant:result.fields.applicant.value||v.applicant,address:result.fields.address.value||v.address}));}
  catch(e){if(seq===request.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(seq===request.current)setExtracting(false);}
 };
 // Документ: вид по заголовку, скреплённые документы — отдельными частями; дата договора — из документа, если в ТУ её нет.
 const readDocument=async(selected:File|undefined)=>{
  setFile(selected);setParts([]);setError('');onDirty(true);const seq=++inspection.current;
  if(!selected)return;
  if(!/\.pdf$/i.test(selected.name)&&selected.type!=='application/pdf'){setParts([{type:null,pages:[],range:''}]);return;}
  setInspecting(true);
  try{const data=new FormData();data.append('resId',resId);data.append('file',selected);const r=await api('/api/v1/documents/inspect',data);if(seq!==inspection.current)return;
   setParts(r.parts);const date=r.parts.find((x:Part)=>x.contractDate)?.contractDate;setDocDate(date??'');const number=r.parts.find((x:Part)=>x.contractNumber)?.contractNumber;
   setValues(v=>({...v,contractDate:v.contractDate||date||'',contractNumber:v.contractNumber||number||''}));}
  catch(e){if(seq===inspection.current){setParts([{type:null,pages:[],range:''}]);setError((e as Error).message);}}
  finally{if(seq===inspection.current)setInspecting(false);}
 };
 const changeMode=(next:'NEW'|'EXTRA')=>{if(next===mode)return;request.current++;inspection.current++;setMode(next);setFile(undefined);setParts([]);setTu(undefined);setExtras({});setReport(undefined);setError('');setInputKey(k=>k+1);};
 const locked=busy||extracting||inspecting;
 // Не распознанный по заголовку документ — по умолчанию акт ТП, инженер может поправить.
 const docs=parts.map(x=>({...x,type:x.type??'ACT_TP',guessed:!x.type}));
 const types=docs.map(d=>d.type);
 const isCreated=Object.keys(created).length>0;
 const mainType=types.find(t=>t==='ACT_TP'||t==='NOTICE')??types[0];
 const contractNumber=normalizeContractNumber(values.contractNumber);
 const numberValid=CONTRACT_NUMBER_PATTERN.test(contractNumber);
 const actLabel=types.length?types.map(t=>docNames[t]).join(' + '):'Акт ТП';
 const typeKey=types.join(',');
 // Номер договора уникален: о существующем документе того же вида предупреждаем до сохранения, во всех РЭС.
 useEffect(()=>{if(mode!=='NEW'||!numberValid||isCreated){setDupes([]);return;}let active=true;const timer=setTimeout(()=>{api(`/api/v1/contract-acts?contractNumber=${encodeURIComponent(contractNumber)}`).then(r=>{if(active)setDupes(r.filter((d:Row)=>(typeKey||'ACT_TP').split(',').includes(d.act_type)));}).catch(()=>{});},250);return()=>{active=false;clearTimeout(timer);};},[mode,numberValid,contractNumber,typeKey,isCreated,api]);
 // «Документ учтён» виден сразу, затем документ открывается сам.
 useEffect(()=>{if(!done)return;const timer=setTimeout(()=>onCreated(done),1600);return()=>clearTimeout(timer);},[done]);
 return <section className="card engineer-upload" aria-label="Загрузка документа инженером">
  <div className="navy-head upload-head">
   <b className="upload-head-title"><Icon name="newdoc" size={20}/>Новый документ</b>
   <span className="upload-head-help"><Icon name="alert" size={14}/>Технические данные заполняются автоматически из ТУ. Сканированные документы не читаются — загружайте только PDF, сформированные из Word или Excel.</span>
  </div>
  <div className="doc-type-switch upload-modes" role="group" aria-label="Вид загружаемого документа">
   {modes.map(([k,label])=><button key={k} type="button" aria-pressed={mode===k} disabled={locked||isCreated} onClick={()=>changeMode(k)}><Icon name={k==='NEW'?'newdoc':'extra'} size={16}/>{label}</button>)}
  </div>
  <p className="helper-text">{mode==='EXTRA'?'Выберите документ договора, вид дополнительного документа и загрузите один PDF.':'Загрузите ТУ — реквизиты заполнятся автоматически. Приложите акт ТП, уведомление или АВТУ: вид определяется по заголовку, скреплённые в одном PDF документы разделяются сами. ПСУ, предыдущий акт и поопорную схему можно приложить сразу или позже.'}</p>
  {error&&<p role="alert">{error}</p>}
  <form id="engineer-upload-form" onChange={()=>onDirty(true)} onSubmit={e=>{e.preventDefault();if(done)return;void action(async()=>{
   if(mode==='NEW'){
    if(!tu||!file||!report)throw new Error('Загрузите ТУ и документ (акт ТП, уведомление или АВТУ).');
    if(!numberValid)throw new Error('Номер договора ТП должен быть в формате ххххх-хх-хххххххх-х.');
    if(!isCreated&&dupes.length)throw new Error(`${dupes.map(d=>docNames[d.act_type]).join(', ')} по договору ${contractNumber} уже есть в системе — откройте существующий документ.`);
    if(new Set(types).size!==types.length)throw new Error('В файле два документа одного вида — по договору допускается один документ каждого вида.');
   }else if(!target||!file)throw new Error('Выберите документ договора и файл.');
   const card=Object.entries(cardDraft).filter(([,v])=>v.value.trim()).map(([code,v])=>({code,value:v.value,origin:v.origin}));
   const pending=Object.entries(extras).filter(([kind,extra])=>extra&&saved.current.extras[kind]!==extra) as [string,File][];
   const wait='wait' as const;const split=docs.length>1;
   const plan:Step[]=mode==='EXTRA'?[{key:'extra',label:extraKinds.find(([k])=>k===extraKind)![1],status:wait}]:[
    ...docs.filter(d=>!created[d.type]).map(d=>({key:'create:'+d.type,label:`${docNames[d.type]} по договору ${contractNumber}`,status:wait})),
    ...(saved.current.tu!==tu?[{key:'tu',label:'Технические условия',status:wait}]:isCreated?[{key:'tu-kept',label:'Технические условия',status:'done' as const,note:'уже загружены в этот документ'}]:[]),
    ...docs.filter(d=>saved.current.acts[d.type]!==file).map(d=>({key:'doc:'+d.type,label:`${docNames[d.type]} · версия 1${split?` · ${pagesText(d.range)}`:''}`,status:wait})),
    ...pending.map(([kind])=>({key:'x:'+kind,label:optional.find(([k])=>k===kind)?.[1]??kind,status:wait})),
    ...(card.length?[{key:'card',label:'Технические данные',status:wait}]:[])];
   plan.push({key:'count',label:'Учёт в реестре документов',status:wait});
   setSteps(plan);
   const mark=(key:string,status:Step['status'],note?:string)=>setSteps(list=>list.map(x=>x.key===key?{...x,status,note}:x));
   const step=async(key:string,fn:()=>Promise<string|void>)=>{if(!plan.some(x=>x.key===key))return;mark(key,'run');try{const note=await fn();mark(key,'done',note||undefined);}catch(err){mark(key,'fail',(err as Error).message);throw err;}};
   if(mode==='EXTRA'){
    await step('extra',async()=>{await uploadDocument(api,target,file!,extraKind);});
    await step('count',async()=>{await onRefresh();});onDirty(false);setDone(target);return;
   }
   const ids={...created};
   for(const d of docs)await step('create:'+d.type,async()=>{const a=await api('/api/v1/acts',{resId,...values,contractNumber,contractDate:values.contractDate||null,actNumber:contractNumber,actType:d.type});ids[d.type]=a.id;setCreated(c=>({...c,[d.type]:a.id}));});
   const main=ids[mainType];
   // ТУ — одна на договор: загружается в основной документ, остальные документы ссылаются на ту же редакцию.
   await step('tu',async()=>{const r=await uploadDocument(api,main,tu!,'TU');saved.current.tu=tu;
    const tuId=r.file?.technicalConditions?.id;if(tuId)for(const d of docs)if(d.type!==mainType){const a=await api(`/api/v1/acts/${ids[d.type]}`);if(a.technical_conditions_id!==tuId)await api(`/api/v1/acts/${ids[d.type]}/technical-conditions/select`,{technicalConditionsId:tuId,expectedRevision:a.revision});}});
   for(const d of docs)await step('doc:'+d.type,async()=>{await uploadDocument(api,ids[d.type],file!,d.type,'','',split?d.range:'');saved.current.acts[d.type]=file;});
   for(const [kind,extra]of pending)await step('x:'+kind,async()=>{await uploadDocument(api,main,extra,kind);saved.current.extras[kind]=extra;});
   await step('card',async()=>{for(const d of docs)await api(`/api/v1/acts/${ids[d.type]}/card`,{values:card});});
   await step('count',async()=>{await onRefresh();});
   onDirty(false);setDone(main);
  });}}>
   {areas.length>1&&<label className="res-field">РЭС<select name="resId" value={resId} disabled={locked||isCreated} onChange={e=>{setResId(e.target.value);setReport(undefined);setTu(undefined);setInputKey(k=>k+1);}}>{areas.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
   {mode==='EXTRA'?<>
    <div className="fields"><label>Поиск договора<input aria-label="Поиск договора для ТУ" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Документ договора<select aria-label="Карточка для ТУ" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Выберите документ</option>{targets.map(a=><option value={a.id} key={a.id}>{a.contract_number} {labels[a.act_type]}</option>)}</select></label></div>
    <div className="doc-type-switch extra-kinds" role="group" aria-label="Вид дополнительного документа">{extraKinds.map(([k,label])=><button key={k} type="button" aria-pressed={extraKind===k} disabled={locked} onClick={()=>setExtraKind(k)}><Icon name={k==='TU'?'file':'extra'} size={16}/>{label}</button>)}</div>
    <div className="file-list" key={inputKey}><FileTile title={extraKinds.find(([k])=>k===extraKind)![1]} ariaLabel="Файл загружаемого документа" file={file} disabled={locked} onFile={setFile}/></div>
   </>:<>
    <div className="file-list" key={inputKey}>
     <span className="file-list-caption">Обязательные документы</span>
     <FileTile title="Технические условия" ariaLabel="Файл технических условий" file={tu} disabled={locked||isCreated} onFile={f=>void readTu(f)}/>
     <FileTile title="Акт ТП / уведомление / АВТУ" ariaLabel="Файл загружаемого документа" file={file} disabled={locked||isCreated} onFile={f=>void readDocument(f)}/>
     {(inspecting||docs.length>0)&&<div className="doc-parts" role="list" aria-label="Документы в файле">
      {inspecting&&<p role="status" className="doc-parts-wait"><span className="up-spin"/>Читаем заголовок документа…</p>}
      {!inspecting&&docs.map((d,i)=><div key={i} role="listitem" className={`doc-part${d.guessed?' doc-part-guess':''}`}>
       <span className="doc-part-mark" aria-hidden="true"><Icon name={d.guessed?'alert':'check'} size={14}/></span>
       {d.guessed?<label className="doc-part-pick">Вид не определён по заголовку<select aria-label={`Вид документа ${i+1}`} value={d.type} disabled={locked||isCreated} onChange={e=>{const t=e.target.value;setParts(list=>list.map((x,j)=>j===i?{...x,type:t}:x));onDirty(true);}}>{Object.entries(docNames).map(([k,n])=><option key={k} value={k}>{n}</option>)}</select></label>
        :<span className="doc-part-name"><b>{docNames[d.type]}</b><small>{docTitles[d.type]}</small></span>}
       {d.range&&<span className="doc-part-pages">{pagesText(d.range)}</span>}
      </div>)}
      {!inspecting&&docs.length>1&&<small className="doc-parts-note">В файле {docs.length} документа — сохраним их отдельно, каждый со своим маршрутом согласования.</small>}
     </div>}
     <span className="file-list-caption">Дополнительные документы · можно приложить сейчас или позже</span>
     {optional.map(([k,label])=><FileTile key={k} optional title={label} ariaLabel={`Файл: ${label}`} file={extras[k]} disabled={locked} onFile={f=>{setExtras(x=>({...x,[k]:f}));onDirty(true);}}/>)}
    </div>
    {report?.notice&&<p role="status" className="helper-text">{report.notice}</p>}{extracting&&<p role="status">Читаем реквизиты ТУ…</p>}{report&&<p role="status">Реквизиты извлечены из ТУ. Проверьте значения; пустые или неоднозначные поля заполните по ТУ.</p>}
    <div className="fields">
     {([['contractNumber','Номер договора','text'],['contractDate','Дата договора','date'],['applicant','Заявитель','text'],['address','Адрес объекта','text']] as const).map(([name,label,inputType])=>{
      const status=report?.fields[name]?.status;const badNumber=name==='contractNumber'&&!!values.contractNumber&&!numberValid;
      return <label key={name} className={name==='address'||name==='applicant'?'wide':undefined}>{label}<input aria-label={label} name={name} type={inputType} value={values[name]} required={name==='contractNumber'} maxLength={2000} placeholder={name==='contractNumber'?'ххххх-хх-хххххххх-х':undefined} aria-invalid={badNumber||undefined} readOnly={isCreated} disabled={locked} onBlur={name==='contractNumber'?()=>setValues(v=>({...v,contractNumber:normalizeContractNumber(v.contractNumber)})):undefined} onChange={e=>setValues(v=>({...v,[name]:e.target.value}))}/>
       {badNumber?<small className="field-error">Формат: ххххх-хх-хххххххх-х, например 00123-26-00004567-1.</small>:name==='contractDate'&&docDate&&values.contractDate===docDate?<small className="field-source">из документа</small>:report&&status!=='FOUND'&&<small>Не определено однозначно — проверьте по ТУ.</small>}</label>;
     })}
    </div>
    {fields.length>0&&<section className="upload-card" aria-label="Технические данные">
     <div className="tech-head"><h3><Icon name="data" size={18}/>Технические данные</h3>
     <p>Мощность, напряжение и фазность заполняются из ТУ. Планируемую дату исполнения укажите вручную. Обязательные поля (*) нужны для отправки на согласование.</p></div>
     <CardInputs fields={fields} draft={cardDraft} onChange={d=>{setCardDraft(d);onDirty(true);}} disabled={locked} suggestions={report?.card}/>
    </section>}
   </>}
   {mode==='NEW'&&numberValid&&<p className="helper-text">Пакет договора: <strong>{contractNumber}</strong> · {(types.length?types:['ACT_TP']).map(t=>`${contractNumber} ${labels[t]}`).join(' · ')} · {contractNumber} ТУ</p>}
   {mode==='NEW'&&!isCreated&&dupes.length>0&&<div role="alert" className="dup-warning">
    <Icon name="alert" size={22}/>
    <div className="dup-text"><b>{[...new Set(dupes.map(d=>docNames[d.act_type]))].join(', ')} по договору {contractNumber} уже есть в системе</b>
     {dupes.map((d,i)=><p key={d.id??i}>{d.res_name} · {stateNames[d.state]??d.state}{d.readable&&!d.versions?' · файл акта ещё не загружен':''}</p>)}
     <small>Номер договора уникален — второй документ того же вида не создаётся.</small></div>
    <div className="dup-actions">{dupes.filter(d=>d.own_draft&&!d.versions).slice(0,1).map(d=><button key={'c'+d.id} type="button" className="primary-button" onClick={()=>{if(d.has_tu)saved.current.tu=tu;setCreated(c=>({...c,[d.act_type]:d.id}));setDupes([]);}}><Icon name="upload" size={16}/>Догрузить в этот черновик</button>)}
     {dupes.filter(d=>d.readable).slice(0,1).map(d=><button key={'o'+d.id} type="button" className="secondary-button" onClick={()=>{onDirty(false);onCreated(d.id);}}><Icon name="view" size={16}/>Открыть документ</button>)}</div>
   </div>}
   {steps.length>0&&<UploadProgress steps={steps}/>}
   {done?<div role="status" className="upload-done">
    <span className="upload-done-mark" aria-hidden="true"><Icon name="check" size={22}/></span>
    <div className="upload-done-text"><b>Документ учтён</b><small>{mode==='EXTRA'?'Файл приложен к документу. Открываем документ…':<>Добавлен в «Черновики»{drafts!==undefined?<> — теперь там <b className="upload-done-count">{drafts}</b></>:null}. Открываем документ…</>}</small></div>
    <button type="button" className="primary-button" onClick={()=>onCreated(done)}><Icon name="view" size={16}/>Открыть документ</button>
   </div>:isCreated&&steps.some(x=>x.status==='fail')&&<p role="status" className="helper-text">Документ уже создан — «Сохранить документ» повторит только невыполненные шаги. <button type="button" className="text-button" onClick={()=>{onDirty(false);onCreated(created[mainType]??Object.values(created)[0]);}}>Открыть сохранённый документ</button></p>}
   {!done&&<div className="upload-submit"><button className="primary-button" disabled={locked||(mode==='EXTRA'?!target||!file:!report||!file||!docs.length||!numberValid||!isCreated&&dupes.length>0)}>{mode==='EXTRA'?(extraKind==='TU'?'Загрузить ТУ':'Загрузить документ'):'Сохранить документ'}</button><small>{mode==='EXTRA'?'Документ появится в пакете выбранного документа и в режиме проверки для сравнения.':'После сохранения откроется документ с проверкой соответствия ТУ и отправкой на согласование. Только PDF из Word или Excel — сканы не принимаются.'}</small></div>}
  </form>
 </section>;
}
