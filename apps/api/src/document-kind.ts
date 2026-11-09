import {PDFDocument} from 'pdf-lib';
import {HttpError} from './db.js';
import {pdfModel,type PdfBlock} from './pdf-model.js';
import {noticeContractDate} from './notice-rules.js';
import {normalizeContractNumber} from './contract-number.js';

/**
 * Вид документа — по заголовку, без кнопок выбора (решение владельца 09.11.2026). Бывает три вида:
 * «АКТ об осуществлении технологического присоединения» (ACT_TP), «УВЕДОМЛЕНИЕ об обеспечении сетевой организацией
 * возможности присоединения к электрическим сетям» (NOTICE), «АКТ О ВЫПОЛНЕНИИ ТЕХНИЧЕСКИХ УСЛОВИЙ» (AVTU).
 * Документы бывают скреплены в одном PDF: страница с заголовком начинает документ, страницы без заголовка продолжают
 * предыдущий, расчёт потерь относится к акту ТП / уведомлению (п. 7 «расчёт потерь прилагается»).
 */
export type DocType='ACT_TP'|'NOTICE'|'AVTU';
export type DocPart={type:DocType|null;pages:number[];range:string;title:string;contractNumber:string|null;contractDate:string|null};

const flat=(s:string)=>s.replace(/[  \s]+/g,' ').replace(/ё/g,'е').replace(/Ё/g,'Е').trim();
const TITLES:[DocType,RegExp,string][]=[
 ['NOTICE',/^УВЕДОМЛЕНИЕ об обеспечении сетевой организацией возможности присоединения/iu,'Уведомление об обеспечении возможности присоединения'],
 ['AVTU',/^АКТ о выполнении технических условий/iu,'Акт о выполнении технических условий'],
 ['ACT_TP',/^АКТ об осуществлении технологического присоединения/iu,'Акт об осуществлении технологического присоединения'],
];
/** Заголовок страницы: блок «АКТ»/«УВЕДОМЛЕНИЕ» и следующая строка (или всё в одном блоке) среди первых строк страницы. */
function titleOf(blocks:PdfBlock[]):DocType|undefined{
 const head=blocks.slice(0,10);
 for(let i=0;i<head.length;i++){
  const joined=flat(head[i].text+' '+(head[i+1]?.text??'')+' '+(head[i+2]?.text??''));
  if(!/^(АКТ|УВЕДОМЛЕНИЕ)(\s|$)/u.test(flat(head[i].text)))continue;
  for(const [type,re]of TITLES)if(re.test(joined))return type;
 }
}
/** Без заголовка (рисунок, нестандартный бланк) — по устойчивым фразам текста. */
function guess(text:string):DocType|undefined{
 if(/Настоящее уведомление составлено/iu.test(text))return 'NOTICE';
 if(/В ходе проверки рассмотрено выполнение ТУ/iu.test(text))return 'AVTU';
 if(/Настоящий акт составлен/iu.test(text))return 'ACT_TP';
 // Уведомление ссылается само на себя: «Уведомление об обеспечении … от … № N», а в шапке тот же «№ N».
 if(/Уведомление об обеспечении сетевой организацией возможности присоединения/iu.test(text)&&!/Акт об осуществлении технологического присоединения/iu.test(text))return 'NOTICE';
 if(/Акт об осуществлении технологического присоединения/iu.test(text))return 'ACT_TP';
}
const LOSSES=/Расч[её]т потерь электроэнергии в линиях|ИСХОДНЫЕ ДАННЫЕ|Потери электроэнергии помесячно/iu;
const range=(pages:number[])=>pages.reduce<string[]>((out,p,i)=>{if(i&&p===pages[i-1]+1){out[out.length-1]=out[out.length-1].replace(/-\d+$/,'')+'-'+p;}else out.push(String(p));return out;},[]).join(',');

export async function inspectDocument(bytes:Uint8Array):Promise<{pages:number;parts:DocPart[]}>{
 const model=await pdfModel(bytes);
 const byPage=(p:number)=>model.blocks.filter(b=>b.page===p);
 const parts:{type:DocType|null;pages:number[]}[]=[];const losses:number[]=[];
 for(let p=1;p<=model.pages.length;p++){
  const blocks=byPage(p);const type=titleOf(blocks);
  if(type){parts.push({type,pages:[p]});continue;}
  if(LOSSES.test(blocks.slice(0,40).map(b=>b.text).join(' '))&&parts.length){losses.push(p);continue;}
  if(parts.length)parts[parts.length-1].pages.push(p);
  else parts.push({type:guess(blocks.map(b=>b.text).join(' '))??null,pages:[p]});
 }
 if(!parts.length)parts.push({type:null,pages:[]});
 // Расчёт потерь — к акту ТП или уведомлению (п. 7), иначе к предыдущему документу.
 for(const p of losses){const owner=parts.find(x=>x.type==='ACT_TP'||x.type==='NOTICE')??[...parts].reverse().find(x=>x.pages.some(q=>q<p))??parts[0];owner.pages.push(p);owner.pages.sort((a,b)=>a-b);}
 // Один вид дважды (две копии одного документа) — склеиваем, в договоре на вид один документ.
 const merged:typeof parts=[];for(const x of parts){const same=x.type&&merged.find(m=>m.type===x.type);if(same){same.pages.push(...x.pages);same.pages.sort((a,b)=>a-b);}else merged.push(x);}
 return {pages:model.pages.length,parts:merged.map(x=>{
  const blocks=model.blocks.filter(b=>x.pages.includes(b.page));const text=blocks.map(b=>b.text).join(' ');
  const contract=/(\d{5}\s*[-–—]\s*\d{2}\s*[-–—]\s*\d{8}\s*[-–—]\s*\d)/u.exec(text)?.[1];
  return {type:x.type,pages:x.pages,range:range(x.pages),title:x.type?TITLES.find(t=>t[0]===x.type)![2]:'Вид не определён',
   contractNumber:contract?normalizeContractNumber(contract):null,contractDate:noticeContractDate(blocks)?.date??null};
 })};
}

/** Копия выбранных страниц PDF («1-2,4»): исходный файл не меняется, сохраняется только своя часть. */
export async function pdfPages(bytes:Uint8Array,spec:string):Promise<Buffer>{
 const source=await PDFDocument.load(bytes,{updateMetadata:false});const total=source.getPageCount();
 const pages:number[]=[];
 for(const part of spec.split(',')){const [a,b]=part.split('-').map(Number);for(let p=a;p<=(b??a);p++)pages.push(p);}
 if(!pages.length||pages.some(p=>p<1||p>total)||new Set(pages).size!==pages.length)throw new HttpError(422,'PAGES_INVALID','Страницы документа указаны неверно.');
 const out=await PDFDocument.create();
 for(const page of await out.copyPages(source,pages.map(p=>p-1)))out.addPage(page);
 return Buffer.from(await out.save());
}
