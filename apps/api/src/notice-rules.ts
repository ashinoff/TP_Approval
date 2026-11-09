import type {Block} from './documents.js';
import type {PdfBoundary} from './pdf-model.js';
import type {FindingStatus} from './tu-rules.js';
import {samePerson} from './tu-rules.js';
import type {NominalFinding} from './nominal-rules.js';
import type {AttorneyRow,TgRow} from './references.js';

/**
 * Проверки уведомления об обеспечении возможности присоединения (разбор владельца 09.11.2026, пример — ООО «Славяне»,
 * ПУ в ВРУ заявителя). Дополняют общую сверку с ТУ (tu-rules), номиналы и проверки акта (act-rules):
 * доверенность подписанта по справочнику, дата договора, арифметика мощностей и «везде одна мощность», трансформаторы,
 * tg по справочнику напряжений, учёт по ТУ (п. 10.x) и в п. 3, ПСУ (п. 4), автомат по ТУ (п. 11.x), резервный источник
 * (п. 6), расчёт потерь (п. 7), сторона и место прибора учёта по схеме (п. 8.1, 8.5).
 */
type Value={value:string;quote:string;blockId:string;part:string;shown?:string;area?:{page:number;box:[number,number,number,number]}};
type PdfLike=Block&{page?:number;spans?:{box:[number,number,number,number]}[]};
export type NoticeContext={tuBlocks:Block[];attorneys:AttorneyRow[];tg:TgRow[];psuAttached:boolean;contractDate?:string|null};

const text=(b:Block)=>b.text.replace(/[  ]/g,' ').replace(/ё/g,'е').replace(/Ё/g,'Е');
const norm=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/\s+/g,' ').trim();
const num=(s:string)=>Number(s.replace(/\s/g,'').replace(',','.'));
const kw=(n:number)=>String(Math.round(n*1000)/1000).replace('.',',');
const value=(v:string,b:Block,shown:string):Value=>({value:v,quote:b.text,blockId:b.id,part:b.part,shown});
const usable=(blocks:Block[])=>blocks.filter(b=>b.text.length<=4000);
const result=(field:string,label:string,status:FindingStatus,reason:string,act:Value[],tu:Value[]=[],normText=''):NominalFinding=>
 ({field,label,status,reason,act:act.slice(0,12),tu:tu.slice(0,6),actCandidates:act.length,tuCandidates:tu.length,norm:normText});
const first=(blocks:Block[],re:RegExp)=>{for(const b of usable(blocks)){const m=re.exec(text(b));if(m)return {b,m};}return undefined;};
const all=(blocks:Block[],re:RegExp)=>{const out:{b:Block;m:RegExpExecArray}[]=[];for(const b of usable(blocks)){const g=new RegExp(re.source,re.flags.includes('g')?re.flags:re.flags+'g');let m:RegExpExecArray|null;while((m=g.exec(text(b))))out.push({b,m});}return out;};
/** Ячейка таблицы под заголовком (первая строка данных той же колонки). */
function cell(blocks:Block[],header:RegExp){
 const h=blocks.find(b=>b.table&&header.test(text(b)));if(!h?.table)return undefined;
 return blocks.find(b=>b.table&&b.table.table===h.table!.table&&b.table.cell===h.table!.cell&&b.table.row===h.table!.row+1);
}
const DATE=/(\d{2})\.(\d{2})\.(\d{4})/;
const iso=(d:string)=>{const m=DATE.exec(d);return m?`${m[3]}-${m[2]}-${m[1]}`:'';};
const ru=(isoDate:string)=>isoDate?isoDate.slice(0,10).split('-').reverse().join('.'):'';

