import type {Block} from './documents.js';

/**
 * Local deterministic comparison of an act (АКТ ТП / АВТУ) with technical conditions (ТУ).
 * No AI and no external services. Every value keeps its source paragraph so a person can verify it.
 *
 * V4 reads the standard «Россети Юг» templates in addition to the generic «Label: value» lines:
 * table columns of «Перечень точек присоединения», «(всего) 15,0 (пятнадцать) кВт», existing/new power,
 * the TU number, the applicant, the supply centre, the TU sub-item ranges and the reliability category.
 */
export const RULES_VERSION='DOCX_CONTEXT_V4';

export type FindingStatus='MATCH'|'DIFFERENCE'|'MANUAL_REVIEW'|'UNKNOWN'|'INFO';
/** Statuses that block submission unless an engineer confirms them (DIFFERENCE can never be confirmed). */
export const BLOCKING_STATUSES:FindingStatus[]=['DIFFERENCE','MANUAL_REVIEW','UNKNOWN'];
export const CONFIRMABLE_STATUSES:FindingStatus[]=['MANUAL_REVIEW','UNKNOWN'];

type Value={value:string;quote:string;blockId:string;part:string;shown?:string};
export type Finding={field:string;label:string;status:FindingStatus;reason:string;act:Value[];tu:Value[];actCandidates:number;tuCandidates:number};

