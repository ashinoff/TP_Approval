import {useEffect,useState} from 'react';
import {Icon} from './Ui.js';

type Row=Record<string,any>;
const num=(v:number,d=1)=>Number.isFinite(v)?String(Math.round(v*10**d)/10**d).replace('.',','):'—';
const parse=(v:string)=>Number(v.replace(',','.').trim());

/**
 * Инструменты проверяющего в режиме проверки (08.11.2026): калькулятор присоединения по справочникам номиналов
 * (ток, вводной автомат, ТТ, сечение) и перевод кВт ↔ кВА ↔ А. Мощность и фазность по умолчанию — из карточки документа.
 * Это помощь при чтении акта, а не сверка: сверку выполняет «Проверить по ТУ» по тем же справочникам.
 */
export default function ReviewTools({detail,api,onClose}:{detail:Row;api:(p:string)=>Promise<any>;onClose:()=>void}){
 const card=Object.fromEntries((detail.card??[]).map((v:Row)=>[v.field_code,v.value]));
 const [books,setBooks]=useState<Row[]>([]),[error,setError]=useState('');
 const [power,setPower]=useState(String(card.power_kw??'').replace('.',',')),[phase,setPhase]=useState<'1ф'|'3ф'>(card.phases==='1ф'?'1ф':'3ф'),[cos,setCos]=useState('1');
 const [amps,setAmps]=useState('');
 useEffect(()=>{api('/api/v1/references').then(setBooks).catch(e=>setError((e as Error).message));},[api]);

 const p=parse(power),c=Math.min(1,Math.max(0.1,parse(cos)||1)),single=phase==='1ф';
 const u=single?0.23:0.4;
 const current=p/(single?u*c:Math.sqrt(3)*u*c);
 const breakers=(books.find(b=>b.code==='breakers')?.rows??[]).filter((r:Row)=>r.phases===phase);
 const cables=books.find(b=>b.code==='cables');
 const cableRows=(cables?.rows??[]).filter((r:Row)=>r.voltage===(single?'0.23':'0.38'));
 const valid=Number.isFinite(p)&&p>0;
 const br=valid?breakers.find((r:Row)=>p>=r.from&&p<=r.to):undefined;
 const cb=valid?cableRows.find((r:Row)=>p>=r.from&&p<=r.to):undefined;
 const a=parse(amps);const back=a*(single?u*c:Math.sqrt(3)*u*c);

 return <div className="review-tools" role="complementary" aria-label="Инструменты проверки">
  <div className="review-tools-head"><Icon name="wrench" size={18}/><b>Инструменты</b><span className="review-spacer"/><button type="button" className="review-icon" aria-label="Закрыть инструменты" onClick={onClose}>×</button></div>
  <div className="review-tools-body">
   {error&&<p role="alert" className="review-error">{error}</p>}
   <section className="tool-block">
    <h3><Icon name="zap" size={16}/>Калькулятор присоединения</h3>
    <div className="tool-inputs">
     <label>Мощность, кВт<input inputMode="decimal" aria-label="Мощность, кВт" value={power} onChange={e=>setPower(e.target.value)} placeholder="например, 15"/></label>
     <label>cos φ<input inputMode="decimal" aria-label="cos φ" value={cos} onChange={e=>setCos(e.target.value)}/></label>
    </div>
    <div className="doc-type-switch" role="group" aria-label="Фазность">{(['1ф','3ф'] as const).map(k=><button key={k} type="button" aria-pressed={phase===k} onClick={()=>setPhase(k)}><Icon name={k==='1ф'?'phase1':'phase3'} size={16}/>{k==='1ф'?'1ф · 0,23 кВ':'3ф · 0,4 кВ'}</button>)}</div>
    {card.power_kw&&<p className="tool-note">Из карточки: {String(card.power_kw).replace('.',',')} кВт{card.phases?`, ${card.phases}`:''}.</p>}
    {valid?<dl className="tool-result">
     <div className="tool-main"><dt>Расчётный ток</dt><dd>{num(current)} А</dd></div>
     <div><dt>Полная мощность</dt><dd>{num(p/c,2)} кВА</dd></div>
     <div><dt>Вводной автомат</dt><dd>{br?`не выше ${num(br.breaker,0)} А`:'нет строки в справочнике'}</dd></div>
     <div><dt>Трансформаторы тока</dt><dd>{br?br.ct?`не ниже ${br.ct}`:'не требуются':'—'}</dd></div>
     <div><dt>Сечение{cables?.settings?.brands?.length?` (${cables.settings.brands.join(', ')})`:''}</dt><dd>{cb?`не менее ${cb.cores}×${num(cb.section,1)} мм²`:'нет строки в справочнике'}</dd></div>
    </dl>:<p className="tool-note">Введите мощность — покажем ток и нормы по справочникам.</p>}
   </section>
   <section className="tool-block">
    <h3><Icon name="refresh" size={16}/>Ток → мощность</h3>
    <div className="tool-inputs"><label>Ток, А<input inputMode="decimal" aria-label="Ток, А" value={amps} onChange={e=>setAmps(e.target.value)} placeholder="например, 25"/></label></div>
    {Number.isFinite(a)&&a>0?<dl className="tool-result">
     <div className="tool-main"><dt>Активная мощность</dt><dd>{num(back,2)} кВт</dd></div>
     <div><dt>Полная мощность</dt><dd>{num(back/c,2)} кВА</dd></div>
    </dl>:<p className="tool-note">Например, номинал автомата из акта — какую мощность он пропускает ({phase}, cos φ = {num(c,2)}).</p>}
   </section>
   <p className="tool-note">Формулы: 1ф — I = P / (U·cos φ), U = 0,23 кВ; 3ф — I = P / (√3·U·cos φ), U = 0,4 кВ. Нормы — из «Справочников номиналов».</p>
  </div>
 </div>;
}