// 1. Доверенность подписанта — по справочнику «Доверенности».
function attorney(blocks:Block[],rows:AttorneyRow[]):NominalFinding[]{
 const hit=first(blocks,/в\s+лице\s+(.{5,400}?)\s*,?\s*действующ\p{L}*\s+на\s+основании\s+доверенности\s*№\s*([^\s,;]+?)\s*от\s*(\d{2}\.\d{2}\.\d{4})/iu);
 if(!hit)return [];
 const [,who,numberRaw,date]=hit.m;const number=numberRaw.replace(/[.,]$/,'');
 const fio=/([А-Я][а-я-]+\s+[А-Я]\.\s*[А-Я]\.)\s*$/u.exec(who.trim())?.[1]??'';
 const act=[value(number,hit.b,`доверенность №${number} от ${date}`)];
 const label='Доверенность подписанта';
 if(!rows.length)return [result('attorney',label,'MANUAL_REVIEW',`Справочник доверенностей пуст. Указана доверенность №${number} от ${date} (${fio||'подписант не распознан'}) — заполните справочник в «Справочниках» или сверьте вручную.`,act)];
 const key=(s:string)=>s.toLowerCase().replace(/\s/g,'');
 const row=rows.find(r=>key(r.number)===key(number));
 if(!row)return [result('attorney',label,'DIFFERENCE',`Доверенности №${number} нет в справочнике доверенностей.`,act,[],`В справочнике: ${rows.map(r=>`№${r.number} от ${ru(r.date)}`).join(', ')}.`)];
 const problems:string[]=[];
 if(row.date!==iso(date))problems.push(`дата в документе ${date}, в справочнике ${ru(row.date)}`);
 if(fio&&!samePerson(fio,row.person))problems.push(`подписант в документе ${fio}, по доверенности ${row.person}`);
 if(row.validUntil&&row.validUntil<new Date().toISOString().slice(0,10))problems.push(`срок действия истёк ${ru(row.validUntil)}`);
 const normText=`По справочнику: №${row.number} от ${ru(row.date)} — ${row.position?row.position+' ':''}${row.person}${row.validUntil?`, действует до ${ru(row.validUntil)}`:''}.`;
 return [problems.length?result('attorney',label,'DIFFERENCE',`Доверенность не совпадает со справочником: ${problems.join('; ')}.`,act,[],normText)
  :result('attorney',label,'MATCH',`Доверенность №${number} от ${date} есть в справочнике, подписант ${row.person}.`,act,[],normText)];
}

// 2. Дата договора: «по договору … от 22.04.2026 №…» против даты договора в карточке.
export function noticeContractDate(blocks:Block[]){
 const hit=first(blocks,/договор\p{L}*\s+об\s+осуществлении\s+технологического\s+присоединения\s+от\s+(\d{2}\.\d{2}\.\d{4})/iu);
 return hit?{date:iso(hit.m[1]),shown:hit.m[1],block:hit.b}:undefined;
}
function contractDate(blocks:Block[],card?:string|null):NominalFinding[]{
 const found=noticeContractDate(blocks);if(!found)return [];
 const act=[value(found.date,found.block,`договор от ${found.shown}`)];
 if(!card)return [result('contractDate','Дата договора','INFO',`В документе дата договора ${found.shown}; в карточке дата не указана.`,act)];
 const same=card.slice(0,10)===found.date;
 return [result('contractDate','Дата договора',same?'MATCH':'DIFFERENCE',same?`Дата договора ${found.shown} совпадает с карточкой.`:`В документе договор от ${found.shown}, в карточке — от ${ru(card)}.`,act)];
}