const normalize=(s:string)=>s.normalize('NFC').toLowerCase().replace(/ё/g,'е').replace(/[ \s]+/g,' ').replace(/[–—‑]/g,'-').trim();
export const contractKey=(s:string)=>normalize(s).replace(/\s/g,'');
const addressKey=(s:string)=>normalize(s).replace(/[«»"]/g,'').replace(/[.,;](?=\s|$)/g,'').replace(/\s+/g,' ').trim();
const looseKey=(s:string)=>normalize(s).replace(/[«»"'.,;:()\s-]/g,'');
const trimEnd=(s:string)=>s.replace(/[\s.,;:]+$/u,'').trim();

// ---------- Numbers with units ----------

/** Exact decimal rational; no floating point and no lost leading zeroes. */
function quantity(n:string,unit:string){
 const [whole,fraction='']=n.replace(/[\s ]/g,'').replace(',','.').split('.');
 const numerator=BigInt(whole+fraction)*(unit.toLowerCase().startsWith('к')?1000n:1n);
 const denominator=10n**BigInt(fraction.length);
 const gcd=(x:bigint,y:bigint):bigint=>y?gcd(y,x%y):x;
 const g=gcd(numerator,denominator);
 return `${numerator/g}/${denominator/g}`;
}
/** Human form of a rational value, e.g. 15000/1 W -> «15 кВт». */
function shownQuantity(value:string,big:string,small:string){
 const [n,d]=value.split('/').map(BigInt);
 if(n%(1000n*d)===0n)return `${n/(1000n*d)} ${big}`;
 const scaled=Number(n)/Number(d)/1000;
 return `${String(scaled).replace('.',',')} ${big}`.replace(/^NaN.*/,`${n}/${d} ${small}`);
}
const NUMBER='(?:\\d{1,3}(?:[ \\u00a0]\\d{3}){1,2}|\\d{1,9})(?:[.,]\\d{1,6})?';
/** Optional number written in words in brackets: «15,0 (пятнадцать) кВт». */
const WORDS='(?:\\s*\\([\\p{L}\\s,-]{1,80}\\))?';
const unitPattern=(units:string)=>new RegExp(`^(${NUMBER})${WORDS}\\s*(${units})(?![\\p{L}/*×·⋅])(?![.]ч)(?!\\s*[/×*·⋅])`,'iu');
const powerAt=unitPattern('кВт|Вт'),voltageAt=unitPattern('кВ|В');

/**
 * Value of the first number in `segment`, only if it is a safe, plain number with the expected unit.
 * Returns '' when the segment has a number that is not safe (e.g. «-15 кВт», «1e3 кВт», «10–15 кВт»):
 * such a candidate is ambiguous and must not be skipped silently.
 * Returns undefined when the segment has no digits at all (a header or a reference without a value).
 */
function firstQuantity(segment:string,pattern:RegExp):string|undefined{
 const digit=segment.search(/\d/);
 if(digit<0)return undefined;
 const before=segment[digit-1]??'';
 if(/[\p{L}\d.,+±–—‑-]/u.test(before))return '';
 const match=pattern.exec(segment.slice(digit));
 if(!match)return '';
 return quantity(match[1],match[2]);
}

// ---------- Tables ----------

type Column={table:number;cell:number;header:Block};
/** Finds a table column by its header text and returns the data cells below it. */
function columnValues(blocks:Block[],header:RegExp,exclude?:RegExp){
 const columns:Column[]=[];
 for(const b of blocks){
  if(!b.table)continue;
  const text=normalize(b.text);
  if(header.test(text)&&!(exclude&&exclude.test(text)))columns.push({table:b.table.table,cell:b.table.cell,header:b});
 }
 const values:{block:Block;header:Block}[]=[];
 for(const column of columns){
  const headerRow=column.header.table!.row;
  for(const b of blocks){
   if(b.part!==column.header.part||!b.table||b.table.table!==column.table||b.table.cell!==column.cell||b.table.row<=headerRow)continue;
   if(b.text.trim())values.push({block:b,header:column.header});
  }
 }
 return values;
}

// ---------- Field extractors ----------

/** Text up to the end of the clause. A comma followed by a space ends it; «8,0» does not. */
const clause=(s:string)=>s.split(/;|,\s|\n/u)[0];

type Extracted={values:Value[];found:boolean};
const value=(v:string,b:Block,shown?:string):Value=>({value:v,quote:b.text,blockId:b.id,part:b.part,...(shown?{shown}:{})});
const textBlocks=(blocks:Block[])=>blocks.filter(b=>b.text.length<=10000);

const POWER_LABEL=/максимальн(?:ая|ой)\s+мощност[ьи]/giu;
const NOT_TOTAL=/существующ|ранее\s+присоедин|без\s+уч[её]та|увеличени|дополнительн|генерир|микрогенерац/iu;

function totalPower(blocks:Block[]):Extracted{
 const values:Value[]=[];let found=false;
 for(const b of textBlocks(blocks)){
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(POWER_LABEL)){
   found=true;
   const before=text.slice(Math.max(0,m.index-60),m.index);
   if(NOT_TOTAL.test(before))continue;
   // The value belongs to the label up to the next clause: «…: 15 кВт, в том числе существующая 7 кВт».
   const rest=text.slice(m.index+m[0].length);
   const end=rest.search(/,\s*в\s+том\s+числе|;|\n/iu);
   let segment=end<0?rest:rest.slice(0,end);
   const next=segment.search(new RegExp(POWER_LABEL.source,'iu'));
   if(next>=0)segment=segment.slice(0,next);
   const digit=segment.search(/\d/);
   const qualifier=digit<0?segment:segment.slice(0,digit);
   if(NOT_TOTAL.test(qualifier))continue;
   const result=firstQuantity(segment,powerAt);
   if(result!==undefined)values.push(value(result,b,result?shownQuantity(result,'кВт','Вт'):undefined));
  }
 }
 // «Перечень точек присоединения»: column «Максимальная мощность (кВт)», one connection point only.
 const cells=columnValues(blocks,/^максимальная мощность\s*\(квт\)$/u,/микрогенерац/u);
 if(cells.length===1){
  const amount=firstQuantity(cells[0].block.text+' кВт',powerAt);
  if(amount)values.push(value(amount,cells[0].block,shownQuantity(amount,'кВт','Вт')));
 }
 return {values,found:found||cells.length>0};
}

function existingPower(blocks:Block[]):Extracted{
 const pattern=/(?:существующ\p{L}*|ранее\s+присоединенн\p{L}*)\s+(?:максимальн\p{L}*\s+)?мощност\p{L}*\s*:?\s*/giu;
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(pattern)){
   // «(без учета ранее присоединенной (существующей) …)» describes the new power, not the existing one.
   if(/без\s+уч[её]та\s*$|без\s+уч[её]та\s+ранее\s*$|без\s+уч[её]та\s+ранее\s+присоедин\p{L}*\s*\(\s*$/iu.test(text.slice(Math.max(0,m.index-60),m.index)))continue;
   const result=firstQuantity(clause(text.slice(m.index+m[0].length)),powerAt);
   if(result!==undefined)values.push(value(result,b,result?shownQuantity(result,'кВт','Вт'):undefined));
  }
 }
 return {values,found:values.length>0};
}

function newPower(blocks:Block[]):Extracted{
 const pattern=/без\s+уч[её]та\s+ранее\s+присоедин\p{L}*\s*(?:\(\s*существующ\p{L}*\s*\)\s*)?максимальн\p{L}*\s+мощност\p{L}*\s*\)\s*:?\s*/giu;
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(pattern)){
   const result=firstQuantity(clause(text.slice(m.index+m[0].length)),powerAt);
   if(result!==undefined)values.push(value(result,b,result?shownQuantity(result,'кВт','Вт'):undefined));
  }
 }
 return {values,found:values.length>0};
}

