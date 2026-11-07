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

/** Поле выбора файла в виде полноценной кнопки: название документа, кнопка, имя выбранного файла. */
function FileTile({title,ariaLabel,file,disabled,onFile,optional,children}:{title:string;ariaLabel:string;file?:File;disabled:boolean;onFile:(f:File|undefined)=>void;optional?:boolean;children?:ReactNode}){
 return <div className={`file-tile${file?' file-tile-ready':''}${optional?' file-tile-optional':''}`}>
  <span className="file-tile-title"><Icon name="file"/>{title}{optional&&<small>необязательно</small>}</span>{children}
  <label className={`primary-button file-button${disabled?' is-disabled':''}`}>Выбрать файл PDF
   <input className="sr-only" aria-label={ariaLabel} type="file" accept=".pdf,application/pdf" disabled={disabled} onChange={e=>onFile(e.target.files?.[0])}/>
  </label>
  <span className="file-name">{file?file.name:'Файл не выбран'}</span>
 </div>;
}

export default function EngineerUpload({api,action,busy,resUnits,profile,onCreated,onDirty}:{api:(p:string,b?:object|FormData)=>Promise<any>;action:(fn:()=>Promise<unknown>)=>Promise<unknown>;busy:boolean;resUnits:Row[];profile:Row;onCreated:(id:string)=>void;onDirty:(dirty:boolean)=>void}){
 const areas=resUnits.filter(r=>profile.roles.some((role:Row)=>role.role==='RIRU_ENGINEER'&&role.resId===r.id));
 const [resId,setResId]=useState(areas[0]?.id??''),[mode,setMode]=useState<'NEW'|'EXTRA'>('NEW'),[type,setType]=useState('ACT_TP'),[extraKind,setExtraKind]=useState('TU'),[extras,setExtras]=useState<Record<string,File|undefined>>({}),[file,setFile]=useState<File>(),[tu,setTu]=useState<File>(),[query,setQuery]=useState(''),[targets,setTargets]=useState<Row[]>([]),[target,setTarget]=useState(''),[error,setError]=useState(''),[created,setCreated]=useState<string>(),[extracting,setExtracting]=useState(false),[report,setReport]=useState<Row>();
 const [values,setValues]=useState({contractNumber:'',contractDate:'',applicant:'',address:''});
 const [inputKey,setInputKey]=useState(0);
 const [fields,setFields]=useState<CardField[]>([]),[cardDraft,setCardDraft]=useState<CardDraft>({});
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
 return <section className="card engineer-upload" aria-label="Загрузка документа инженером">
  <div className="doc-type-switch upload-modes" role="group" aria-label="Вид загружаемого документа">
   {modes.map(([k,label])=><button key={k} type="button" aria-pressed={mode===k} disabled={locked||!!created} onClick={()=>changeMode(k)}><Icon name={k==='NEW'?'newdoc':'extra'} size={16}/>{label}</button>)}
  </div>
  <p className="helper-text">{mode==='EXTRA'?'Выберите документ договора, вид дополнительного документа и загрузите один PDF.':`Загрузите ТУ — реквизиты заполнятся автоматически. Проверьте их и приложите ${type==='AVTU'?'АВТУ':'акт ТП'}. ПСУ, предыдущий акт и поопорную схему можно приложить сразу или позже.`}</p>
  {error&&<p role="alert">{error}</p>}
  <form id="engineer-upload-form" onChange={()=>onDirty(true)} onSubmit={e=>{e.preventDefault();void action(async()=>{
   if(mode==='EXTRA'){if(!target||!file)throw new Error('Выберите документ договора и файл.');await uploadDocument(api,target,file,extraKind);onDirty(false);onCreated(target);return;}
   if(!tu||!file||!report)throw new Error(`Загрузите ТУ и ${type==='AVTU'?'АВТУ':'акт ТП'}.`);
   if(!numberValid)throw new Error('Номер договора ТП должен быть в формате ххххх-хх-хххххххх-х.');
   let actId=created;if(!actId){const a=await api('/api/v1/acts',{resId,...values,contractNumber,contractDate:values.contractDate||null,actNumber:contractNumber,actType:type});actId=a.id;setCreated(actId);}
   if(saved.current.tu!==tu){await uploadDocument(api,actId!,tu,'TU');saved.current.tu=tu;}
   if(saved.current.act!==file){await uploadDocument(api,actId!,file,type);saved.current.act=file;}
   for(const [kind,extra]of Object.entries(extras))if(extra&&saved.current.extras[kind]!==extra){await uploadDocument(api,actId!,extra,kind);saved.current.extras[kind]=extra;}
   const card=Object.entries(cardDraft).filter(([,v])=>v.value.trim()).map(([code,v])=>({code,value:v.value,origin:v.origin}));
   if(card.length)await api(`/api/v1/acts/${actId}/card`,{values:card});
   onDirty(false);onCreated(actId!);
  });}}>
   {areas.length>1&&<label className="res-field">РЭС<select name="resId" value={resId} disabled={locked||!!created} onChange={e=>{setResId(e.target.value);setReport(undefined);setTu(undefined);setInputKey(k=>k+1);}}>{areas.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}
   {mode==='EXTRA'?<>
    <div className="fields"><label>Поиск договора<input aria-label="Поиск договора для ТУ" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Документ договора<select aria-label="Карточка для ТУ" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Выберите документ</option>{targets.map(a=><option value={a.id} key={a.id}>{a.contract_number} {labels[a.act_type]}</option>)}</select></label></div>
    <div className="doc-type-switch extra-kinds" role="group" aria-label="Вид дополнительного документа">{extraKinds.map(([k,label])=><button key={k} type="button" aria-pressed={extraKind===k} disabled={locked} onClick={()=>setExtraKind(k)}>{label}</button>)}</div>
    <div className="upload-pair single" key={inputKey}><FileTile title={extraKinds.find(([k])=>k===extraKind)![1]} ariaLabel="Файл загружаемого документа" file={file} disabled={locked} onFile={setFile}/></div>
   </>:<>
    <div className="upload-pair" key={inputKey}>
     <FileTile title="Технические условия" ariaLabel="Файл технических условий" file={tu} disabled={locked||!!created} onFile={f=>void readTu(f)}/>
     <FileTile title={actLabel} ariaLabel="Файл загружаемого документа" file={file} disabled={locked} onFile={setFile}>
      <div className="doc-type-switch act-kind" role="group" aria-label="Акт ТП или АВТУ">{(['ACT_TP','AVTU'] as const).map(k=><button key={k} type="button" aria-pressed={type===k} disabled={locked||!!created} onClick={()=>changeType(k)}><Icon name={k==='AVTU'?'form':'file'} size={16}/>{k==='AVTU'?'АВТУ':'Акт ТП'}</button>)}</div>
     </FileTile>
    </div>
    <div className="upload-pair upload-optional" key={'o'+inputKey}>
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
     <h3>Технические данные</h3>
     <p className="helper-text">Мощность, напряжение и фазность заполняются из ТУ. Планируемую дату исполнения укажите вручную. Обязательные поля (*) нужны для отправки на согласование.</p>
     <CardInputs fields={fields} draft={cardDraft} onChange={d=>{setCardDraft(d);onDirty(true);}} disabled={locked} suggestions={report?.card}/>
    </section>}
   </>}
   {mode==='NEW'&&numberValid&&<p className="helper-text">Пакет договора: <strong>{contractNumber}</strong> · {contractNumber} {labels[type]} · {contractNumber} ТУ</p>}
   {created&&<p role="status">Документ сохранён. Повторная попытка продолжит загрузку в тот же документ. <button type="button" onClick={()=>{onDirty(false);onCreated(created);}}>Открыть сохранённый документ</button></p>}
   <div className="upload-submit"><button className="primary-button" disabled={locked||(mode==='EXTRA'?!target||!file:!report||!file||!numberValid)}>{mode==='EXTRA'?(extraKind==='TU'?'Загрузить ТУ':'Загрузить документ'):'Сохранить документ'}</button><small>{mode==='EXTRA'?'Документ появится в пакете выбранного документа и в режиме проверки для сравнения.':'После сохранения откроется документ с проверкой соответствия ТУ и отправкой на согласование. Только PDF из Word или Excel — сканы не принимаются.'}</small></div>
  </form>
 </section>;
}
