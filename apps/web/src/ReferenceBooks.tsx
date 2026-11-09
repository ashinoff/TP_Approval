import {useEffect,useState} from 'react';
import {Icon,dateTime} from './Ui.js';
import './accounts.css';
import OtherBook,{type OtherCode} from './OtherBooks.js';
type Row=Record<string,any>;
type Book={code:'breakers'|'cables';title:string;rows:Row[];settings:Row;revision:number;updated_at:string;updated_by_name?:string};

const tabName:Record<Book['code']|OtherCode,string>={breakers:'ВА и ТТ',cables:'ВЛ и КЛ',tg:'tg φ',attorneys:'Доверенности'};
const tabIcon:Record<Book['code']|OtherCode,string>={breakers:'breaker',cables:'cable',tg:'zap',attorneys:'users'};
const groups:Record<Book['code'],[string,string][]>={breakers:[['1ф','1ф · 0,23 кВ'],['3ф','3ф · 0,4 кВ']],cables:[['0.23','0,23 кВ'],['0.38','0,38 кВ']]};
const groupName:Record<string,string>={'1ф':'Однофазный учёт, 0,23 кВ','3ф':'Трёхфазный учёт, 0,4 кВ','0.23':'0,23 кВ (однофазное)','0.38':'0,38 кВ (трёхфазное)'};
const num=(v:number)=>String(v).replace('.',',');
const parse=(v:string)=>Number(v.replace(',','.'));
const columns={
 breakers:[['phases','Учёт'],['from','Мощность от, кВт'],['to','до, кВт'],['breaker','ВА не выше, А'],['ct','ТТ не ниже']],
 cables:[['voltage','Напряжение'],['from','Мощность от, кВт'],['to','до, кВт'],['cores','Жил'],['section','Сечение не менее, мм²']],
} as const;
const blank={breakers:{phases:'3ф',from:0,to:0,breaker:0,ct:null},cables:{voltage:'0.38',from:0,to:0,cores:4,section:16}};
const groupKey=(code:Book['code'],r:Row)=>code==='breakers'?r.phases:r.voltage;
/** Расчётный ток при верхней границе мощности (cos φ = 1): 1ф — P/U, 3ф — P/(√3·U). Только для наглядности шкалы. */
const current=(code:Book['code'],r:Row)=>{const single=code==='breakers'?r.phases==='1ф':r.voltage==='0.23';const amps=single?r.to/0.23:r.to/(Math.sqrt(3)*(code==='breakers'?0.4:0.38));return Math.round(amps*10)/10;};
const norm=(code:Book['code'],r:Row)=>code==='breakers'?`ВА ≤ ${num(r.breaker)} А`:`${r.cores}×${num(r.section)} мм²`;

/**
 * Справочники номиналов для проверки акта: «ВА и ТТ» (вводной автомат и трансформаторы тока по мощности)
 * и «ВЛ и КЛ» (минимальные сечения провода). Просмотр — подбор по мощности и шкала диапазонов по группам;
 * правка (только администратор) — прежняя таблица. Каждое сохранение — новая ревизия: прежние отчёты сверки устаревают.
 */
