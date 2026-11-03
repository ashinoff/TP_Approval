import {useEffect,useRef,useState} from 'react';
import {uploadDocument} from './document-upload.js';
type Row=Record<string,any>;
const labels:Record<string,string>={ACT_TP:'АКТ ТП',AVTU:'АВТУ',TU:'ТУ'};
export default function EngineerUpload({api,action,busy,resUnits,profile,onCreated,onDirty}:{api:(p:string,b?:object|FormData)=>Promise<any>;action:(fn:()=>Promise<unknown>)=>Promise<void>;busy:boolean;resUnits:Row[];profile:Row;onCreated:(id:string)=>void;onDirty:(dirty:boolean)=>void}){
 const areas=resUnits.filter(r=>profile.roles.some((role:Row)=>role.role==='RIRU_ENGINEER'&&role.resId===r.id));
 const [opened,setOpened]=useState(false);
 const [resId,setResId]=useState(areas[0]?.id??''),[type,setType]=useState('ACT_TP'),[file,setFile]=useState<File>(),[tu,setTu]=useState<File>(),[query,setQuery]=useState(''),[targets,setTargets]=useState<Row[]>([]),[target,setTarget]=useState(''),[error,setError]=useState(''),[created,setCreated]=useState<string>(),[extracting,setExtracting]=useState(false),[report,setReport]=useState<Row>();
 const [values,setValues]=useState({contractNumber:'',contractDate:'',applicant:'',address:''});
 const request=useRef(0),form=useRef<HTMLFormElement>(null),saved=useRef({tu:undefined as File|undefined,act:undefined as File|undefined});
 useEffect(()=>()=>{request.current++;},[]);
 useEffect(()=>{if(type!=='TU')return;let active=true;const timer=setTimeout(()=>{api('/api/v1/registry?view=preparation&limit=100&q='+encodeURIComponent(query)).then(r=>{if(active)setTargets(r.items.filter((a:Row)=>['DRAFT','RETURNED','REVISING'].includes(a.state)));}).catch(e=>{if(active)setError(e.message);});},200);return()=>{active=false;clearTimeout(timer);};},[type,query,api]);
 const readTu=async(selected:File|undefined)=>{
  setTu(selected);setReport(undefined);setError('');const seq=++request.current;onDirty(true);
  if(!selected){setExtracting(false);return;}setExtracting(true);
  try{const data=new FormData();data.append('resId',resId);data.append('file',selected);const result=await api('/api/v1/documents/extract-tu',data);if(seq!==request.current)return;if(result.preparedFile){const decoded=Uint8Array.from(atob(result.preparedFile.base64),(c:string)=>c.charCodeAt(0));setTu(new File([decoded],selected.name,{type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}));}setReport(result);setValues({contractNumber:result.fields.contractNumber.value,contractDate:result.fields.contractDate.value,applicant:result.fields.applicant.value,address:result.fields.address.value});}
  catch(e){if(seq===request.current)setError(e instanceof Error?e.message:String(e));}
  finally{if(seq===request.current)setExtracting(false);}
 };
 const locked=busy||extracting;
 if(!opened)return <button className="primary-button" onClick={()=>setOpened(true)}>Создать документ</button>;
 return <section className="card engineer-upload" aria-label="Загрузка документа инженером"><h2>Создать документ</h2><p>Сначала загрузите ТУ — реквизиты пакета заполнятся автоматически. Проверьте их и приложите акт ТП либо АВТУ.</p>{error&&<p role="alert">{error}</p>}
 <form ref={form} id="engineer-upload-form" onChange={()=>onDirty(true)} onSubmit={e=>{e.preventDefault();void action(async()=>{
  if(type==='TU'){if(!target||!file)throw new Error('Выберите документ договора и файл ТУ.');await uploadDocument(api,target,file,'TU');onDirty(false);onCreated(target);return;}
  if(!tu||!file||!report)throw new Error('Загрузите и проверьте ТУ, затем приложите акт ТП или АВТУ.');
  let actId=created;if(!actId){const a=await api('/api/v1/acts',{resId,...values,contractDate:values.contractDate||null,actNumber:values.contractNumber,actType:type});actId=a.id;setCreated(actId);}
  if(saved.current.tu!==tu){await uploadDocument(api,actId!,tu,'TU');saved.current.tu=tu;}
  if(saved.current.act!==file){await uploadDocument(api,actId!,file,type);saved.current.act=file;}
  onDirty(false);onCreated(actId!);
 });}}>
 <div className="fields"><label>РЭС<select name="resId" value={resId} disabled={locked||!!created} onChange={e=>{setResId(e.target.value);setReport(undefined);setTu(undefined);}}>{areas.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>
 <label>Вид загружаемого документа<select aria-label="Вид загружаемого документа" value={type} disabled={locked||!!created} onChange={e=>{request.current++;setType(e.target.value);setFile(undefined);setTu(undefined);setReport(undefined);setError('');if(form.current)form.current.querySelectorAll<HTMLInputElement>('input[type=file]').forEach(i=>{i.value='';});}}><option value="ACT_TP">Акт ТП</option><option value="AVTU">АВТУ</option><option value="TU">ТУ к существующему документу</option></select></label>
 {type==='TU'?<><label>Поиск договора<input aria-label="Поиск договора для ТУ" value={query} onChange={e=>setQuery(e.target.value)}/></label><label>Документ договора<select aria-label="Карточка для ТУ" required value={target} onChange={e=>setTarget(e.target.value)}><option value="">Выберите документ</option>{targets.map(a=><option value={a.id} key={a.id}>{a.contract_number} {labels[a.act_type]}</option>)}</select></label></>:<>
 <label>Технические условия DOCX<input aria-label="Файл технических условий" type="file" accept=".docx" required disabled={locked||!!created} onChange={e=>void readTu(e.target.files?.[0])}/></label>
 <label>Дата создания<input aria-label="Дата создания" value={new Date().toLocaleDateString('ru-RU')} readOnly/></label>
 {report?.notice&&<p role="status" className="helper-text">{report.notice}</p>}{extracting&&<p role="status">Читаем реквизиты ТУ…</p>}{report&&<p role="status">Реквизиты извлечены локально. Проверьте значения; пустые или неоднозначные поля заполните по ТУ.</p>}
 {([['contractNumber','Номер договора','text'],['contractDate','Дата договора','date'],['applicant','Заявитель','text'],['address','Адрес объекта','text']] as const).map(([name,label,inputType])=><label key={name}>{label}<input aria-label={label} name={name} type={inputType} value={values[name]} required={name==='contractNumber'} maxLength={2000} readOnly={!!created} disabled={locked} onChange={e=>setValues(v=>({...v,[name]:e.target.value}))}/>{report?.fields[name].status!=='FOUND'&&report&&<small>Не определено однозначно — проверьте по ТУ.</small>}</label>)}
 <label>Номер документа<input name="actNumber" value={values.contractNumber} readOnly/></label></>}
 <label>{type==='TU'?'Файл ТУ DOCX':'Файл акта DOCX'}<input aria-label="Файл загружаемого документа" type="file" accept=".docx" disabled={locked} required onChange={e=>setFile(e.target.files?.[0])}/></label></div>
 {type!=='TU'&&values.contractNumber&&<p className="helper-text">Пакет договора: <strong>{values.contractNumber}</strong> · {values.contractNumber} {labels[type]} · {values.contractNumber} ТУ</p>}
 {created&&<p role="status">Документ сохранён. Повторная попытка продолжит загрузку в тот же документ. <button type="button" onClick={()=>{onDirty(false);onCreated(created);}}>Открыть сохранённый документ</button></p>}
 <button className="primary-button" disabled={locked||(type!=='TU'&&(!report||report.fields.contractNumber.status!=='FOUND'))}>{type==='TU'?'Загрузить ТУ':'Сохранить документ'}</button><small>После создания откроется документ с проверкой соответствия ТУ и отправкой на согласование. PDF и сканы пока не поддерживаются.</small></form></section>;
}