function voltage(blocks:Block[]):Extracted{
 const label=/(?:класс|уровень)\s+напряжения/giu;
 const values:Value[]=[];let found=false;
 for(const b of textBlocks(blocks)){
  if(b.table&&/^уровень напряжения\s*\(к?в\)$/u.test(normalize(b.text))){found=true;continue;}
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(label)){
   found=true;
   const rest=text.slice(m.index+m[0].length);
   const colon=rest.indexOf(':');
   const segment=(colon>=0?rest.slice(colon+1):rest).split(/[;\n]/)[0];
   const result=firstQuantity(segment,voltageAt);
   if(result!==undefined)values.push(value(result,b,result?shownQuantity(result,'кВ','В'):undefined));
  }
 }
 for(const cell of columnValues(blocks,/^уровень напряжения\s*\(к?в\)$/u)){
  const unit=/\(кв\)/u.test(normalize(cell.header.text))?'кВ':'В';
  const result=firstQuantity(cell.block.text+' '+unit,voltageAt);
  if(result)values.push(value(result,cell.block,shownQuantity(result,'кВ','В')));
 }
 return {values,found};
}

const CONTRACT=/(?:к\s+договору|договор(?:а|у)?)\s*[^№\n]{0,100}№\s*([\p{L}\d][\p{L}\d\/–—‑-]*)/iu;
function contract(blocks:Block[]):Extracted{
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  for(const m of b.text.matchAll(new RegExp(CONTRACT.source,'giu')))values.push(value(contractKey(m[1]),b,m[1]));
 }
 return {values,found:values.length>0};
}

/** Address: «по адресу: …» / «Адрес объекта: …», and in the act item 1 after «устройств: «…»,». */
function address(blocks:Block[]):Extracted{
 const values:Value[]=[];
 const stop=/,\s*(?:сетевой\s+организаци|в\s+лице|в\s+присутствии|построенн)/iu;
 for(const b of textBlocks(blocks)){
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(/(?:по\s+адресу|адрес\s+объекта)\s*:\s*/giu)){
   let tail=text.slice(m.index+m[0].length);
   const next=tail.search(/(?:по\s+адресу|адрес\s+объекта)\s*:/iu);
   if(next>=0)tail=tail.slice(0,next);
   const cut=tail.search(stop);
   if(cut>=0)tail=tail.slice(0,cut);
   if(tail.trim())values.push(value(addressKey(tail),b,trimEnd(tail)));
  }
  const item=/энергопринимающих\s+устройств\s*:\s*«[^»]{1,200}»\s*,\s*(.+)$/isu.exec(text);
  if(item){
   let tail=item[1];const cut=tail.search(stop);if(cut>=0)tail=tail.slice(0,cut);
   if(tail.trim())values.push(value(addressKey(tail),b,trimEnd(tail)));
  }
 }
 return {values,found:values.length>0};
}

