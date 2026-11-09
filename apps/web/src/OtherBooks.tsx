import {useState} from 'react';
import {dateTime} from './Ui.js';

type Row=Record<string,any>;
export type OtherCode='tg'|'attorneys';
const num=(v:number)=>String(v).replace('.',',');
const ru=(d?:string|null)=>d?d.slice(0,10).split('-').reverse().join('.'):'';
const columns:Record<OtherCode,[string,string][]>={
 tg:[['voltage','Уровень напряжения, кВ'],['tg','Предельный tg φ']],
 attorneys:[['number','Номер'],['date','Дата'],['person','ФИО подписанта (как в документе)'],['position','Должность'],['validUntil','Действует до']],
};
const blank:Record<OtherCode,Row>={tg:{voltage:'',tg:''},attorneys:{number:'',date:'',person:'',position:'',validUntil:''}};
const help:Record<OtherCode,string>={
 tg:'Предельное значение коэффициента реактивной мощности по уровню напряжения. Проверка уведомления сверяет tg в таблице точек присоединения со значением для её напряжения.',
 attorneys:'Доверенности подписантов сетевой организации. Проверка уведомления находит в преамбуле «действующей на основании доверенности № … от …» и сверяет номер, дату, ФИО и срок действия.',
};

/** Справочники для проверки уведомления (09.11.2026): tg φ по напряжению и доверенности подписантов. Правит администратор. */
export default function OtherBook({code,book,canEdit,api,onSaved}:{code:OtherCode;book?:Row;canEdit:boolean;api:(p:string,b?:object)=>Promise<any>;onSaved:()=>Promise<void>}){
 const [draft,setDraft]=useState<Row[]>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const rows:Row[]=book?.rows??[];
 const save=async()=>{if(!draft)return;setBusy(true);setError('');
  try{const out=draft.map(r=>code==='tg'?{voltage:String(r.voltage).replace(',','.').trim(),tg:Number(String(r.tg).replace(',','.'))}
    :{number:String(r.number).trim(),date:r.date,person:String(r.person).trim(),position:String(r.position??'').trim(),validUntil:r.validUntil||null});
   await api('/api/v1/admin/references/'+code,{rows:out});setDraft(undefined);await onSaved();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const set=(i:number,k:string,v:string)=>setDraft(d=>d?.map((r,j)=>j===i?{...r,[k]:v}:r));
 const shown=(r:Row,k:string)=>k==='tg'?num(r.tg):k==='voltage'?`${num(Number(r.voltage))} кВ`:k==='date'||k==='validUntil'?(ru(r[k])||'—'):(r[k]||'—');
 return <div className="other-book">
  <p className="helper-text">{help[code]}{!canEdit&&' Изменять справочник может администратор.'}</p>
  {error&&<p role="alert">{error}</p>}
  {!draft?<>
   <div className="reference-table-wrap"><table className="reference-table other-table" aria-label={book?.title}><thead><tr>{columns[code].map(([k,l])=><th key={k}>{l}</th>)}</tr></thead><tbody>
    {rows.map((r,i)=><tr key={i}>{columns[code].map(([k])=><td key={k}>{shown(r,k)}</td>)}</tr>)}
    {!rows.length&&<tr><td colSpan={columns[code].length} className="ref-empty">{code==='attorneys'?'Доверенностей пока нет — добавьте их, иначе проверка доверенности потребует ручного подтверждения.':'Строк нет.'}</td></tr>}
   </tbody></table></div>
   {canEdit&&<div className="card-actions"><button type="button" className="primary-button" onClick={()=>setDraft(rows.map(r=>({...r,tg:r.tg!==undefined?num(r.tg):undefined,validUntil:r.validUntil??''})))}>Редактировать</button></div>}
  </>:<>
   <div className="reference-table-wrap"><table className="reference-table"><thead><tr>{columns[code].map(([k,l])=><th key={k}>{l}</th>)}<th/></tr></thead><tbody>
    {draft.map((r,i)=><tr key={i}>{columns[code].map(([k,l])=><td key={k}><input aria-label={l} type={k==='date'||k==='validUntil'?'date':'text'} inputMode={k==='tg'||k==='voltage'?'decimal':undefined} value={r[k]??''} placeholder={k==='person'?'Метелицкая Л.О.':k==='voltage'?'0,4':''} onChange={e=>set(i,k,e.target.value)}/></td>)}
     <td><button type="button" aria-label="Удалить строку" onClick={()=>setDraft(draft.filter((_,j)=>j!==i))}>✕</button></td></tr>)}
   </tbody></table></div>
   <div className="card-actions">
    <button type="button" onClick={()=>setDraft([...draft,{...blank[code]}])}>Добавить строку</button>
    <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>Сохранить</button>
    <button type="button" disabled={busy} onClick={()=>{setDraft(undefined);setError('');}}>Отмена</button>
   </div>
  </>}
  {book&&<p className="helper-text reference-meta">Ревизия {book.revision}{book.updated_by_name?` · изменил ${book.updated_by_name}, ${dateTime(book.updated_at)}`:''}</p>}
 </div>;
}