// 3. Мощности: всего = присоединяемая + ранее присоединённая; категория, таблица точек и «Р =» на схеме — та же мощность.
function powers(blocks:Block[]):NominalFinding[]{
 const total=first(blocks,/максимальн\p{L}*\s+мощност\p{L}*\s*\(всего\)\s*(\d+(?:[.,]\d+)?)/iu);
 if(!total)return [];
 const T=num(total.m[1]);const findings:NominalFinding[]=[];
 const added=first(blocks,/без\s+учета\s+ранее\s+присоединенн\p{L}*\s*\(существующ\p{L}*\)\s*максимальн\p{L}*\s+мощност\p{L}*\)\s*(\d+(?:[.,]\d+)?)\s*кВт/iu);
 const existing=first(blocks,/ранее\s+присоединенн\p{L}*\s+максимальн\p{L}*\s+мощност\p{L}*\s*(\d+(?:[.,]\d+)?)\s*кВт/iu);
 const v=(h:{b:Block;m:RegExpExecArray},label:string)=>value(String(num(h.m[1])),h.b,`${label} ${h.m[1]} кВт`);
 if(added&&existing){
  const sum=num(added.m[1])+num(existing.m[1]);const ok=Math.abs(sum-T)<1e-6;
  findings.push(result('powerSum','Мощность: всего = присоединяемая + существующая',ok?'MATCH':'DIFFERENCE',
   ok?`${kw(num(added.m[1]))} + ${kw(num(existing.m[1]))} = ${kw(T)} кВт.`:`${kw(num(added.m[1]))} + ${kw(num(existing.m[1]))} = ${kw(sum)} кВт, а всего указано ${kw(T)} кВт.`,
   [v(total,'всего'),v(added,'присоединяемая'),v(existing,'существующая')]));
 }
 // Везде одна и та же мощность: категория надёжности (сумма I–III), таблица точек, «Р = … кВт» на схеме.
 const places:Value[]=[v(total,'всего')];const wrong:string[]=[];
 const cats=all(blocks,/(I{1,3})\s*-?\s*а?я\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*кВт/iu);
 if(cats.length){const sum=cats.reduce((s,c)=>s+num(c.m[2]),0);places.push(value(String(sum),cats[0].b,`категории I–III: ${kw(sum)} кВт`));if(Math.abs(sum-T)>1e-6)wrong.push(`категории надёжности в сумме ${kw(sum)} кВт`);}
 const tableCell=cell(blocks,/^Максимальная\s+мощность\s*\(кВт\)/iu);
 if(tableCell&&/^\s*\d+(?:[.,]\d+)?\s*$/.test(tableCell.text)){places.push(value(String(num(tableCell.text)),tableCell,`таблица точек: ${tableCell.text.trim()} кВт`));if(Math.abs(num(tableCell.text)-T)>1e-6)wrong.push(`в таблице точек ${tableCell.text.trim()} кВт`);}
 for(const p of all(blocks,/(?<![\p{L}])[РP]\s*=\s*(\d+(?:[.,]\d+)?)\s*кВт/u)){places.push(value(String(num(p.m[1])),p.b,`на схеме Р = ${p.m[1]} кВт`));if(Math.abs(num(p.m[1])-T)>1e-6)wrong.push(`на схеме Р = ${p.m[1]} кВт`);}
 if(places.length>1)findings.push(result('powerEverywhere','Максимальная мощность во всём документе',wrong.length?'DIFFERENCE':'MATCH',
  wrong.length?`Всего ${kw(T)} кВт, но ${wrong.join('; ')}.`:`Во всех местах (${places.length}) — ${kw(T)} кВт: характеристики, категория надёжности, таблица точек, схема.`,places));
 return findings;
}

// 4. Трансформаторы: таблица точек = характеристики присоединения.
function transformers(blocks:Block[]):NominalFinding[]{
 const text_=first(blocks,/номинальной\s+мощности\s+присоединенных\s+к\s+электрической\s+сети\s+трансформаторов\s*(\d+(?:[.,]\d+)?)/iu);
 const c=cell(blocks,/номинальной\s+мощности\s+присоединенных\s+трансформаторов/iu);
 if(!text_||!c||!/^\s*\d+(?:[.,]\d+)?\s*$/.test(c.text))return [];
 const ok=num(text_.m[1])===num(c.text);
 return [result('transformers','Мощность трансформаторов (кВА)',ok?'MATCH':'DIFFERENCE',ok?`В характеристиках и в таблице точек — ${text_.m[1]} кВА.`:`В характеристиках ${text_.m[1]} кВА, в таблице точек ${c.text.trim()} кВА.`,
  [value(String(num(text_.m[1])),text_.b,`${text_.m[1]} кВА`),value(String(num(c.text)),c,`${c.text.trim()} кВА`)])];
}

