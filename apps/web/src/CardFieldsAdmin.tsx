import {useEffect,useState} from 'react';
import './accounts.css';
import type {CardField} from './DocumentCard.js';
const kinds:Record<CardField['kind'],string>={text:'Текст',number:'Число',date:'Дата',select:'Список'};
const tuNames:Record<string,string>={power_kw:'мощность из ТУ',voltage_kv:'напряжение из ТУ',phases:'фазность из ТУ'};

/** Справочник полей карточки документа: администратор добавляет поля без доработки программы. */
export default function CardFieldsAdmin({api}:{api:(p:string,b?:object)=>Promise<any>}){
 const [fields,setFields]=useState<CardField[]>([]),[busy,setBusy]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState<string>();
 const load=async()=>{try{setFields(await api('/api/v1/card-fields?all=1'));}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 const run=async(fn:()=>Promise<unknown>)=>{setBusy(true);setError('');try{await fn();setEditing(undefined);await load();return true;}catch(e){setError((e as Error).message);return false;}finally{setBusy(false);}};
 const payload=(f:FormData,withKind:boolean)=>({label:String(f.get('label')),...(withKind?{kind:f.get('kind')}:{}),unit:String(f.get('unit')??'').trim()||null,
  options:String(f.get('options')??'').split('\n').map(s=>s.trim()).filter(Boolean),required:f.get('required')==='on',sort:Number(f.get('sort')||100)});
 const form=(field?:CardField)=><form className="card-field-form" onSubmit={e=>{e.preventDefault();const el=e.currentTarget,f=new FormData(el);void run(()=>field?api('/api/v1/admin/card-fields/'+field.code,payload(f,false)):api('/api/v1/admin/card-fields',payload(f,true))).then(done=>{if(done&&!field)el.reset();});}}>
  <label>Название<input name="label" required maxLength={200} defaultValue={field?.label}/></label>
  <label>Тип<select name="kind" defaultValue={field?.kind??'text'} disabled={!!field}>{Object.entries(kinds).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
  <label>Единица<input name="unit" maxLength={20} defaultValue={field?.unit??''} placeholder="кВт, кВ…"/></label>
  <label>Порядок<input name="sort" type="number" min={0} max={10000} defaultValue={field?.sort??100}/></label>
  <label className="wide">Варианты для списка (по одному в строке)<textarea name="options" rows={3} defaultValue={field?.options.join('\n')}/></label>
  <label className="inline-check"><input name="required" type="checkbox" defaultChecked={field?.required}/>Обязательно для отправки</label>
  <div className="card-actions"><button className="primary-button" disabled={busy}>{field?'Сохранить':'Добавить поле'}</button>{field&&<button type="button" onClick={()=>setEditing(undefined)}>Отмена</button>}</div>
 </form>;
 return <section className="card card-fields-admin" aria-label="Поля карточки документа">
  <p className="helper-text">Поля появляются в карточке каждого документа и в форме загрузки. Тип поля после создания не меняется; ненужное поле отключите — сохранённые значения останутся в истории.</p>
  {error&&<p role="alert">{error}</p>}
  <table className="card-fields-table"><thead><tr><th>Поле</th><th>Тип</th><th>Обязательно</th><th>Источник</th><th>Состояние</th><th/></tr></thead><tbody>
   {fields.map(f=><tr key={f.code} className={f.active?'':'inactive'}>{editing===f.code?<td colSpan={6}>{form(f)}</td>:<>
    <td><b>{f.label}</b>{f.unit&&<small> · {f.unit}</small>}{f.kind==='select'&&<small className="card-options">{f.options.join(' · ')}</small>}</td><td>{kinds[f.kind]}</td><td>{f.required?'да':'нет'}</td>
    <td>{f.tu_source?tuNames[f.tu_source]:'вручную'}</td><td>{f.active?'используется':'отключено'}</td>
    <td className="card-row-actions"><button type="button" disabled={busy} onClick={()=>setEditing(f.code)}>Изменить</button><button type="button" disabled={busy} onClick={()=>void run(()=>api('/api/v1/admin/card-fields/'+f.code,{active:!f.active}))}>{f.active?'Отключить':'Включить'}</button></td></>}
   </tr>)}
  </tbody></table>
  <h3>Новое поле</h3>{form()}
 </section>;
}
