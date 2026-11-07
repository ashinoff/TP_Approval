import type {Block} from './documents.js';
import type {PdfBoundary} from './pdf-model.js';
import type {FindingStatus} from './tu-rules.js';
import type {NominalFinding} from './nominal-rules.js';

/**
 * Проверки самого акта, без сравнения с ТУ (решения владельца 07.11.2026):
 * п. 8.1 — кто отвечает за пломбы и сохранность учёта: «Заявитель» или «Сетевая организация», подтверждает человек;
 * п. 8.2 — за метрологическую поверку всегда отвечает «Сетевая организация»;
 * граница на схеме — красная линия: элементы над и под ней сверяются с описанием границ в тексте акта (только PDF);
 * место границы по рисунку (кружок опоры, рамка ТП/РУ/ВУ, рамка ВРУ) — с описанием «…от <чего> сетевой организации»;
 * единообразие: ТП, фидер, опора, провод, длина, ВРУ, вводной автомат — одно и то же во всех местах акта и на схеме
 * (в шаблоне акта эти переменные вводятся один раз и расходятся по нескольким местам, а схему правят вручную).
 */
type Value={value:string;quote:string;blockId:string;part:string;shown?:string;area?:{page:number;box:[number,number,number,number]}};
type PdfLike=Block&{page?:number;spans?:{box:[number,number,number,number]}[]};
export type ActModel={blocks:Block[];boundaries?:PdfBoundary[]};

const norm=(s:string)=>s.normalize('NFC').toLowerCase().replace(/ё/g,'е').replace(/[  \s]+/g,' ').trim();
const value=(v:string,b:Block,shown:string):Value=>({value:v,quote:b.text,blockId:b.id,part:b.part,shown});
const result=(field:string,label:string,status:FindingStatus,reason:string,act:Value[],normText:string,limit=12):NominalFinding=>
 ({field,label,status,reason,act:act.slice(0,limit),tu:[],actCandidates:act.length,tuCandidates:0,norm:normText});

/** «…несет: Заявитель.» — сторона после «несет:» в пункте, найденном по смыслу (номер пункта в бланках бывает разным). */
function responsible(blocks:Block[],subject:RegExp){
 for(const b of blocks){
  if(b.text.length>1000||!subject.test(b.text))continue;
  const m=/нес[её]т\s*:?\s*([^.;\n]{2,60})/iu.exec(b.text);
  if(m)return {block:b,shown:m[1].trim()};
 }
 return undefined;
}
const SEALS=/целостност\p{L}*\s+пломб/iu,VERIFICATION=/метрологическ\p{L}*\s+поверк/iu;
const NETWORK=/^сетевая организация$/u,APPLICANT=/^заявитель$/u;

function responsibilityFindings(blocks:Block[]):NominalFinding[]{
 const findings:NominalFinding[]=[];
 const verification=responsible(blocks,VERIFICATION);
 if(verification){const ok=NETWORK.test(norm(verification.shown));
  findings.push(result('verificationParty','Ответственный за метрологическую поверку (п. 8.2)',ok?'MATCH':'DIFFERENCE',
   ok?'Указана сетевая организация.':`В акте указано «${verification.shown}», должна быть «Сетевая организация».`,
   [value(norm(verification.shown),verification.block,verification.shown)],'Правило: поверку счётчиков, ТТ и ТН всегда обеспечивает сетевая организация.'));}
 const seals=responsible(blocks,SEALS);
 if(seals){const v=norm(seals.shown);const known=NETWORK.test(v)||APPLICANT.test(v);
  findings.push(result('sealsParty','Ответственный за пломбы и сохранность учёта (п. 8.1)','MANUAL_REVIEW',
   known?`В акте указано «${seals.shown}». Подтвердите, что ответственная сторона выбрана верно.`:`В акте указано «${seals.shown}» — ожидается «Заявитель» или «Сетевая организация». Сверьте вручную.`,
   [value(v,seals.block,seals.shown)],'Ответственным может быть заявитель или сетевая организация — зависит от места установки учёта.'));}
 return findings;
}