// 5. tg φ по справочнику напряжений.
function tgPhi(blocks:Block[],rows:TgRow[]):NominalFinding[]{
 const c=cell(blocks,/коэффициента\s+реактивной\s+мощности/iu);const u=cell(blocks,/^Уровень\s+напряжения/iu);
 if(!c||!/^\s*\d+(?:[.,]\d+)?\s*$/.test(c.text))return [];
 const act=[value(String(num(c.text)),c,`tg = ${c.text.trim()}`)];
 const kv=u?num(u.text):NaN;
 if(!Number.isFinite(kv))return [result('tg','Коэффициент реактивной мощности (tg)','MANUAL_REVIEW','Уровень напряжения в таблице точек не распознан — сверьте tg вручную.',act)];
 const row=rows.find(r=>Math.abs(num(r.voltage)-kv)<1e-6);
 if(!row)return [result('tg','Коэффициент реактивной мощности (tg)','MANUAL_REVIEW',`Для напряжения ${kw(kv)} кВ нет строки в справочнике tg — сверьте вручную.`,act)];
 const ok=Math.abs(row.tg-num(c.text))<1e-6;
 return [result('tg','Коэффициент реактивной мощности (tg)',ok?'MATCH':'DIFFERENCE',ok?`Для ${kw(kv)} кВ tg = ${kw(row.tg)}, как в справочнике.`:`Для ${kw(kv)} кВ по справочнику tg = ${kw(row.tg)}, в документе ${c.text.trim()}.`,act,[],`Справочник: ${kw(kv)} кВ → tg ${kw(row.tg)}.`)];
}

// 6. Учёт: по ТУ (п. 10.x «организация учёта … прибор учёта») ставит сетевая организация — в п. 3 у сети должен быть прибор учёта.
function meterByTu(blocks:Block[],tu:Block[]):NominalFinding[]{
 const tuHit=first(tu,/^\s*10\.\d+\.?\s.*учет\p{L}*\s+электроэнерги\p{L}*.*прибор\p{L}*\s+учет/iu);
 const section3=usable(blocks).find((b,i,list)=>i>0&&/^\s*3\.\s*У\s+сетевой\s+организации\s+на\s+границе/iu.test(text(list[i-1])))??first(blocks,/^\s*3\.\s*У\s+сетевой\s+организации\s+на\s+границе.*прибор/iu)?.b;
 if(!tuHit||!section3)return [];
 const has=/прибор\p{L}*\s+учет/iu.test(text(section3));
 return [result('meterNetwork','Прибор учёта у сетевой организации (п. 3, по ТУ)',has?'MATCH':'DIFFERENCE',
  has?'По ТУ учёт организует сетевая организация — прибор учёта указан в её оборудовании на границе.':'По ТУ учёт организует сетевая организация, но в п. 3 прибор учёта у сетевой организации не указан.',
  [value('meter',section3,has?'прибор учета электрической энергии':section3.text.slice(0,80))],[value('10.x',tuHit.b,tuHit.b.text.slice(0,60))])];
}

// 7. ПСУ (п. 4): характеристики учёта — в акте допуска прибора учёта; зелёный, если ПСУ загружен к документу.
function psu(blocks:Block[],attached:boolean):NominalFinding[]{
 const hit=first(blocks,/характеристики\s+установленных\s+измерительных\s+комплексов/iu);if(!hit)return [];
 return [result('psu','Акт допуска прибора учёта (ПСУ, п. 4)',attached?'MATCH':'MANUAL_REVIEW',attached?'ПСУ загружен к документу — откройте его кнопкой «Открыть ПСУ».':'Пункт 4 ссылается на акт допуска прибора учёта, а ПСУ к документу не загружен. Приложите ПСУ в «Данных» или подтвердите вручную.',[value('psu',hit.b,'акт допуска прибора учёта')])];
}

