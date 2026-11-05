import type {Block} from './documents.js';
import type {Finding,FindingStatus} from './tu-rules.js';
import {tuCardFacts} from './tu-rules.js';
import type {BreakerRow,CableRow,References} from './references.js';

/**
 * Проверка номиналов акта по справочникам администратора: вводной автомат (ВА), трансформаторы тока (ТТ)
 * и сечение провода/кабеля. Мощность берётся из акта (иначе из карточки), фазность — из карточки
 * (иначе из ТУ, иначе по напряжению акта). Текст схем (надписи в рамках) входит в абзацы и читается тоже.
 */
type Value={value:string;quote:string;blockId:string;part:string;shown?:string};
export type NominalFinding=Finding&{norm?:string};
export type NominalInput={phases?:string;powerKw?:string};

const text=(b:Block)=>b.text.replace(/[  ]/g,' ').replace(/ё/g,'е').replace(/Ё/g,'Е');
const usable=(blocks:Block[])=>blocks.filter(b=>b.text.length<=10000);
const value=(v:string,b:Block,shown:string):Value=>({value:v,quote:b.text,blockId:b.id,part:b.part,shown});
const kw=(n:number)=>String(n).replace('.',',');
const uniq=(values:Value[])=>{const seen=new Set<string>();return values.filter(v=>!seen.has(v.value)&&seen.add(v.value));};
const result=(field:string,label:string,status:FindingStatus,reason:string,act:Value[],norm:string,tu:Value[]=[]):NominalFinding=>
 ({field,label,status,reason,act:uniq(act).slice(0,4),tu:uniq(tu).slice(0,4),actCandidates:act.length,tuCandidates:tu.length,norm});

// «ВА-80А», «ВА 47-29 3P 25 А», «автоматический выключатель с Iн= 25 А», «Iн=63А».
const BREAKER=[
 /(?<![\p{L}\d])ВА(?![\p{L}])[^\n;,]{0,25}?(?<![\d.,/])(\d{1,4})\s*[АA](?![\p{L}\d])/gu,
 /автоматическ\p{L}*\s+выключател\p{L}*[^\n;.]{0,60}?(?<![\d.,/])(\d{1,4})\s*[АA](?![\p{L}\d])/giu,
 /(?<![\p{L}])I\s*(?:н|n|ном)\.?\s*=\s*(\d{1,4})\s*[АA](?![\p{L}\d])/gu,
];
export function breakers(blocks:Block[]):Value[]{
 const values:Value[]=[];
 for(const b of usable(blocks)){const t=text(b);const seen=new Set<string>();
  for(const re of BREAKER)for(const m of t.matchAll(re))if(!seen.has(m[1])){seen.add(m[1]);values.push(value(m[1],b,`${m[1]} А`));}}
 return values;
}
// Трансформаторы тока: «ТТ 100/5», «Т-0,66 150/5»; только в абзаце, где речь о ТТ.
const CT_CONTEXT=/(?<![\p{L}])(?:ТТ|ТТИ|ТШП|ТОП|Т-0[,.]66)(?![\p{L}])|трансформатор\p{L}*\s+тока/iu;
const CT_RATIO=/(?<![\d/.,])(\d{2,5})\s*\/\s*5(?![\d])/gu;
export function currentTransformers(blocks:Block[]):Value[]{
 const values:Value[]=[];
 for(const b of usable(blocks)){const t=text(b);if(!CT_CONTEXT.test(t))continue;
  for(const m of t.matchAll(CT_RATIO))values.push(value(m[1],b,`${m[1]}/5`));}
 return values;
}
// Марка и сечение: «СИП 4х50», «СИП-2 4×16», «АВВГ 4х25», «ВВГнг-LS 3x2,5».
const CABLE=/(?<![\p{L}\d])([А-ЯЕA-Z]{2,}[\p{L}\d]*(?:-[\p{L}\d]+)*)[\s-]*(\d)\s*[хxХX×*]\s*(\d{1,3}(?:[.,]\d{1,2})?)(?![\d])/gu;
export function cables(blocks:Block[]):(Value&{brand:string;cores:number;section:number})[]{
 const values:(Value&{brand:string;cores:number;section:number})[]=[];
 for(const b of usable(blocks))for(const m of text(b).matchAll(CABLE)){
  const brand=m[1].toUpperCase(),cores=Number(m[2]),section=Number(m[3].replace(',','.'));
  values.push({...value(`${brand} ${cores}×${kw(section)}`,b,`${m[1]} ${cores}×${kw(section)}`),brand,cores,section});
 }
 return values;
}