// Элементы схемы и текста, по которым сверяется граница: опора, линия/фидер, провод, ТП, ВРУ.
const TOKENS:[string,RegExp,(m:RegExpExecArray)=>string][]=[
 ['опора',/(?:оп\.|опор[аыеуой]{0,2})\s*№\s*(\d+[\p{L}]?)/giu,m=>'оп'+m[1].toLowerCase()],
 ['линия',/(?:ф\.|фидер\p{L}*|ВЛ\s*-?\s*0[,.]4\s*кВ)\s*«([^»]{2,40})»/giu,m=>'ф:'+norm(m[1])],
 ['провод',/(СИП|А?ВВГ\p{L}*|АПвП\p{L}*)[-\s]*\d?[-\s]*(\d)\s*[xх×]\s*(\d+(?:[.,]\d+)?)/giu,m=>`${m[1].toUpperCase()} ${m[2]}x${m[3].replace(',','.')}`],
 ['ТП',/(?<![\p{L}])(к?тпн?|ктп|зтп|мтп|рп)\s*-?\s*([\p{L}]{0,3}\d[\p{L}\d]*)/giu,m=>`${m[1]}-${m[2]}`.toLowerCase()],
 // 0,22 и 0,23 кВ (как и 0,38 и 0,4) — одно и то же напряжение, разное написание не ошибка.
 ['ВРУ',/ВРУ\s*-?\s*(0[,.]\d{1,2})\s*кВ/giu,m=>'вру'+(['0,22','0,23','0.22','0.23'].includes(m[1])?'0,23':['0,38','0,4','0.38','0.4'].includes(m[1])?'0,4':m[1].replace('.',','))],
];
// Только для единообразия (в описании границы не участвуют): вводной автомат и длина провода.
const EXTRA:typeof TOKENS=[
 ['вводной автомат',/(?<![\p{L}])ВА\s*-?\s*(\d{1,4})\s*А(?![\p{L}\d])/gu,m=>'ва'+m[1]],
 ['длина провода',/(?<![\p{L}])L\s*=\s*(\d+(?:[.,]\d+)?)\s*м(?![\p{L}])/gu,m=>'L'+m[1].replace(',','.')],
];
type Token={kind:string;key:string;raw:string};
function tokens(text:string,list=TOKENS):Token[]{
 const out:Token[]=[];
 for(const [kind,re,key]of list){re.lastIndex=0;let m:RegExpExecArray|null;while((m=re.exec(text)))out.push({kind,key:key(m),raw:m[0]});}
 return out;
}
/** Ячейка под заголовком таблицы («Описание границ балансовой…», «…в эксплуатации заявителя»). */
function under(blocks:Block[],header:RegExp){
 const h=blocks.find(b=>b.table&&header.test(b.text));if(!h?.table)return [];
 return blocks.filter(b=>b.table&&b.table.table===h.table!.table&&b.table.cell===h.table!.cell&&b.table.row>h.table!.row);
}