// 8. Автомат: п. 5 уведомления и требование ТУ (п. 11.x «Установить автоматический выключатель…»); номинал проверяется по справочнику.
function breakerByTu(blocks:Block[],tu:Block[]):NominalFinding[]{
 const item=first(blocks,/^\s*5\.\s*Устройства\s+защиты[^:]*:\s*(.+)$/iu);const tuHit=first(tu,/^\s*11\.\d+\.?\s.*автоматическ\p{L}*\s+выключател/iu);
 if(!item||!tuHit)return [];
 const ba=/ВА\s*-?\s*\d+\s*А/iu.exec(item.m[1]);
 return [result('breakerTu','Вводной автомат по ТУ (п. 5)',ba?'MATCH':'DIFFERENCE',ba?`ТУ требуют установить автоматический выключатель — в п. 5 указан ${ba[0]} (номинал проверен по справочнику отдельно).`:'ТУ требуют установить автоматический выключатель, а в п. 5 он не указан.',
  [value(ba?.[0]??'',item.b,ba?.[0]??item.m[1].trim())],[value('11.x',tuHit.b,tuHit.b.text.slice(0,60))])];
}

// 9. Резервный источник (п. 6) против п. 9 ТУ.
function reserve(blocks:Block[],tu:Block[]):NominalFinding[]{
 const item=first(blocks,/автономный\s+резервный\s+источник\s+питания\s*:\s*([^.\n]+)/iu);const tuHit=first(tu,/резервный\s+источник\s+питания\s*:\s*([^.\n]+)/iu);
 if(!item||!tuHit)return [];
 const none=(s:string)=>/^(нет|не\s+требуется|отсутствует|не\s+предусмотрен\p{L}*)$/iu.test(s.trim());
 const a=none(item.m[1]),t=none(tuHit.m[1]);
 const status:FindingStatus=a===t?(a?'MATCH':'MANUAL_REVIEW'):'DIFFERENCE';
 return [result('reserve','Резервный источник питания (п. 6)',status,a&&t?'По ТУ резервного источника нет — в документе «не требуется».':a!==t?`В документе «${item.m[1].trim()}», в ТУ «${tuHit.m[1].trim()}».`:'Резервный источник указан и в ТУ, и в документе — сверьте вручную.',
  [value(norm(item.m[1]),item.b,item.m[1].trim())],[value(norm(tuHit.m[1]),tuHit.b,tuHit.m[1].trim())])];
}

// 10. Расчёт потерь (п. 7): «прилагается» — в документе должна быть таблица расчёта потерь.
function losses(blocks:Block[]):NominalFinding[]{
 const item=first(blocks,/^\s*7\.\s*Прочие\s+сведения\s*:\s*(.+)$/iu);if(!item||!/потер/iu.test(item.m[1]))return [];
 const table=first(blocks,/Расч[её]т\s+потерь\s+электроэнергии\s+в\s+линиях|ИСХОДНЫЕ\s+ДАННЫЕ|Потери\s+электроэнергии\s+помесячно/iu);
 const attached=/прилага/iu.test(item.m[1]);
 if(!attached)return [result('losses','Расчёт потерь (п. 7)','INFO',`В п. 7: «${item.m[1].trim()}».`,[value('losses',item.b,item.m[1].trim())])];
 return [result('losses','Расчёт потерь (п. 7)',table?'MATCH':'DIFFERENCE',table?'Расчёт потерь приложен к документу.':'В п. 7 сказано, что расчёт потерь прилагается, но таблицы расчёта в документе нет.',
  [value('losses',item.b,'расчет потерь прилагается'),...(table?[value('losses',table.b,'расчёт потерь')]:[])])];
}