const rowFor=<T extends {from:number;to:number}>(rows:T[],power:number)=>{
 const sorted=[...rows].sort((a,b)=>a.from-b.from);
 return sorted.length&&power>=sorted[0].from?sorted.find(r=>power<=r.to+1e-9):undefined;
};
const ctPrimary=(ct:string)=>Number(ct.split('/')[0]);

export function nominalFindings(actBlocks:Block[],tuBlocks:Block[],refs:References,input:NominalInput={}):NominalFinding[]{
 const facts=tuCardFacts(actBlocks),tuFacts=tuCardFacts(tuBlocks);
 const powerText=facts.power_kw.status==='FOUND'?facts.power_kw.value:input.powerKw;
 const power=powerText?Number(powerText):NaN;
 const phases=(input.phases||(tuFacts.phases.value)||(facts.voltage_kv.value==='0.23'?'1ф':facts.voltage_kv.value==='0.4'?'3ф':'')).replace('3фтт','3ф') as '1ф'|'3ф'|'';
 const actBreakers=breakers(actBlocks),actCts=currentTransformers(actBlocks),actCables=cables(actBlocks);
 const tuBreakers=breakers(tuBlocks);
 const findings:NominalFinding[]=[];
 const base=Number.isFinite(power)&&phases?`${phases}, ${kw(power)} кВт`:'';
 if(!base){
  if(actBreakers.length||actCables.length)findings.push(result('normBreaker','Номинал вводного автомата (ВА)','MANUAL_REVIEW',
   !Number.isFinite(power)?'Не удалось определить максимальную мощность — проверка по справочнику невозможна. Сверьте вручную.':'Не определена фазность (заполните её в карточке) — проверка по справочнику невозможна.',actBreakers,'Справочник номиналов ВА'));
  return findings;
 }

 // Вводной автомат: не выше номинала справочника; если ТУ задают Iн явно — тот же номинал.
 const bRow=rowFor(refs.breakers.rows.filter(r=>r.phases===phases),power) as BreakerRow|undefined;
 const bNorm=bRow?`Справочник: ${base} (диапазон ${kw(bRow.from)}–${kw(bRow.to)}) → ВА не выше ${bRow.breaker} А`:`Справочник: для ${base} строки нет`;
 const tuSet=[...new Set(tuBreakers.map(v=>Number(v.value)))];
 const actSet=[...new Set(actBreakers.map(v=>Number(v.value)))];
 if(!bRow)findings.push(result('normBreaker','Номинал вводного автомата (ВА)','MANUAL_REVIEW','Мощность вне диапазонов справочника. Сверьте номинал вручную.',actBreakers,bNorm,tuBreakers));
 else if(!actSet.length)findings.push(result('normBreaker','Номинал вводного автомата (ВА)','MANUAL_REVIEW',`Номинал ВА в акте не найден. По справочнику — не выше ${bRow.breaker} А.`,[],bNorm,tuBreakers));
 else{
  const over=actSet.filter(a=>a>bRow.breaker);
  const tuMismatch=tuSet.length===1&&actSet.some(a=>a!==tuSet[0]);
  if(over.length)findings.push(result('normBreaker','Номинал вводного автомата (ВА)','DIFFERENCE',`ВА ${over.join(', ')} А выше допустимого ${bRow.breaker} А для ${base}.`,actBreakers,bNorm,tuBreakers));
  else if(tuMismatch)findings.push(result('normBreaker','Номинал вводного автомата (ВА)','DIFFERENCE',`В ТУ задан Iн = ${tuSet[0]} А, в акте — ${actSet.join(', ')} А.`,actBreakers,bNorm,tuBreakers));
  else findings.push(result('normBreaker','Номинал вводного автомата (ВА)','MATCH',actSet.length>1?`Все номиналы ВА (${actSet.join(', ')} А) не выше ${bRow.breaker} А.`:`ВА ${actSet[0]} А — не выше ${bRow.breaker} А по справочнику.`,actBreakers,bNorm,tuBreakers));
 }

 // Трансформаторы тока: если справочник их требует — в акте должны быть не ниже указанных.
 if(bRow?.ct){
  const norm=`Справочник: ${base} → трансформаторы тока не ниже ${bRow.ct}`;
  const actSetCt=[...new Set(actCts.map(v=>Number(v.value)))];
  if(!actSetCt.length)findings.push(result('normCt','Трансформаторы тока (ТТ)','MANUAL_REVIEW',`По справочнику для ${base} нужны ТТ не ниже ${bRow.ct}, в акте они не найдены. Проверьте схему учёта (прямое включение или через ТТ).`,[],norm));
  else{const low=actSetCt.filter(c=>c<ctPrimary(bRow.ct!));
   findings.push(result('normCt','Трансформаторы тока (ТТ)',low.length?'DIFFERENCE':'MATCH',low.length?`ТТ ${low.map(c=>c+'/5').join(', ')} ниже требуемых ${bRow.ct}.`:`ТТ не ниже ${bRow.ct}.`,actCts,norm));}
 }else if(bRow&&actCts.length){
  findings.push(result('normCt','Трансформаторы тока (ТТ)','INFO',`По справочнику для ${base} ТТ не требуются, в акте указаны — для сведения.`,actCts,`Справочник: ${base} → ТТ не требуются`));
 }

 // Сечение: справочник применяется к перечисленным маркам (по умолчанию СИП); ниже минимума — расхождение.
 if(actCables.length){
  const voltage=phases==='1ф'?'0.23':'0.38';
  const cRow=rowFor(refs.cables.rows.filter(r=>r.voltage===voltage),power) as CableRow|undefined;
  const covered=(brand:string)=>refs.cables.brands.some(p=>brand.startsWith(p.toUpperCase()));
  const checked=actCables.filter(c=>covered(c.brand)),other=actCables.filter(c=>!covered(c.brand));
  const cNorm=cRow?`Справочник (${refs.cables.brands.join(', ')}): ${voltage.replace('.',',')} кВ, ${kw(power)} кВт → не менее ${cRow.cores}×${kw(cRow.section)}`:`Справочник: для ${voltage.replace('.',',')} кВ, ${kw(power)} кВт строки нет`;
  if(checked.length){
   if(!cRow)findings.push(result('normCable','Сечение провода / кабеля','MANUAL_REVIEW','Мощность вне диапазонов справочника сечений. Сверьте вручную.',checked,cNorm));
   else{const low=checked.filter(c=>c.section<cRow.section||c.cores<cRow.cores);
    findings.push(result('normCable','Сечение провода / кабеля',low.length?'DIFFERENCE':'MATCH',low.length?`${[...new Set(low.map(c=>c.shown))].join(', ')} — меньше минимального ${cRow.cores}×${kw(cRow.section)} для ${kw(power)} кВт.`:`Сечение не меньше ${cRow.cores}×${kw(cRow.section)} по справочнику.`,checked,cNorm));}
  }
  if(other.length)findings.push(result('normCableOther','Сечение кабеля других марок','INFO',`Для марок ${[...new Set(other.map(c=>c.brand))].join(', ')} правило в справочнике не задано — проверьте сечение по ПУЭ вручную.`,other,`Справочник сечений применяется к маркам: ${refs.cables.brands.join(', ')}`));
 }
 return findings;
}
