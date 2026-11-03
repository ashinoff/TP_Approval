import type {Block} from './documents.js';
export const RULES_VERSION='DOCX_CONTEXT_V3';
type Field='contract'|'power'|'voltage'|'address'|'point';
type Value={value:string;quote:string;blockId:string;part:string};
const normalize=(s:string)=>s.normalize('NFC').toLowerCase().replace(/[\u00a0\s]+/g,' ').replace(/[–—‑]/g,'-').trim();
export const contractKey=(s:string)=>normalize(s).replace(/\s/g,'');
// Exact decimal rational; no floating-point comparison and no lost leading zeroes.
function quantity(n:string,unit:string){const [a,b='']=n.replace(/\s/g,'').replace(',','.').split('.');const numerator=BigInt(a+b)*(unit.toLowerCase().startsWith('к')?1000n:1n),denominator=10n**BigInt(b.length);const gcd=(x:bigint,y:bigint):bigint=>y?gcd(y,x%y):x;const g=gcd(numerator,denominator);return `${numerator/g}/${denominator/g}`;}
const addressKey=(s:string)=>normalize(s).replace(/[«»"]/g,'').replace(/[.,;](?=\s|$)/g,'').replace(/\s+/g,' ').trim();
const labels:Record<Field,RegExp>={contract:/(?:к\s+договору|договор(?:а|у)?)\s*[^№\n]{0,100}№\s*([\p{L}\d][\p{L}\d\/–—‑-]*)/iu,power:/максимальн(?:ая|ой)\s+мощност[ьи]/iu,voltage:/(?:класс|уровень)\s+напряжения/iu,address:/(?:по\s+адресу|адрес\s+объекта)\s*:/iu,point:/точк[аи](?:\(и\))?\s+присоединения/iu};
export function extractRequisites(blocks:Block[]){
 const result={} as Record<Field,Value[]>;
 for(const field of Object.keys(labels) as Field[]){const candidates:Value[]=[];
  for(const block of blocks){if(block.text.length>10000)continue;const matches=[...block.text.matchAll(new RegExp(labels[field].source,labels[field].flags+'g'))];
   for(const [index,match]of matches.entries()){let value:string|undefined;
   if(field==='contract')value=contractKey(match[1]);else{
    let tail=block.text.slice(match.index+match[0].length,matches[index+1]?.index);
    if(field==='power'||field==='voltage'){
     const colon=tail.indexOf(':');const qualifier=colon>=0?tail.slice(0,colon):'';if(colon>=0)tail=tail.slice(colon+1);
     const numeric='(?<![\\p{L}\\d.,+±–—‑-])(?:\\d{1,3}(?:[ \\u00a0]\\d{3}){1,2}|\\d{1,9})(?:[.,]\\d{1,6})?';
     const unit=new RegExp('('+numeric+')\\s*('+(field==='power'?'кВт|Вт':'кВ|В')+')(?![\\p{L}/*×·⋅])(?![.]ч)(?!\\s*[/×*·⋅])','iu');
     const amount=unit.exec(tail);if(amount&&!/существующ|увеличени|дополнительн|генерир|микрогенерац/iu.test(qualifier+tail.slice(0,amount.index)))value=quantity(amount[1],amount[2]);
    }else{if(field==='point'){const colon=tail.indexOf(':');tail=colon<0?'':tail.slice(colon+1);}value=tail.trim()?addressKey(tail):undefined;}
   }
   candidates.push({value:value??'',quote:block.text,blockId:block.id,part:block.part});
   }
  }result[field]=candidates;
 }return result;
}
const names:Record<Field,string>={contract:'Номер договора',power:'Максимальная мощность (всего)',voltage:'Класс напряжения',address:'Адрес объекта',point:'Точка присоединения'};
export function compareRequisites(actBlocks:Block[],tuBlocks:Block[],contractNumber:string){
 const a=extractRequisites(actBlocks),b=extractRequisites(tuBlocks);
 return (Object.keys(names) as Field[]).map(field=>{
  const act=a[field],tu=b[field],av=[...new Set(act.map(v=>v.value))],tv=[...new Set(tu.map(v=>v.value))];
  let status='UNKNOWN',reason='Реквизит не распознан однозначно. Требуется ручная проверка исходных документов.';
  if(av.length===1&&tv.length===1&&av[0]&&tv[0]){
   if(field==='contract'&&(av[0]!==contractKey(contractNumber)||tv[0]!==contractKey(contractNumber))){status='DIFFERENCE';reason='Номер в документе отличается от договора карточки.';}
   else if(av[0]===tv[0]){status='MATCH';reason=field==='power'||field==='voltage'?'Значения равны после точного приведения единиц.':'Нормализованные значения совпадают.';}
   else if(field==='address'||field==='point'){
    const identity=field==='address'?/(?:д(?:ом)?\s+)(\d+(?:[\/.\-]\d+)?)/giu:/тп\s*[-]?\s*([\p{L}\d.-]+)/giu;
    const left=[...av[0].matchAll(identity)].map(m=>m[1]),right=[...tv[0].matchAll(identity)].map(m=>m[1]);
    if(left.length===1&&right.length===1&&left[0]!==right[0]){status='DIFFERENCE';reason=field==='address'?'Номера дома различаются.':'Обозначения ТП различаются.';}
    else{status='MANUAL_REVIEW';reason='Формулировки отличаются. Совпадение отдельных кодов не доказывает тождество адреса или физической точки.';}
   }
   else {status='DIFFERENCE';reason='Извлечённые значения различаются.';}
  }
  const evidence=(rows:Value[])=>{const seen=new Set<string>();return rows.filter(row=>{if(seen.has(row.value))return false;seen.add(row.value);return true;}).slice(0,4);};
  return {field,label:names[field],status,reason,act:evidence(act),tu:evidence(tu),actCandidates:act.length,tuCandidates:tu.length};
 });
}