function boundaryFindings(model:ActModel):NominalFinding[]{
 const line=model.boundaries?.[0];if(!line)return [];
 const blocks=model.blocks as PdfLike[];
 // Надписи схемы: короткие блоки той же страницы рядом с линией; сторона — выше или ниже линии.
 const scheme={network:[] as {block:Block;token:Token}[],applicant:[] as {block:Block;token:Token}[]};
 for(const b of blocks){
  if(b.page!==line.page||b.text.length>80||!b.spans?.length||b.table||/^\s*\d+(?:\.\d+)*\.\s/u.test(b.text))continue;
  const y=b.spans.reduce((s,sp)=>s+(sp.box[1]+sp.box[3])/2,0)/b.spans.length;
  if(Math.abs(y-line.y)>260)continue;
  const side=(y>line.y)===line.networkAbove?'network':'applicant';
  for(const t of tokens(b.text))if(!scheme[side].some(s=>s.token.key===t.key))scheme[side].push({block:b,token:t});
 }
 if(!scheme.network.length&&!scheme.applicant.length)return [result('boundaryScheme','Граница на схеме','INFO','Красная линия границы найдена, но подписи элементов рядом с ней не распознаны.',[],'')];
 // Текст акта: описание границы и таблица оборудования сторон.
 const description=under(blocks,/описание\s+границ\s+балансов/iu);
 const networkText=[...under(blocks,/в\s+эксплуатации\s+сетевой/iu),...blocks.filter((b,i)=>i>0&&/^\s*\d+\.\s*У\s+сетевой\s+организации\s+на\s+границе/iu.test(blocks[i-1].text))];
 const applicantText=under(blocks,/в\s+эксплуатации\s+заявител/iu);
 const find=(list:Block[],key:string)=>{for(const b of list){const t=tokens(b.text).find(x=>x.key===key);if(t)return {block:b,token:t};}return undefined;};
 const act:Value[]=[];const missing:string[]=[],wrongSide:string[]=[];
 for(const side of ['network','applicant'] as const){
  const own=side==='network'?networkText:applicantText,other=side==='network'?applicantText:networkText;
  for(const s of scheme[side]){
   act.push(value(s.token.key,s.block,s.token.raw));
   const hit=find(description,s.token.key)??find(own,s.token.key);
   if(hit){act.push(value(s.token.key,hit.block,hit.token.raw));continue;}
   const foreign=find(other,s.token.key);
   if(foreign){act.push(value(s.token.key,foreign.block,foreign.token.raw));wrongSide.push(`${s.token.raw} (на схеме — сторона ${side==='network'?'сетевой организации':'заявителя'})`);}
   else missing.push(s.token.raw);
  }
 }
 const sides=`Сетевая организация: ${scheme.network.map(s=>s.token.raw).join(', ')||'—'}; заявитель: ${scheme.applicant.map(s=>s.token.raw).join(', ')||'—'}.`;
 const [status,reason]:[FindingStatus,string]=wrongSide.length?['DIFFERENCE',`В тексте акта элемент записан за другой стороной: ${wrongSide.join('; ')}.`]
  :missing.length?['MANUAL_REVIEW',`На схеме у границы есть ${missing.join(', ')} — в описании границ и таблице оборудования не найдено. Сверьте вручную.`]
  :['MATCH','Элементы у красной линии на схеме совпадают с описанием границ в акте.'];
 return [result('boundaryScheme','Граница на схеме',status,reason,act,`По схеме: ${sides}`)];
}