/** Connection point: «Точка(и) присоединения …: value» or the table column «Описание точки присоединения». */
function point(blocks:Block[]):Extracted{
 const values:Value[]=[];let found=false;
 for(const b of textBlocks(blocks)){
  if(b.table&&/^описание точки присоединения$/u.test(normalize(b.text))){found=true;continue;}
  const text=b.text.replace(/ /g,' ');
  for(const m of text.matchAll(/точк[аи](?:\(и\))?\s+присоединения/giu)){
   found=true;
   const rest=text.slice(m.index+m[0].length);
   const colon=rest.indexOf(':');
   if(colon<0)continue;
   const tail=rest.slice(colon+1);
   if(tail.trim())values.push(value(addressKey(tail),b,trimEnd(tail)));
  }
 }
 for(const cell of columnValues(blocks,/^описание точки присоединения$/u))values.push(value(addressKey(cell.block.text),cell.block,trimEnd(cell.block.text)));
 return {values,found};
}

const fio=(s:string)=>normalize(s).replace(/[.,;:]+$/u,'').trim();
function applicant(blocks:Block[]):Extracted{
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const text=b.text.replace(/ /g,' ');
  const label=/(?:^|\n)\s*(?:\d+[.)]\s*)?Заявитель\s*:\s*([^\n]+)/iu.exec(text);
  if(label&&label[1].trim())values.push(value(fio(label[1]),b,trimEnd(label[1])));
  const party=/с\s+одной\s+стороны\s+и\s+(.{3,200}?)\s*,\s*именуем/iu.exec(text);
  if(party)values.push(value(fio(party[1]),b,trimEnd(party[1])));
 }
 return {values,found:values.length>0};
}

const TU_NUMBER=/^\s*№?\s*(\d{1,3}-\d{1,3}\/\d{1,6}-\d{2})\s*$/u;
/** TU own number: the standalone first line / footer of the TU; in the act — «технических условиях от … № …». */
function tuNumberInTu(blocks:Block[]):Extracted{
 const values:Value[]=[];
 const first=blocks.find(b=>b.part==='word/document.xml'&&b.text.trim());
 const candidates=[first,...blocks.filter(b=>/footer|header/.test(b.part))].filter(Boolean) as Block[];
 for(const b of candidates){const m=TU_NUMBER.exec(b.text);if(m)values.push(value(m[1],b,m[1]));}
 return {values,found:values.length>0};
}
function tuNumberInAct(blocks:Block[]):Extracted{
 const values:Value[]=[];
 const pattern=/(?:по\s+техническим\s+условиям|выполнение\s+ТУ|технических\s+условий)\s+от\s+(\d{2}\.\d{2}\.\d{4})\s*(?:г\.?\s*)?№\s*([^\s,;]+)/giu;
 for(const b of textBlocks(blocks)){
  for(const m of b.text.matchAll(pattern)){
   const number=trimEnd(m[2]);
   values.push(value(number,b,`${number} от ${m[1]}`));
  }
 }
 return {values,found:values.length>0};
}

function supplyCentre(blocks:Block[]):Extracted{
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const m=/(?:основной\s+)?источник\s+питания\s*:\s*([^\n;]+)/iu.exec(b.text);
  if(m&&!/^\s*нет\b/iu.test(m[1])&&!/резервн/iu.test(b.text.slice(0,m.index+20)))values.push(value(looseKey(m[1]),b,trimEnd(m[1])));
 }
 for(const cell of columnValues(blocks,/^источник питания/u))values.push(value(looseKey(cell.block.text),cell.block,trimEnd(cell.block.text)));
 return {values,found:values.length>0};
}

function epuName(blocks:Block[]):Extracted{
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const tu=/наименование\s+энергопринимающих\s+устройств\s+заявителя\s*:\s*([^\n]+)/iu.exec(b.text);
  if(tu)values.push(value(looseKey(tu[1]),b,trimEnd(tu[1])));
  const act=/энергопринимающих\s+устройств\s*:\s*«([^»]{1,200})»/iu.exec(b.text);
  if(act)values.push(value(looseKey(act[1]),b,act[1]));
 }
 return {values,found:values.length>0};
}