// 11. Прибор учёта на схеме: сторона границы (п. 8.1) и место установки (п. 8.5).
type Place='vru'|'line'|'network';
const placeName:Record<Place,string>={vru:'в ВРУ заявителя',line:'на опоре / линии заявителя (между границей и ВРУ)',network:'у сетевой организации'};
const centreY=(b:PdfLike)=>b.spans!.reduce((s,sp)=>s+(sp.box[1]+sp.box[3])/2,0)/b.spans!.length;
export function meterPlace(blocks:Block[],line?:PdfBoundary):{place:Place;side:'applicant'|'network';block:PdfLike}|undefined{
 if(!line)return;
 const onPage=(blocks as PdfLike[]).filter(b=>b.page===line.page&&b.spans?.length&&b.text.length<=60);
 const wh=onPage.find(b=>/^\s*W\s*h\s*$/iu.test(b.text));if(!wh)return;
 const y=centreY(wh);const above=y>line.y;const side=above===line.networkAbove?'network':'applicant';
 if(side==='network')return {place:'network',side,block:wh};
 // ВРУ заявителя — надпись «ВРУ…» на стороне заявителя; ПУ ниже надписи (дальше от границы) — в ВРУ, между границей и ВРУ — на опоре/линии.
 const vru=onPage.find(b=>/^\s*ВРУ/u.test(b.text)&&((centreY(b)>line.y)!==line.networkAbove));
 if(!vru)return {place:'vru',side,block:wh};
 const farther=line.networkAbove?y<centreY(vru):y>centreY(vru);
 return {place:farther?'vru':'line',side,block:wh};
}
function meter(blocks:Block[],line?:PdfBoundary):NominalFinding[]{
 const found=meterPlace(blocks,line);if(!found)return [];
 const box=found.block.spans![0].box;const scheme:Value={value:found.place,quote:found.block.text,blockId:found.block.id,part:found.block.part,shown:`Wh — ${placeName[found.place]}`,area:{page:found.block.page!,box}};
 const findings:NominalFinding[]=[];
 const seals=first(blocks,/целостност\p{L}*\s+пломб.*нес[её]т\s*:?\s*([^.;\n]{2,60})/iu);
 if(seals){const who=norm(seals.m[1]);const expected=found.side==='applicant'?'заявитель':'сетевая организация';const ok=who===expected;
  findings.push(result('sealsParty','Ответственный за пломбы и сохранность учёта (п. 8.1)',ok?'MATCH':'DIFFERENCE',
   ok?`Прибор учёта на схеме ${placeName[found.place]} — отвечает ${seals.m[1].trim()}.`:`Прибор учёта на схеме ${placeName[found.place]}, значит отвечает «${found.side==='applicant'?'Заявитель':'Сетевая организация'}», а указано «${seals.m[1].trim()}».`,
   [value(who,seals.b,seals.m[1].trim()),scheme]));}
 const where=first(blocks,/расчетные\s+приборы\s+учета\s+электроэнергии\s+установлены\s+(?:в|на)\s*:?\s*(.+)$/iu);
 if(where){const w=where.m[1];
  const ok=found.place==='vru'?/ВРУ/u.test(w):found.place==='line'?/опор|ВЛ|ЛЭП/iu.test(w):/ТП|РУ|ВУ|опор|ВЛ/u.test(w)&&!/ВРУ/u.test(w);
  findings.push(result('meterPlace','Место установки прибора учёта (п. 8.5)',ok?'MATCH':'DIFFERENCE',
   ok?`На схеме прибор учёта ${placeName[found.place]} — в п. 8.5 «${w.trim()}».`:`На схеме прибор учёта ${placeName[found.place]}, а в п. 8.5 «${w.trim()}».`,
   [value(found.place,where.b,w.trim()),scheme],[],found.place==='line'?'Учёт между границей и ВРУ (сплит-исполнение на опоре) — правило предварительное, уточняется.':''));}
 return findings;
}