type Place='pole'|'tp'|'vru';
const placeName:Record<Place,string>={pole:'на опоре (ВЛ)',tp:'на контактах РУ/ВУ ТП',vru:'в ВРУ заявителя'};
function placeOf(text:string):Place|undefined{
 if(/ВРУ/u.test(text))return 'vru';
 if(/опор|оп\.\s*№|(?<![\p{L}])ВЛ(?![\p{L}])/iu.test(text))return 'pole';
 if(/(?<![\p{L}])(?:РУ|ВУ|ЩУ|КТП|ТП|РП)(?![\p{L}])/u.test(text))return 'tp';
}
/** Место границы: по рисунку схемы (на чём стоит красная линия) и по описанию («…заявителя от <чего> сетевой организации»). */
function boundaryPlaceFindings(model:ActModel):NominalFinding[]{
 const line=model.boundaries?.[0];if(!line)return [];
 const blocks=model.blocks;
 const area={page:line.page,box:line.on?line.on.box:[line.x0,line.y-3,line.x1,line.y+3] as [number,number,number,number]};
 const drawn:Place|undefined=line.on?.kind==='pole'?'pole':line.on?.label?(/ВРУ/u.test(line.on.label)?'vru':placeOf(line.on.label)):undefined;
 const schemeValue:Value={value:drawn??'',quote:'',blockId:'',part:`pdf/page${line.page}`,shown:drawn?placeName[drawn]:'граница',area};
 const description=[...under(blocks,/описание\s+границ\s+балансов/iu),...under(blocks,/описание\s+точки\s+присоединения/iu)];
 let written:{place:Place;block:Block;shown:string}|undefined;
 for(const b of description){
  const m=/от\s+(.{3,160}?)\s+сетевой\s+организаци/iu.exec(b.text)??/(?:на\s+контактах|в)\s+(ВРУ[^,;]{0,40})/iu.exec(b.text);
  const place=m?placeOf(m[1]):undefined;if(m&&place){written={place,block:b,shown:m[1].trim()};break;}
 }
 const act:Value[]=[schemeValue,...(written?[value(written.place,written.block,written.shown)]:[])];
 const norm=`По схеме граница ${drawn?placeName[drawn]:'не определена'}${line.on?.label?` («${line.on.label}»)`:''}; по описанию — ${written?placeName[written.place]:'не определено'}.`;
 if(!drawn)return [result('boundaryPlace','Место границы на схеме','INFO','Красная граница найдена, но не на кружке опоры и не на рамке ТП/ВРУ — посмотрите схему глазами.',act,norm)];
 if(!written)return [result('boundaryPlace','Место границы на схеме','MANUAL_REVIEW',`На схеме граница ${placeName[drawn]}; в описании границ место не распознано. Сверьте вручную.`,act,norm)];
 return [written.place===drawn
  ?result('boundaryPlace','Место границы на схеме','MATCH',`Граница на схеме ${placeName[drawn]} — как в описании границ.`,act,norm)
  :result('boundaryPlace','Место границы на схеме','DIFFERENCE',`На схеме граница ${placeName[drawn]}, а в описании — ${placeName[written.place]}.`,act,norm)];
}

/**
 * Единообразие: каждая переменная шаблона (ТП, фидер, опора, провод, длина, ВРУ, автомат) во всех местах акта, включая
 * надписи схемы, должна быть одной и той же. Одно значение в нескольких местах — «одинаково» (синяя отметка), разные —
 * проверить вручную: чаще всего это схема или абзац, оставшиеся от прежнего акта.
 */
function consistencyFindings(blocks:Block[]):NominalFinding[]{
 const findings:NominalFinding[]=[];
 const usable=blocks.filter(b=>b.text.length<=4000);const all=[...TOKENS,...EXTRA];
 for(const kind of [...new Set(all.map(t=>t[0]))]){
  const list=all.filter(t=>t[0]===kind);
  const places:{block:Block;token:Token}[]=[];const seen=new Set<string>();
  for(const b of usable)for(const t of tokens(b.text,list)){const k=b.id+'|'+t.raw;if(!seen.has(k)){seen.add(k);places.push({block:b,token:t});}}
  if(places.length<2)continue;
  const groups=new Map<string,typeof places>();for(const p of places)groups.set(p.token.key,[...(groups.get(p.token.key)??[]),p]);
  const sorted=[...groups.values()].sort((a,b)=>a.length-b.length);
  const values=sorted.flat().map(p=>value(p.token.key,p.block,p.token.raw));
  if(groups.size===1)findings.push(result(`same.${kind}`,`Одинаково во всём акте: ${kind}`,'MATCH',`Во всех местах акта (${places.length}) одно значение: ${places[0].token.raw}.`,values,'',30));
  else findings.push(result(`same.${kind}`,`Разные значения в акте: ${kind}`,'MANUAL_REVIEW',
   `В акте встречаются разные значения: ${[...sorted].reverse().map(g=>`${g[0].token.raw} (${g.length===1?'1 место':g.length+' места'})`).join(', ')}. Часто это схема или абзац от прежнего акта — сверьте.`,values,'',30));
 }
 return findings;
}

export function actFindings(model:ActModel):NominalFinding[]{
 return [...responsibilityFindings(model.blocks),...boundaryFindings(model),...boundaryPlaceFindings(model),...consistencyFindings(model.blocks)];
}