export default function ReferenceBooks({api,canEdit}:{api:(p:string,b?:object)=>Promise<any>;canEdit:boolean}){
 const [books,setBooks]=useState<Book[]>([]),[tabAll,setTab]=useState<Book['code']|OtherCode>('breakers'),[draft,setDraft]=useState<{rows:Row[];brands:string}>(),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const [group,setGroup]=useState<Record<Book['code'],string>>({breakers:'3ф',cables:'0.38'}),[power,setPower]=useState('');
 const load=async()=>{try{setBooks(await api('/api/v1/references'));}catch(e){setError((e as Error).message);}};
 useEffect(()=>{void load();},[]);
 const tab:Book['code']=tabAll==='cables'?'cables':'breakers';const other=tabAll==='tg'||tabAll==='attorneys'?tabAll:undefined;
 const book=books.find(b=>b.code===tab);
 const switchTab=(code:Book['code']|OtherCode)=>{if(draft&&!window.confirm('Несохранённые изменения будут потеряны. Продолжить?'))return;setDraft(undefined);setError('');setTab(code);};
 const edit=()=>book&&setDraft({rows:book.rows.map(r=>({...r})),brands:(book.settings?.brands??[]).join(', ')});
 const save=async()=>{if(!draft)return;setBusy(true);setError('');
  try{const rows=draft.rows.map(r=>tab==='breakers'?{phases:r.phases,from:parse(String(r.from)),to:parse(String(r.to)),breaker:parse(String(r.breaker)),ct:String(r.ct??'').trim()||null}
    :{voltage:r.voltage,from:parse(String(r.from)),to:parse(String(r.to)),cores:parse(String(r.cores)),section:parse(String(r.section))});
   await api('/api/v1/admin/references/'+tab,tab==='cables'?{rows,brands:draft.brands.split(/[,;\n]/).map(s=>s.trim()).filter(Boolean)}:{rows});
   setDraft(undefined);await load();}
  catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const set=(i:number,key:string,v:string)=>setDraft(d=>d&&{...d,rows:d.rows.map((r,j)=>j===i?{...r,[key]:v}:r)});
 const input=(r:Row,i:number,key:string)=>key==='phases'?<select aria-label="Учёт" value={r.phases} onChange={e=>set(i,key,e.target.value)}><option value="1ф">1ф, 0,23 кВ</option><option value="3ф">3ф, 0,4 кВ</option></select>
  :key==='voltage'?<select aria-label="Напряжение" value={r.voltage} onChange={e=>set(i,key,e.target.value)}><option value="0.23">0,23 кВ</option><option value="0.38">0,38 кВ</option></select>
  :<input aria-label={key} inputMode="decimal" value={key==='ct'?(r.ct??''):String(r[key]).replace('.',',')} placeholder={key==='ct'?'не требуются':''} onChange={e=>set(i,key,e.target.value)}/>;

 // Просмотр: строки выбранной группы и подбор по введённой мощности.
 const g=group[tab];const rows=(book?.rows??[]).filter(r=>groupKey(tab,r)===g).sort((a,b)=>a.from-b.from);
 const max=Math.max(1,...rows.map(r=>r.to));const kw=power.trim()?parse(power):NaN;
 const picked=Number.isFinite(kw)?rows.find(r=>kw>=r.from&&kw<=r.to):undefined;const beyond=Number.isFinite(kw)&&!picked&&rows.length>0;
 useEffect(()=>{if(picked)document.querySelector('.ref-scale li.picked')?.scrollIntoView({block:'nearest',behavior:'smooth'});},[picked]);
 return <section className="card reference-books" aria-label="Справочники">
  <div className="reference-head navy-head">
   <div className="queue-switch" role="group" aria-label="Справочник">{(['breakers','cables','tg','attorneys'] as const).map(code=><button key={code} type="button" aria-pressed={tabAll===code} onClick={()=>switchTab(code)}><Icon name={tabIcon[code]} size={16}/>{tabName[code]}</button>)}</div>
   {!other&&canEdit&&book&&!draft&&<button type="button" className="primary-button" onClick={edit}>Редактировать</button>}
  </div>
  {other?<OtherBook key={other} code={other} book={books.find(b=>(b.code as string)===other)} canEdit={canEdit} api={api} onSaved={load}/>:<>
  <p className="helper-text">{tab==='breakers'
   ?'Номинал вводного автомата в акте должен быть не выше указанного для мощности объекта; если указаны трансформаторы тока — в акте они должны быть не ниже.'
   :'Сечение провода в акте и на схеме должно быть не меньше минимального для мощности объекта.'}
   {' '}Проверка выполняется при «Проверить по ТУ».{!canEdit&&' Изменять справочник может администратор.'}</p>
  {tab==='cables'&&book&&(draft?<label className="reference-brands">Марки, к которым применяется таблица (через запятую)<input value={draft.brands} onChange={e=>setDraft({...draft,brands:e.target.value})} placeholder="СИП"/></label>
   :<p className="reference-brands-note">Применяется к маркам: {(book.settings?.brands??[]).map((b:string)=><span className="ref-chip" key={b}>{b}</span>)} Для других марок (ВВГ, АВВГ…) сечение проверяется вручную.</p>)}
  {error&&<p role="alert">{error}</p>}

  {book&&!draft&&<>
   <div className="ref-picker">
    <div className="queue-switch" role="group" aria-label="Группа">{groups[tab].map(([k,l])=><button key={k} type="button" aria-pressed={g===k} onClick={()=>setGroup({...group,[tab]:k})}><Icon name={k==='1ф'||k==='0.23'?'phase1':'phase3'} size={16}/>{l}</button>)}</div>
    <label className="ref-power">Мощность объекта<span><input inputMode="decimal" placeholder="например, 15" value={power} onChange={e=>setPower(e.target.value)} aria-label="Мощность объекта, кВт"/>кВт</span></label>
    <div className={`ref-result${picked?' found':beyond?' beyond':''}`} aria-live="polite">
     {picked?tab==='breakers'
       ?<><div><small>Вводной автомат</small><b>не выше {num(picked.breaker)} А</b></div><div><small>Трансформаторы тока</small><b>{picked.ct?`не ниже ${picked.ct}`:'не требуются'}</b></div></>
       :<div><small>Сечение ({(book.settings?.brands??[]).join(', ')})</small><b>не менее {picked.cores}×{num(picked.section)} мм²</b></div>
      :beyond?<span>Для {power} кВт в группе «{groupName[g]}» строки нет — проверьте вручную.</span>
      :<span>Введите мощность — справочник покажет норму и выделит строку.</span>}
    </div>
   </div>
   <ul className="ref-scale" aria-label={groupName[g]}>
    {rows.map((r,i)=><li key={i} className={r===picked?'picked':''} onClick={()=>setPower(num(r.to))} title="Подставить верхнюю границу диапазона">
     <span className="ref-range">{num(r.from)} – {num(r.to)} кВт</span>
     <span className="ref-bar"><i style={{left:`${r.from/max*100}%`,width:`${Math.max(1.5,(r.to-r.from)/max*100)}%`}}/></span>
     <span className="ref-amp" title={`Расчётный ток при ${num(r.to)} кВт, cos φ = 1`}><Icon name="zap" size={14}/><b>≈ {num(current(tab,r))} А</b><small>при {num(r.to)} кВт</small></span>
     <b className="ref-norm">{norm(tab,r)}</b>
     {tab==='breakers'&&<span className={`ref-ct${r.ct?'':' none'}`}>{r.ct?`ТТ ≥ ${r.ct}`:'без ТТ'}</span>}
    </li>)}
    {!rows.length&&<li className="ref-empty">В этой группе строк нет.</li>}
   </ul>
  </>}

  {draft&&<><div className="reference-table-wrap"><table className="reference-table"><thead><tr>{columns[tab].map(([k,l])=><th key={k}>{l}</th>)}<th/></tr></thead><tbody>
   {draft.rows.map((r,i)=><tr key={i}>{columns[tab].map(([k])=><td key={k}>{input(r,i,k)}</td>)}
    <td><button type="button" aria-label="Удалить строку" onClick={()=>setDraft({...draft,rows:draft.rows.filter((_,j)=>j!==i)})}>✕</button></td></tr>)}
  </tbody></table></div>
  <div className="card-actions">
   <button type="button" onClick={()=>setDraft({...draft,rows:[...draft.rows,{...blank[tab]}]})}>Добавить строку</button>
   <button type="button" className="primary-button" disabled={busy} onClick={()=>void save()}>Сохранить</button>
   <button type="button" disabled={busy} onClick={()=>{setDraft(undefined);setError('');}}>Отмена</button>
  </div></>}
  {book&&<p className="helper-text reference-meta">Ревизия {book.revision}{book.updated_by_name?` · изменил ${book.updated_by_name}, ${dateTime(book.updated_at)}`:' · исходные значения'}</p>}
  </>}
 </section>;
}