/** Number of TU sub-items under «Сетевая организация осуществляет» / «Заявитель осуществляет» (Word list levels). */
function subItemCounts(blocks:Block[]){
 const result:Record<'network'|'applicant',{count:number;block:Block}|undefined>={network:undefined,applicant:undefined};
 const body=blocks.filter(b=>b.part==='word/document.xml');
 body.forEach((b,i)=>{
  const kind=/^\s*сетевая\s+организация\s+осуществляет/iu.test(b.text)?'network':/^\s*заявитель\s+осуществляет/iu.test(b.text)?'applicant':undefined;
  if(!kind||!b.numbering)return;
  let count=0;
  for(const next of body.slice(i+1)){
   if(!next.text.trim())continue;
   if(!next.numbering||next.numbering.level<=b.numbering.level)break;
   count++;
  }
  if(count)result[kind]={count,block:b};
 });
 return result;
}
function subItemRanges(blocks:Block[]){
 const result:Record<'network'|'applicant',{count:number;block:Block;shown:string}|undefined>={network:undefined,applicant:undefined};
 for(const b of textBlocks(blocks)){
  const text=normalize(b.text);
  for(const [kind,label]of [['network','сетевая организация осуществляет'],['applicant','заявитель осуществляет']] as const){
   const m=new RegExp(`${label}\\s*:\\s*пункты?\\s+(\\d+)\\.(\\d+)\\s*-\\s*(\\d+)\\.(\\d+)\\s*-\\s*выполнен`,'u').exec(text);
   if(m&&m[1]===m[3]){
    const count=Number(m[4])-Number(m[2])+1;
    if(count>0)result[kind]={count,block:b,shown:`${m[1]}.${m[2]}–${m[3]}.${m[4]}`};
   }
  }
 }
 return result;
}

function reliability(blocks:Block[]):Extracted{
 const values:Value[]=[];
 for(const b of textBlocks(blocks)){
  const tu=/категория\s+надежности\s*:\s*([^\n]+)/iu.exec(b.text.replace(/ё/g,'е'));
  if(tu)values.push(value(normalize(tu[1]),b,trimEnd(tu[1])));
  const act=/^\s*(I{1,3})\s*-?\s*\p{L}{0,3}\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*кВт/iu.exec(b.text);
  if(act&&Number(act[2].replace(',','.'))>0)values.push(value(`${act[1]}:${act[2]}`,b,`${act[1]} — ${act[2]} кВт`));
 }
 return {values,found:values.length>0};
}

// ---------- Comparison ----------

const distinct=(values:Value[])=>[...new Set(values.map(v=>v.value))];
const evidence=(rows:Value[])=>{const seen=new Set<string>();return rows.filter(row=>{if(seen.has(row.value))return false;seen.add(row.value);return true;}).slice(0,4);};
const UNCLEAR='Реквизит не распознан однозначно. Сверьте вручную по исходным документам.';

function finding(field:string,label:string,act:Extracted,tu:Extracted,decide:(a:string,t:string)=>{status:FindingStatus;reason:string}):Finding{
 const av=distinct(act.values),tv=distinct(tu.values);
 let status:FindingStatus='UNKNOWN',reason=UNCLEAR;
 if(av.length===1&&tv.length===1&&av[0]&&tv[0])({status,reason}=decide(av[0],tv[0]));
 else if(av.length>1||tv.length>1)reason='В документе найдено несколько разных значений. Сверьте вручную.';
 else if(!av.length&&!tv.length)reason='Реквизит не найден ни в акте, ни в ТУ.';
 else if(!av.length)reason='Реквизит не найден в акте.';
 else if(!tv.length)reason='Реквизит не найден в ТУ.';
 return {field,label,status,reason,act:evidence(act.values),tu:evidence(tu.values),actCandidates:act.values.length,tuCandidates:tu.values.length};
}
const equalOr=(fallback:FindingStatus,fallbackReason:string)=>(a:string,t:string)=>a===t?{status:'MATCH' as FindingStatus,reason:'Значения совпадают.'}:{status:fallback,reason:fallbackReason};
const exactUnits=(a:string,t:string)=>a===t?{status:'MATCH' as FindingStatus,reason:'Значения равны после точного приведения единиц.'}:{status:'DIFFERENCE' as FindingStatus,reason:'Значения различаются.'};

const pointCodes=(s:string)=>[...s.matchAll(/(?<![\p{L}])(к?тпн?|ктп|зтп|мтп|ртп|рп)\s*-?\s*([\p{L}]{0,3}\d[\p{L}\d.]*)/giu)].map(m=>`${m[1]}-${m[2]}`.replace(/\.$/,''));

