import {useEffect,useRef,useState,type ReactNode} from 'react';
import {uploadDocument} from './document-upload.js';
import {Icon} from './Ui.js';
import {CONTRACT_NUMBER_PATTERN,normalizeContractNumber} from './workplace.js';
import {CardInputs,type CardField,type CardDraft} from './DocumentCard.js';
type Row=Record<string,any>;
const labels:Record<string,string>={ACT_TP:'АКТ ТП',AVTU:'АВТУ',TU:'ТУ'};
/** Режимы формы (решение владельца 06.11.2026): новый документ (Акт ТП или АВТУ — переключатель внутри) и доп. документы. */
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
 const [resId,setResId]=useState(areas[0]?.id??''),[mode,setMode]=useState<'NEW'|'EXTRA'>('NEW'),[type,setType]=useState('ACT_TP'),[extraKind,setExtraKind]=useState('TU'),[extras,setExtras]=useState<Record<string,File|undefined>>({}),[file,setFile]=useState<File>(),[tu,setTu]=useState<File>(),[query,setQuery]=useState(''),[targets,setTargets]=useState<Row[]>([]),[target,setTarget]=useState(''),[error,setError]=useState(''),[created,setCreated]=useState<string>(),[extracting,setExtracting]=useState(false),[report,setReport]=useState<Row>();
 const [values,setValues]=useState({contractNumber:'',contractDate:'',applicant:'',address:''});
 const [inputKey,setInputKey]=useState(0);
 const [fields,setFields]=useState<CardField[]>([]),[cardDraft,setCardDraft]=useState<CardDraft>({});
 const [steps,setSteps]=useState<Step[]>([]),[done,setDone]=useState<string>(),[dupes,setDupes]=useState<Row[]>([]);
 useEffect(()=>{let active=true;api('/api/v1/card-fields').then(f=>{if(active)setFields(f);}).catch(()=>{});return()=>{active=false;};},[api]);
 const request=useRef(0),saved=useRef({tu:undefined as File|undefined,act:undefined as File|undefined,extras:{} as Record<string,File|undefined>});
 useEffect(()=>()=>{request.current++;},[]);
 useEffect(()=>{if(mode!=='EXTRA')return;let active=true;const timer=setTimeout(()=>{api('/api/v1/registry?view=preparation&limit=100&q='+encodeURIComponent(query)).then(r=>{if(active)setTargets(r.items.filter((a:Row)=>['DRAFT','RETURNED','REVISING'].includes(a.state)));}).catch(e=>{if(active)setError(e.message);});},200);return()=>{active=false;clearTimeout(timer);};},[mode,query,api]);
 const readTu=async(selected:File|undefined)=>{
  setTu(selected);setReport(undefined);setError('');const seq=++request.current;onDirty(true);
  if(!selected){setExtracting(false);return;}setExtracting(true);
  try{const data=new FormData();data.append('resId',resId);data.append('file',selected);const result=await api('/api/v1/documents/extract-tu',data);if(seq!==request.current)return;if(result.preparedFile){const decoded=Uint8Array.from(atob(result.preparedFile.base64),(c:string)=>c.charCodeAt(0));setTu(new File([decoded],selected.name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));}setReport(result);setCardDraft(d=>{const next={...d};for(const f of fields)if(f.tu_source){const sug=result.card?.[f.tu_source];if(sug?.value)next[f.code]={value:sug.value,origin:'TU'};else if(next[f.code]?.origin==='TU')delete next[f.code];}return next;});setValues({contractNumber:result.fields.contractNumber.value,contractDate:result.fields.contractDate.value,applicant:result.fields.applicant.value,address:result.fields.address.value});}
  catch(e){if(seq===request.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(seq===request.current)setExtracting(false);}
 };
 const changeMode=(next:'NEW'|'EXTRA')=>{if(next===mode)return;request.current++;setMode(next);setFile(undefined);setTu(undefined);setExtras({});setReport(undefined);setError('');setInputKey(k=>k+1);};
 // Акт ТП / АВТУ — переключатель внутри формы нового документа; выбранные файлы и реквизиты ТУ сохраняются.
 const changeType=(next:string)=>{if(next===type)return;setType(next);onDirty(true);};
 const locked=busy||extracting;
 const contractNumber=normalizeContractNumber(values.contractNumber);
 const numberValid=CONTRACT_NUMBER_PATTERN.test(contractNumber);
 const actLabel=type==='AVTU'?'АВТУ':'Акт ТП';
 // Номер договора уникален: о существующем документе того же вида предупреждаем до сохранения, во всех РЭС.
 useEffect(()=>{if(mode!=='NEW'||!numberValid||created){setDupes([]);return;}let active=true;const timer=setTimeout(()=>{api(`/api/v1/contract-acts?contractNumber=${encodeURIComponent(contractNumber)}&actType=${type}`).then(r=>{if(active)setDupes(r);}).catch(()=>{});},250);return()=>{active=false;clearTimeout(timer);};},[mode,numberValid,contractNumber,type,created,api]);
 // «Документ учтён» виден сразу, затем документ открывается сам.
 useEffect(()=>{if(!done)return;const timer=setTimeout(()=>onCreated(done),1600);return()=>clearTimeout(timer);},[done]);
 return <section className="card engineer-upload" aria-label="Загрузка документа инженером">
  <div className="navy-head upload-head">
   <b className="upload-head-title"><Icon name="newdoc" size={20}/>Новый документ</b>
   <span className="upload-head-help"><Icon name="alert" size={14}/>Технические данные заполняются автоматически из ТУ. Сканированные документы не читаются — загружайте только PDF, сформированные из Word или Excel.</span>
  </div>
  <div className="doc-type-switch upload-modes" role="group" aria-label="Вид загружаемого документа">
   {modes.map(([k,label])=><button key={k} type="button" aria-pressed={mode===k} disabled={locked||!!created} onClick={()=>changeMode(k)}><Icon name={k==='NEW'?'newdoc':'extra'} size={16}/>{label}</button>)}
  </div>
  <p className="helper-text">{mode==='EXTRA'?'Выберите документ договора, вид дополнительного документа и загрузите один PDF.':`Загрузите ТУ — реквизиты заполнятся автоматически. Проверьте их и приложите ${type==='AVTU'?'АВТУ':'акт ТП'}. ПСУ, предыдущий акт и поопорную схему можно приложить сразу или позже.`}</p>
  {error&&<p role="alert">{error}</p>}
  <form id="engineer-upload-form" onChange={()=>onDirty(true)} onSubmit={e=>{e.preventDefault();if(done)return;void action(async()=>{
   if(mode==='NEW'){
    if(!tu||!file||!report)throw new Error(`Загрузите ТУ и ${type==='AVTU'?'АВТУ':'акт ТП'}.`);
    if(!numberValid)throw new Error('Номер договора ТП должен быть в формате ххххх-хх-хххххххх-х.');
    if(!created&&dupes.length)throw new Error(`${actLabel} по договору ${contractNumber} уже есть в системе — откройте существующий документ.`);
   }else if(!target||!file)throw new Error('Выберите документ договора и файл.');
   const card=Object.entries(cardDraft).filter(([,v])=>v.value.trim()).map(([code,v])=>({code,value:v.value,origin:v.origin}));
   const pending=Object.entries(extras).filter(([kind,extra])=>extra&&saved.current.extras[kind]!==extra) as [string,File][];
   const wait='wait' as const;
   const plan:Step[]=mode==='EXTRA'?[{key:'extra',label:extraKinds.find(([k])=>k===extraKind)![1],status:wait}]:[
    ...(!created?[{key:'create',label:`Документ по договору ${contractNumber}`,status:wait}]:[]),
    ...(saved.current.tu!==tu?[{key:'tu',label:'Технические условия',status:wait}]:created?[{key:'tu-kept',label:'Технические условия',status:'done' as const,note:'уже загружены в этот документ'}]:[]),
    ...(saved.current.act!==file?[{key:'act',label:`${actLabel} · версия 1`,status:wait}]:[]),
    ...pending.map(([kind])=>({key:'x:'+kind,label:optional.find(([k])=>k===kind)?.[1]??kind,status:wait})),
    ...(card.length?[{key:'card',label:'Технические данные',status:wait}]:[])];
   plan.push({key:'count',label:'Учёт в реестре документов',status:wait});
   setSteps(plan);
   const mark=(key:string,status:Step['status'],note?:string)=>setSteps(list=>list.map(x=>x.key===key?{...x,status,note}:x));
   const step=async(key:string,fn:()=>Promise<string|void>)=>{if(!plan.some(x=>x.key===key))return;mark(key,'run');try{const note=await fn();mark(key,'done',note||undefined);}catch(err){mark(key,'fail',(err as Error).message);throw err;}};
   let actId=mode==='EXTRA'?target:created;
   await step('extra',async()=>{await uploadDocument(api,target,file!,extraKind);});
   await step('create',async()=>{const a=await api('/api/v1/acts',{resId,...values,contractNumber,contractDate:values.contractDate||null,actNumber:contractNumber,actType:type});actId=a.id;setCreated(a.id);});
   await step('tu',async()=>{await uploadDocument(api,actId!,tu!,'TU');saved.current.tu=tu;});
   await step('act',async()=>{await uploadDocument(api,actId!,file!,type);saved.current.act=file;});
   for(const [kind,extra]of pending)await step('x:'+kind,async()=>{await uploadDocument(api,actId!,extra,kind);saved.current.extras[kind]=extra;});
   await step('card',async()=>{await api(`/api/v1/acts/${actId}/card`,{values:card});});
   await step('count',async()=>{await onRefresh();});
   onDirty(false);setDone(actId);
  });}}>
   {areas.length>1&&<label className="res-field">РЭС<select name="resId" value={resId} disabled={locked||!!created} onChange={e=>{setResId(e.target.value);setReport(undefined);setTu(undefined);setInputKey(k=>k+1);}}>{areas.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
   {mode==='EXTRA'?<>
    <div className="fields"><label>Поиск договора<input aria-label="Поиск договора для ТУ" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Документ договора<select aria-label="Карточка для ТУ" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Выберите документ</option>{targets.map(a=><option value={a.id} key={a.id}>{a.contract_number} {labels[a.act_type]}</option>)}</select></label></div>
    <div className="doc-type-switch extra-kinds" role="group" aria-label="Вид дополнительного документа">{extraKinds.map(([k,label])=><button key={k} type="button" aria-pressed={extraKind===k} disabled={locked} onClick={()=>setExtraKind(k)}><Icon name={k==='TU'?'file':'extra'} size={16}/>{label}</button>)}</div>
    <div className="file-list" key={inputKey}><FileTile title={extraKinds.find(([k])=>k===extraKind)![1]} ariaLabel="Файл загружаемого документа" file={file} disabled={locked} onFile={setFile}/></div>
   </>:<>
    <div className="file-list" key={inputKey}>
     <span className="file-list-caption">Обязательные документы</span>
     <FileTile title="Технические условия" ariaLabel="Файл технических условий" file={tu} disabled={locked||!!created} onFile={f=>void readTu(f)}/>
     <FileTile title={actLabel} ariaLabel="Файл загружаемого документа" file={file} disabled={locked} onFile={setFile}>
      <div className="doc-type-switch act-kind" role="group" aria-label="Акт ТП или АВТУ">{(['ACT_TP','AVTU'] as const).map(k=><button key={k} type="button" aria-pressed={type===k} disabled={locked||!!created} onClick={()=>changeType(k)}><Icon name={k==='AVTU'?'form':'file'} size={16}/>{k==='AVTU'?'АВТУ':'Акт ТП'}</button>)}</div>
     </FileTile>
     <span className="file-list-caption">Дополнительные документы · можно приложить сейчас или позже</span>
     {optional.map(([k,label])=><FileTile key={k} optional title={label} ariaLabel={`Файл: ${label}`} file={extras[k]} disabled={locked} onFile={f=>{setExtras(x=>({...x,[k]:f}));onDirty(true);}}/>)}
    </div>
    {report?.notice&&<p role="status" className="helper-text">{report.notice}</p>}{extracting&&<p role="status">Читаем реквизиты ТУ…</p>}{report&&<p role="status">Реквизиты извлечены из ТУ. Проверьте значения; пустые или неоднозначные поля заполните по ТУ.</p>}
    <div className="fields">
     {([['contractNumber','Номер договора','text'],['contractDate','Дата договора','date'],['applicant','Заявитель','text'],['address','Адрес объекта','text']] as const).map(([name,label,inputType])=>{
      const status=report?.fields[name]?.status;const badNumber=name==='contractNumber'&&!!values.contractNumber&&!numberValid;
      return <label key={name} className={name==='address'||name==='applicant'?'wide':undefined}>{label}<input aria-label={label} name={name} type={inputType} value={values[name]} required={name==='contractNumber'} maxLength={2000} placeholder={name==='contractNumber'?'ххххх-хх-хххххххх-х':undefined} aria-invalid={badNumber||undefined} readOnly={!!created} disabled={locked} onBlur={name==='contractNumber'?()=>setValues(v=>({...v,contractNumber:normalizeContractNumber(v.contractNumber)})):undefined} onChange={e=>setValues(v=>({...v,[name]:e.target.value}))}/>
       {badNumber?<small className="field-error">Формат: ххххх-хх-хххххххх-х, например 00123-26-00004567-1.</small>:report&&status!=='FOUND'&&<small>Не определено однозначно — проверьте по ТУ.</small>}</label>;
     })}
    </div>
    {fields.length>0&&<section className="upload-card" aria-label="Технические данные">
     <div className="tech-head"><h3><Icon name="data" size={18}/>Технические данные</h3>
     <p>Мощность, напряжение и фазность заполняются из ТУ. Планируемую дату исполнения укажите вручную. Обязательные поля (*) нужны для отправки на согласование.</p></div>
     <CardInputs fields={fields} draft={cardDraft} onChange={d=>{setCardDraft(d);onDirty(true);}} disabled={locked} suggestions={report?.card}/>
    </section>}
   </>}
   {mode==='NEW'&&numberValid&&<p className="helper-text">Пакет договора: <strong>{contractNumber}</strong> · {contractNumber} {labels[type]} · {contractNumber} ТУ</p>}
   {mode==='NEW'&&!created&&dupes.length>0&&<div role="alert" className="dup-warning">
    <Icon name="alert" size={22}/>
    <div className="dup-text"><b>{actLabel} по договору {contractNumber} уже есть в системе</b>
     {dupes.map((d,i)=><p key={d.id??i}>{d.res_name} · {stateNames[d.state]??d.state}{d.readable&&!d.versions?' · файл акта ещё не загружен':''}</p>)}
     <small>Номер договора уникален — второй документ того же вида не создаётся.</small></div>
    <div className="dup-actions">{dupes.filter(d=>d.own_draft&&!d.versions).slice(0,1).map(d=><button key={'c'+d.id} type="button" className="primary-button" onClick={()=>{if(d.has_tu)saved.current.tu=tu;setCreated(d.id);setDupes([]);}}><Icon name="upload" size={16}/>Догрузить в этот черновик</button>)}
     {dupes.filter(d=>d.readable).slice(0,1).map(d=><button key={'o'+d.id} type="button" className="secondary-button" onClick={()=>{onDirty(false);onCreated(d.id);}}><Icon name="view" size={16}/>Открыть документ</button>)}</div>
   </div>}
   {steps.length>0&&<UploadProgress steps={steps}/>}
   {done?<div role="status" className="upload-done">
    <span className="upload-done-mark" aria-hidden="true"><Icon name="check" size={22}/></span>
    <div className="upload-done-text"><b>Документ учтён</b><small>{mode==='EXTRA'?'Файл приложен к документу. Открываем документ…':<>Добавлен в «Черновики»{drafts!==undefined?<> — теперь там <b className="upload-done-count">{drafts}</b></>:null}. Открываем документ…</>}</small></div>
    <button type="button" className="primary-button" onClick={()=>onCreated(done)}><Icon name="view" size={16}/>Открыть документ</button>
   </div>:created&&steps.some(x=>x.status==='fail')&&<p role="status" className="helper-text">Документ уже создан — «Сохранить документ» повторит только невыполненные шаги. <button type="button" className="text-button" onClick={()=>{onDirty(false);onCreated(created);}}>Открыть сохранённый документ</button></p>}
   {!done&&<div className="upload-submit"><button className="primary-button" disabled={locked||(mode==='EXTRA'?!target||!file:!report||!file||!numberValid||!created&&dupes.length>0)}>{mode==='EXTRA'?(extraKind==='TU'?'Загрузить ТУ':'Загрузить документ'):'Сохранить документ'}</button><small>{mode==='EXTRA'?'Документ появится в пакете выбранного документа и в режиме проверки для сравнения.':'После сохранения откроется документ с проверкой соответствия ТУ и отправкой на согласование. Только PDF из Word или Excel — сканы не принимаются.'}</small></div>}
  </form>
 </section>;
}
