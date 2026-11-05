import {useEffect,useState} from 'react';
import {dateTime} from './Ui.js';
import './accounts.css';
type Row=Record<string,any>;
type Book={code:'breakers'|'cables';title:string;rows:Row[];settings:Row;revision:number;updated_at:string;updated_by_name?:string};

const groupName:Record<string,string>={'1ф':'Однофазный учёт, 0,23 кВ','3ф':'Трёхфазный учёт, 0,4 кВ','0.23':'0,23 кВ (однофазное)','0.38':'0,38 кВ (трёхфазное)'};
const num=(v:number)=>String(v).replace('.',',');
const parse=(v:string)=>Number(v.replace(',','.'));
const columns={
 breakers:[['phases','Учёт'],['from','Мощность от, кВт'],['to','до, кВт'],['breaker','ВА не выше, А'],['ct','ТТ не ниже']],
 cables:[['voltage','Напряжение'],['from','Мощность от, кВт'],['to','до, кВт'],['cores','Жил'],['section','Сечение не менее, мм²']],
} as const;
const blank={breakers:{phases:'3ф',from:0,to:0,breaker:0,ct:null},cables:{voltage:'0.38',from:0,to:0,cores:4,section:16}};
const groupKey=(code:Book['code'],r:Row)=>code==='breakers'?r.phases:r.voltage;

/**
 * Справочники номиналов для проверки акта: ВА и трансформаторы тока по мощности, минимальные сечения провода.
 * Видны всем; менять может только администратор. Каждое сохранение — новая ревизия: прежние отчёты сверки устаревают.
 */
export default function ReferenceBooks({api,canEdit}:{api:(p:string,b?:object)=>Promise<any>;canEdit:boolean}){
 const [books,setBooks]=useState<Book[]>([]),[tab,setTab]=useState<Book['code']>('breakers'),[draft,setDraft]=useState<{rows:Row[];brands:string}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const load=async()=>{try{setBooks(await api('/api/v1/references'));}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 const book=books.find(b=>b.code===tab);
 const switchTab=(code:Book['code'])=>{if(draft&&!window.confirm('Несохранённые изменения будут потеряны. Продолжить?'))return;setDraft(undefined);setError('');setTab(code);};
 const edit=()=>book&&setDraft({rows:book.rows.map(r=>({...r})),brands:(book.settings?.brands??[]).join(', ')});
 const save=async()=>{if(!draft)return;setBusy(true);setError('');
  try{const rows=draft.rows.map(r=>tab==='breakers'?{phases:r.phases,from:parse(String(r.from)),to:parse(String(r.to)),breaker:parse(String(r.breaker)),ct:String(r.ct??'').trim()||null}
    :{voltage:r.voltage,from:parse(String(r.from)),to:parse(String(r.to)),cores:parse(String(r.cores)),section:parse(String(r.section))});
   await api('/api/v1/admin/references/'+tab,tab==='cables'?{rows,brands:draft.brands.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean)}:{rows});
   setDraft(undefined);await load();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const set=(i:number,key:string,v:string)=>setDraft(d=>d&&{...d,rows:d.rows.map((r,j)=>j===i?{...r,[key]:v}:r)});
 const cell=(r:Row,key:string)=>key==='phases'||key==='voltage'?groupName[r[key]]:key==='ct'?(r.ct??'не требуются'):key==='section'?`${r.cores}×${num(r.section)}`:num(r[key]);
 const input=(r:Row,i:number,key:string)=>key==='phases'?<select aria-label="Учёт" value={r.phases} onChange={e=>set(i,key,e.target.value)}><option value="1ф">1ф, 0,23 кВ</option><option value="3ф">3ф, 0,4 кВ</option></select>
  :key==='voltage'?<select aria-label="Напряжение" value={r.voltage} onChange={e=>set(i,key,e.target.value)}><option value="0.23">0,23 кВ</option><option value="0.38">0,38 кВ</option></select>
  :<input aria-label={key} inputMode="decimal" value={key==='ct'?(r.ct??''):String(r[key]).replace('.',',')} placeholder={key==='ct'?'не требуются':''} onChange={e=>set(i,key,e.target.value)}/>;
 const shownRows=(draft?.rows??book?.rows??[]);
 const cols=columns[tab].filter(([k])=>draft||tab!=='cables'||k!=='cores');
 return <section className="card reference-books" aria-label="Справочники">
  <div className="reference-head">
   <div className="queue-switch" role="group" aria-label="Справочник">{(['breakers','cables'] as const).map(code=><button key={code} type="button" aria-pressed={tab===code} onClick={()=>switchTab(code)}>{code==='breakers'?'ВА и трансформаторы тока':'Сечения провода'}</button>)}</div>
   {canEdit&&book&&!draft&&<button type="button" className="primary-button" onClick={edit}>Редактировать</button>}
  </div>
  <p className="helper-text">{tab==='breakers'
   ?'Номинал вводного автомата в акте должен быть не выше указанного для мощности объекта; если указаны трансформаторы тока — в акте они должны быть не ниже.'
   :'Сечение провода в акте и на схеме должно быть не меньше минимального для мощности объекта.'}
   {' '}Проверка выполняется при «Проверить по ТУ».{!canEdit&&' Изменять справочник может администратор.'}</p>
  {tab==='cables'&&book&&(draft?<label className="reference-brands">Марки, к которым применяется таблица (через запятую)<input value={draft.brands} onChange={e=>setDraft({...draft,brands:e.target.value})} placeholder="СИП"/></label>
   :<p className="reference-brands-note">Применяется к маркам: <b>{(book.settings?.brands??[]).join(', ')}</b>. Для других марок (ВВГ, АВВГ…) сечение проверяется вручную.</p>)}
  {error&&<p role="alert">{error}</p>}
  {book&&<div className="reference-table-wrap"><table className="reference-table"><thead><tr>{cols.map(([k,l])=><th key={k}>{l}</th>)}{draft&&<th/>}</tr></thead><tbody>
   {shownRows.map((r,i)=>{const first=i===0||groupKey(tab,shownRows[i-1])!==groupKey(tab,r);
    return <tr key={i} className={first&&!draft?'group-start':''}>{cols.map(([k])=><td key={k}>{draft?input(r,i,k):cell(r,k)}</td>)}
     {draft&&<td><button type="button" aria-label="Удалить строку" onClick={()=>setDraft({...draft,rows:draft.rows.filter((_,j)=>j!==i)})}>✕</button></td>}</tr>;})}
  </tbody></table></div>}
  {draft&&<div className="card-actions">
   <button type="button" onClick={()=>setDraft({...draft,rows:[...draft.rows,{...blank[tab]}]})}>Добавить строку</button>
   <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>Сохранить</button>
   <button type="button" disabled={busy} onClick={()=>{setDraft(undefined);setError('');}}>Отмена</button>
  </div>}
  {book&&<p className="helper-text reference-meta">Ревизия {book.revision}{book.updated_by_name?` · изменил ${book.updated_by_name}, ${dateTime(book.updated_at)}`:' · исходные значения'}</p>}
 </section>;
}