/**
 * Compares the act with the TU. Core requisites (contract, total power, voltage, address, point) are always
 * reported. Additional requisites are reported only when found in at least one document.
 */
export function compareRequisites(actBlocks:Block[],tuBlocks:Block[],contractNumber:string):Finding[]{
 const findings:Finding[]=[];
 const card=contractKey(contractNumber);
 findings.push(finding('contract','Номер договора',contract(actBlocks),contract(tuBlocks),(a,t)=>a!==card||t!==card?{status:'DIFFERENCE',reason:'Номер в документе отличается от договора карточки.'}:{status:'MATCH',reason:'Номер договора совпадает в акте, ТУ и карточке.'}));

 const actTotal=totalPower(actBlocks),tuTotal=totalPower(tuBlocks);
 findings.push(finding('power','Максимальная мощность (всего)',actTotal,tuTotal,exactUnits));
 findings.push(finding('voltage','Класс напряжения',voltage(actBlocks),voltage(tuBlocks),exactUnits));
 findings.push(finding('address','Адрес объекта',address(actBlocks),address(tuBlocks),(a,t)=>{
  if(a===t)return {status:'MATCH',reason:'Адреса совпадают.'};
  const house=(s:string)=>[...s.matchAll(/(?:д(?:ом)?\.?\s+)(\d+(?:[/.\-]\d+)?)/giu)].map(m=>m[1]);
  const cadastre=(s:string)=>[...s.matchAll(/к\s*\/\s*н\s*([\d:]+)/giu)].map(m=>m[1]);
  const [ha,ht,ca,ct]=[house(a),house(t),cadastre(a),cadastre(t)];
  if(ha.length===1&&ht.length===1&&ha[0]!==ht[0])return {status:'DIFFERENCE',reason:'Номера дома различаются.'};
  if(ca.length===1&&ct.length===1&&ca[0]!==ct[0])return {status:'DIFFERENCE',reason:'Кадастровые номера различаются.'};
  return {status:'MANUAL_REVIEW',reason:'Формулировки адреса отличаются. Сверьте вручную.'};
 }));
 findings.push(finding('point','Точка присоединения',point(actBlocks),point(tuBlocks),(a,t)=>{
  if(a===t)return {status:'MATCH',reason:'Описания совпадают.'};
  const ca=[...new Set(pointCodes(a))],ct=[...new Set(pointCodes(t))];
  if(ca.length&&ct.length&&!ca.some(c=>ct.includes(c)))return {status:'DIFFERENCE',reason:'Обозначения ТП различаются.'};
  if(ca.length&&ct.length)return {status:'MANUAL_REVIEW',reason:'Обозначение ТП совпадает, формулировки разные. Совпадение кода не доказывает тождество точки — сверьте вручную.'};
  return {status:'MANUAL_REVIEW',reason:'Формулировки отличаются. Сверьте вручную.'};
 }));

 const optional=(field:string,label:string,act:Extracted,tu:Extracted,decide:(a:string,t:string)=>{status:FindingStatus;reason:string})=>{
  if(!act.values.length&&!tu.values.length)return;
  const f=finding(field,label,act,tu,decide);
  // Found in one document only: the other template may simply not state it. A person decides.
  if(f.status==='UNKNOWN'&&(!f.act.length||!f.tu.length))f.status='MANUAL_REVIEW';
  findings.push(f);
 };
 optional('applicant','Заявитель',applicant(actBlocks),applicant(tuBlocks),(a,t)=>{
  if(a===t)return {status:'MATCH',reason:'ФИО заявителя совпадает.'};
  const surname=(s:string)=>s.split(' ')[0];
  return surname(a)===surname(t)?{status:'MANUAL_REVIEW',reason:'Фамилия совпадает, остальная часть записана иначе. Сверьте вручную.'}:{status:'DIFFERENCE',reason:'Заявитель в акте и ТУ различается.'};
 });
 optional('tuNumber','Номер ТУ',tuNumberInAct(actBlocks),tuNumberInTu(tuBlocks),equalOr('DIFFERENCE','Номер ТУ в акте не совпадает с номером ТУ.'));
 const actExisting=existingPower(actBlocks),tuExisting=existingPower(tuBlocks);
 optional('powerExisting','Ранее присоединённая (существующая) мощность',actExisting,tuExisting,exactUnits);
 const derive=(total:Extracted,existing:Extracted,explicit:Extracted):Extracted=>{
  if(explicit.values.length)return explicit;
  const t=distinct(total.values),e=distinct(existing.values);
  if(t.length!==1||e.length!==1||!t[0]||!e[0])return {values:[],found:false};
  const [tn,td]=t[0].split('/').map(BigInt),[en,ed]=e[0].split('/').map(BigInt);
  const n=tn*ed-en*td,d=td*ed;
  if(n<0n)return {values:[],found:false};
  const gcd=(x:bigint,y:bigint):bigint=>y?gcd(y,x%y):x;const g=gcd(n,d)||1n;
  const result=`${n/g}/${d/g}`;
  const source=total.values.find(v=>v.value===t[0])!;
  return {values:[{...source,value:result,shown:shownQuantity(result,'кВт','Вт')+' (всего минус существующая)'}],found:true};
 };
 // Added power is reported only if at least one document states it explicitly; otherwise it is total − existing
 // on both sides and adds nothing to the two findings above (and would duplicate a total-power discrepancy).
 if(newPower(actBlocks).found||newPower(tuBlocks).found){
  optional('powerNew','Присоединяемая мощность (без существующей)',derive(actTotal,actExisting,newPower(actBlocks)),derive(tuTotal,tuExisting,newPower(tuBlocks)),exactUnits);
 }
 optional('supplyCenter','Питающий центр',supplyCentre(actBlocks),supplyCentre(tuBlocks),equalOr('MANUAL_REVIEW','Наименования питающего центра записаны по-разному. Сверьте вручную.'));
 optional('epuName','Наименование энергопринимающих устройств',epuName(actBlocks),epuName(tuBlocks),equalOr('MANUAL_REVIEW','Наименования ЭПУ отличаются. Сверьте вручную.'));

 // TU sub-items: every sub-item of the TU must be stated as done in the act.
 const counts=subItemCounts(tuBlocks),ranges=subItemRanges(actBlocks);
 for(const [kind,label]of [['network','Пункты ТУ, выполняемые сетевой организацией'],['applicant','Пункты ТУ, выполняемые заявителем']] as const){
  const tu=counts[kind],act=ranges[kind];
  if(!tu&&!act)continue;
  const tuValues=tu?[value(String(tu.count),tu.block,`${tu.count} подпунктов`)]:[];
  const actValues=act?[value(String(act.count),act.block,`пункты ${act.shown} выполнены`)]:[];
  optional(kind==='network'?'tuItemsNetwork':'tuItemsApplicant',label,{values:actValues,found:!!act},{values:tuValues,found:!!tu},(a,t)=>Number(a)===Number(t)?{status:'MATCH',reason:'В акте выполненными указаны все подпункты ТУ.'}:Number(a)<Number(t)?{status:'DIFFERENCE',reason:'В акте выполненными указаны не все подпункты ТУ.'}:{status:'MANUAL_REVIEW',reason:'В акте указано больше подпунктов, чем в ТУ. Сверьте вручную.'});
 }

 // Reliability category: TU may state only the added power, the act — the full one. Shown for information only.
 const actReliability=reliability(actBlocks),tuReliability=reliability(tuBlocks);
 if(actReliability.values.length||tuReliability.values.length){
  findings.push({field:'reliability',label:'Категория надёжности',status:'INFO',reason:'Только для сведения: в ТУ может быть указана присоединяемая мощность, в акте — полная. Сравните по смыслу.',act:evidence(actReliability.values),tu:evidence(tuReliability.values),actCandidates:actReliability.values.length,tuCandidates:tuReliability.values.length});
 }
 return findings;
}

/** True when the findings allow submission without any manual confirmation. */
export const findingsPass=(findings:{status:string}[])=>findings.every(f=>!BLOCKING_STATUSES.includes(f.status as FindingStatus));
