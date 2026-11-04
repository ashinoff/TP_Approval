import {useEffect,useState} from 'react';
type Row=Record<string,any>;
export type CardField={code:string;label:string;kind:'text'|'number'|'date'|'select';unit:string|null;options:string[];required:boolean;tu_source:string|null;sort:number;active:boolean};
export type CardDraft=Record<string,{value:string;origin:'TU'|'MANUAL'}>;
const statusHint:Record<string,string>={AMBIGUOUS:'В ТУ несколько значений — выберите вручную.',NOT_FOUND:'В ТУ не найдено — заполните вручную.',DERIVED:'Определено по напряжению — проверьте.',INVALID_FORMAT:'Проверьте значение.'};
export const shownValue=(f:Pick<CardField,'kind'|'unit'>,v:string)=>f.kind==='number'?v.replace('.',','):f.kind==='date'?new Date(v+'T00:00:00Z').toLocaleDateString('ru-RU',{timeZone:'UTC'}):v;
const unitText=(f:CardField)=>f.unit?`, ${f.unit}`:'';

/** Поля карточки для ввода: значения из ТУ помечаются, ручная правка меняет происхождение на MANUAL. */
export function CardInputs({fields,draft,onChange,disabled,suggestions}:{fields:CardField[];draft:CardDraft;onChange:(d:CardDraft)=>void;disabled:boolean;suggestions?:Record<string,{status:string}>}){
 return <div className="card-fields">{fields.map(f=>{
  const cur=draft[f.code]?.value??'',hint=f.tu_source&&suggestions?statusHint[suggestions[f.tu_source]?.status]:undefined;
  const set=(value:string)=>onChange({...draft,[f.code]:{value,origin:'MANUAL'}});
  return <label key={f.code}><span>{f.label}{unitText(f)}{f.required&&<span className="card-required" title="Обязательно для отправки">*</span>}</span>
   {f.kind==='select'?<select aria-label={f.label} value={cur} disabled={disabled} onChange={e=>set(e.target.value)}><option value="">—</option>{f.options.map(o=><option key={o} value={o}>{f.kind==='select'&&f.unit?o.replace('.',','):o}</option>)}</select>
    :<input aria-label={f.label} type={f.kind==='date'?'date':'text'} inputMode={f.kind==='number'?'decimal':undefined} value={f.kind==='number'?cur.replace('.',','):cur} maxLength={2000} disabled={disabled} onChange={e=>set(e.target.value)}/>}
   {draft[f.code]?.origin==='TU'&&cur?<small className="card-origin">из ТУ</small>:hint?<small className="card-hint">{hint}</small>:null}
  </label>;})}</div>;
}
export const draftFromValues=(values:Row[]):CardDraft=>Object.fromEntries(values.map(v=>[v.field_code,{value:v.value,origin:v.origin}]));
export function changedValues(draft:CardDraft,saved:CardDraft){
 const codes=new Set([...Object.keys(draft),...Object.keys(saved)]);
 return [...codes].filter(c=>(draft[c]?.value??'').trim()!==(saved[c]?.value??'')||draft[c]?.origin!==saved[c]?.origin&&(draft[c]?.value??'')!=='')
  .map(c=>({code:c,value:(draft[c]?.value??'').trim()||null,origin:draft[c]?.origin??'MANUAL'}));
}

/** Карточка в рабочем месте документа: инженер правит в подготовке, остальные видят значения (у цикла — зафиксированный снимок). */
export default function DocumentCardPanel({detail,cycle,api,action,busy}:{detail:Row;cycle?:Row;api:(p:string,b?:object)=>Promise<any>;action:(fn:()=>Promise<unknown>)=>Promise<void>;busy:boolean}){
 const [fields,setFields]=useState<CardField[]>([]);
 const editable=detail.presentation.canPrepare&&['DRAFT','RETURNED','REVISING'].includes(detail.state)&&!cycle;
 const saved=draftFromValues(detail.card??[]);
 const savedKey=JSON.stringify(saved);
 const [draft,setDraft]=useState<CardDraft>(saved);
 useEffect(()=>{setDraft(JSON.parse(savedKey));},[savedKey]);
 useEffect(()=>{let active=true;api('/api/v1/card-fields').then(f=>{if(active)setFields(f);}).catch(()=>{});return()=>{active=false;};},[api]);
 const snapshot:Row|undefined=cycle?.card_snapshot??undefined;
 const missing=fields.filter(f=>f.required&&!saved[f.code]);
 const changes=changedValues(draft,saved);
 return <details className="side-block document-card" open={editable&&missing.length>0||undefined}>
  <summary>Карточка документа{missing.length&&!snapshot?<span className="card-missing"> · не заполнено {missing.length}</span>:null}</summary>
  {snapshot?<>
   <p className="helper-text">Зафиксировано при отправке цикла {cycle!.number}.</p>
   <dl className="card-view">{Object.entries(snapshot).length?Object.entries(snapshot).map(([code,v]:[string,any])=><div key={code}><dt>{v.label}</dt><dd>{shownValue({kind:fields.find(f=>f.code===code)?.kind??'text',unit:v.unit},v.value)}{v.unit?` ${v.unit}`:''}</dd></div>):<p className="helper-text">Карточка не заполнялась.</p>}</dl>
  </>:editable?<>
   <CardInputs fields={fields} draft={draft} onChange={setDraft} disabled={busy}/>
   <div className="card-actions">
    <button className="primary-button" disabled={busy||!changes.length} onClick={()=>void action(()=>api(`/api/v1/acts/${detail.id}/card`,{values:changes}))}>Сохранить карточку</button>
    {detail.technical_conditions_id&&<button type="button" className="secondary-button" disabled={busy} title="Заполнить мощность, напряжение и фазность из текущих ТУ. Значения, введённые вручную, не меняются." onClick={()=>void action(()=>api(`/api/v1/acts/${detail.id}/card/from-tu`,{}))}>Заполнить из ТУ</button>}
   </div>
   {missing.length>0&&<p className="helper-text">Для отправки на согласование заполните: {missing.map(f=>f.label).join(', ')}.</p>}
  </>:<dl className="card-view">{fields.filter(f=>saved[f.code]).map(f=><div key={f.code}><dt>{f.label}</dt><dd>{shownValue(f,saved[f.code].value)}{f.unit?` ${f.unit}`:''}</dd></div>)}{!Object.keys(saved).length&&<p className="helper-text">Карточка не заполнена.</p>}</dl>}
 </details>;
}