// 12. Описание точки присоединения — по элементам: «Контакты присоединения <провод L=…> заявителя от <ВУ…, ТП…> сетевой
// организации в сторону <ВРУ…> заявителя». Элементы сети — в п. 7 ТУ и на схеме со стороны сети, ВРУ — на схеме у заявителя, провод — на схеме.
const key=(s:string)=>s.toLowerCase().replace(/ё/g,'е').replace(/кв(?![\p{L}])/gu,'').replace(/[\s\-–—«»"'.]/g,'');
function point(blocks:Block[],tu:Block[],line?:PdfBoundary):NominalFinding[]{
 const desc=cell(blocks,/^Описание\s+точки\s+присоединения/iu);if(!desc)return [];
 const d=text(desc);
 const network=/\sот\s+(.+?)\s+сетевой\s+организаци/iu.exec(d)?.[1];
 const vru=/в\s+сторону\s+(ВРУ.*?)\s+заявител/iu.exec(d)?.[1];
 const cable=/((?:СИП|А?ВВГ\p{L}*|АПвП\p{L}*)[-\s]*\d?[-\s]*\d\s*[xх×]\s*\d+(?:[.,]\d+)?)/iu.exec(d)?.[1];
 const length=/L\s*=\s*\d+(?:[.,]\d+)?\s*м/u.exec(d)?.[0];
 if(!network)return [];
 const items=network.split(/,\s+/).map(s=>s.trim()).filter(Boolean);
 const tu7=first(tu,/^\s*7\.\s*Точк\p{L}*.*?:\s*(.+)$/iu);
 // Надписи схемы по сторонам красной границы.
 const labels=line?(blocks as PdfLike[]).filter(b=>b.page===line.page&&b.spans?.length&&!b.table&&b.text.length<=80&&!/^\s*\d+(?:\.\d+)*\.\s/u.test(b.text)):[];
 const side=(b:PdfLike)=>((centreY(b)>line!.y)===line!.networkAbove)?'network':'applicant';
 const onScheme=(s:string,want?:'network'|'applicant')=>labels.find(b=>key(b.text).includes(key(s))&&(!want||side(b)===want));
 const act:Value[]=[value(key(network),desc,d.length>90?d.slice(0,90)+'…':d)];const tuValues:Value[]=[];const problems:string[]=[],seen:string[]=[];
 const mark=(b:PdfLike,shown:string)=>act.push({value:key(shown),quote:b.text,blockId:b.id,part:b.part,shown,area:{page:b.page!,box:b.spans![0].box}});
 // Граница на опоре: «от опоры №14 ВЛ-0,4 кВ фидер «Чайная» ТП-А16» — по частям: опора (в ТУ — «ближайшая опора», номер только на схеме),
 // фидер (в ТУ, если там указан; на схеме — подпись линии), ТП (в ТУ и на схеме со стороны сети).
 const pole=/опор\p{L}*\s*№\s*([\d/]+)/iu.exec(network);
 if(pole){
  const feeder=/(?:фидер\p{L}*|ф\.)\s*«([^»]+)»/iu.exec(network)?.[1];
  const tp=/(?<![\p{L}])((?:к?тпн?|ктп|рп)\s*-?\s*[\p{L}]{0,3}\d[\p{L}\d]*)/iu.exec(network)?.[1];
  const poleLabel=labels.find(b=>{const k=key(b.text);return ['оп№','опора№','опоры№'].some(p=>{const at=k.indexOf(p+pole[1]);return at>=0&&!/\d/.test(k[at+p.length+pole[1].length]??'');});});
  if(tu7&&!/опор/iu.test(tu7.m[1]))problems.push('в п. 7 ТУ точка не на опоре');
  if(line){if(poleLabel){mark(poleLabel,`схема: ${poleLabel.text.trim()}`);seen.push(`опора №${pole[1]}`);}else problems.push(`опора №${pole[1]} не найдена на схеме`);}
  if(feeder){const inTu=tu7?key(tu7.m[1]).includes(key(feeder)):true;const sch=line?labels.find(b=>key(b.text).includes(key(feeder))):undefined;
   if(tu7&&/фидер|«/iu.test(tu7.m[1].replace(/«Россети[^»]*»|«Кубаньэнерго»/gu,''))&&!inTu)problems.push(`фидер «${feeder}» не совпадает с п. 7 ТУ`);
   if(line&&!sch)problems.push(`фидер «${feeder}» не найден на схеме`);else if(sch){mark(sch,`схема: ${sch.text.trim()}`);seen.push(`фидер «${feeder}»`);}}
  if(tp){if(tu7&&!key(tu7.m[1]).includes(key(tp)))problems.push(`«${tp}» нет в п. 7 ТУ`);
   const sch=line?onScheme(tp,'network'):undefined;if(line&&!sch)problems.push(`«${tp}» не найден на схеме со стороны сети`);else if(sch){mark(sch,`схема: ${sch.text.trim()}`);seen.push(tp);}}
 }
 else for(const item of items){
  const tuOk=tu7?key(tu7.m[1]).includes(key(item)):false;
  const sch=line?onScheme(item,'network'):undefined;
  if(tu7&&!tuOk)problems.push(`«${item}» нет в п. 7 ТУ`);
  if(line&&!sch)problems.push(`«${item}» не найден на схеме со стороны сети`);
  if(sch){mark(sch,`схема: ${sch.text.trim()}`);seen.push(item);}
 }
 if(tu7)tuValues.push(value(key(tu7.m[1]),tu7.b,tu7.m[1].trim()));
 if(vru&&line){const sch=onScheme(vru.replace(/\s*заявител\p{L}*$/iu,''),'applicant');if(sch){mark(sch,`схема: ${sch.text.trim()} (заявитель)`);seen.push(vru);}else problems.push(`«${vru}» не найден на схеме у заявителя`);}
 for(const part of [cable,length].filter(Boolean) as string[]){if(!line)break;const sch=onScheme(part);if(sch){mark(sch,`схема: ${sch.text.trim()}`);seen.push(part);}else problems.push(`«${part}» нет на схеме`);}
 // ТП: другое обозначение ТП в ТУ — расхождение, не «проверить вручную».
 const codes=(s:string)=>[...s.matchAll(/(?<![\p{L}])(к?тпн?|ктп|рп)\s*-?\s*([\p{L}]{0,3}\d[\p{L}\d]*)/giu)].map(m=>key(m[1]+m[2]));
 const tuCodes=tu7?codes(tu7.m[1]):[],ourCodes=codes(network);
 if(tuCodes.length&&ourCodes.length&&!ourCodes.some(c=>tuCodes.includes(c)))return [result('point','Точка присоединения','DIFFERENCE',`ТП в описании точки (${network}) не совпадает с п. 7 ТУ (${tu7!.m[1].trim()}).`,act,tuValues)];
 return [problems.length?result('point','Точка присоединения','MANUAL_REVIEW',`Описание точки разобрано по элементам; не подтверждено: ${problems.join('; ')}. Сверьте вручную.`,act,tuValues)
  :result('point','Точка присоединения','MATCH',`Все элементы описания точки подтверждены${tu7?' п. 7 ТУ':''}${line?' и схемой':''}: ${seen.join(', ')}.`,act,tuValues)];
}

export function noticeFindings(model:{blocks:Block[];boundaries?:PdfBoundary[]},ctx:NoticeContext):NominalFinding[]{
 const b=model.blocks;
 return [...attorney(b,ctx.attorneys),...contractDate(b,ctx.contractDate),...powers(b),...transformers(b),...tgPhi(b,ctx.tg),...meterByTu(b,ctx.tuBlocks),
  ...psu(b,ctx.psuAttached),...breakerByTu(b,ctx.tuBlocks),...reserve(b,ctx.tuBlocks),...losses(b),...meter(b,model.boundaries?.[0]),...point(b,ctx.tuBlocks,model.boundaries?.[0])];
}
