import type {Block} from './documents.js';
import type {PdfBoundary} from './pdf-model.js';
import type {FindingStatus} from './tu-rules.js';
import type {NominalFinding} from './nominal-rules.js';

/**
 * Проверки самого акта, без сравнения с ТУ (решения владельца 07.11.2026):
 * п. 8.1 — кто отвечает за пломбы и сохранность учёта: «Заявитель» или «Сетевая организация», подтверждает человек;
 * п. 8.2 — за метрологическую поверку всегда отвечает «Сетевая организация»;
 * граница на схеме — красная линия: элементы над и под ней сверяются с описанием границ в тексте акта (только PDF).
 */
type Value={value:string;quote:string;blockId:string;part:string;shown?:string};
type PdfLike=Block&{page?:number;spans?:{box:[number,number,number,number]}[]};
export type ActModel={blocks:Block[];boundaries?:PdfBoundary[]};

const norm=(s:string)=>s.normalize('NFC').toLowerCase().replace(/ё/g,'е').replace(/[  \s]+/g,' ').trim();
const value=(v:string,b:Block,shown:string):Value=>({value:v,quote:b.text,blockId:b.id,part:b.part,shown});
const result=(field:string,label:string,status:FindingStatus,reason:string,act:Value[],normText:string):NominalFinding=>
 ({field,label,status,reason,act:act.slice(0,12),tu:[],actCandidates:act.length,tuCandidates:0,norm:normText});

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
 ['ВРУ',/ВРУ\s*-?\s*0[,.]4\s*кВ/giu,()=>'вру'],
];
type Token={kind:string;key:string;raw:string};
function tokens(text:string):Token[]{
 const out:Token[]=[];
 for(const [kind,re,key]of TOKENS){re.lastIndex=0;let m:RegExpExecArray|null;while((m=re.exec(text)))out.push({kind,key:key(m),raw:m[0]});}
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

export function actFindings(model:ActModel):NominalFinding[]{
 return [...responsibilityFindings(model.blocks),...boundaryFindings(model)];
}
