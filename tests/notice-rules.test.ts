import test from 'node:test';
import assert from 'node:assert/strict';
import {PDFDocument} from 'pdf-lib';
import type {Block} from '../apps/api/src/documents.js';
import {noticeFindings} from '../apps/api/src/notice-rules.js';
import {inspectDocument,pdfPages} from '../apps/api/src/document-kind.js';
import {syntheticPdf} from './pdf-fixtures.js';

// Синтетическое уведомление по образцу разбора владельца (09.11.2026); реальные документы в Git не хранятся.
const lines=[
 'Настоящее уведомление составлено Публичным акционерным обществом «Синтетика», в лице Помощника директора Учебной Л.О., действующей на основании доверенности №1/2-ТЕСТ от 15.12.2025г.',
 '1. Сетевая организация оказала заявителю услугу по договору об осуществлении технологического присоединения от 22.04.2026 №00001-26-00000004-1 в полном объеме.',
 'Максимальная мощность (всего) 50 кВт, в том числе:',
 'максимальная мощность (без учета ранее присоединенной (существующей) максимальной мощности) 35 кВт;',
 'ранее присоединенная максимальная мощность 15 кВт',
 'совокупная величина номинальной мощности присоединенных к электрической сети трансформаторов 0,0 (ноль) кВА. Категория надежности электроснабжения I-ая – 0,0 кВт; II-ая – 0,0 кВт; III-я – 50 кВт',
 '3. У сетевой организации на границе балансовой принадлежности находятся следующие технологически соединенные элементы электрической сети:',
 'ВУ-0,4кВ, ТП-У1, электронный прибор учета электрической энергии.',
 '4. Характеристики установленных измерительных комплексов содержатся в акте допуска прибора учета электрической энергии в эксплуатацию.',
 '5. Устройства защиты, релейной защиты, противоаварийной и режимной автоматики: ВА-80А.',
 '6. Автономный резервный источник питания: не требуется',
 '7. Прочие сведения: расчет потерь электроэнергии прилагается.',
 'Р = 50 кВт',
];
const blocks=(texts:string[],prefix='n'):Block[]=>texts.map((text,i)=>({id:`${prefix}${i}`,part:'pdf/page1',text,sha256:''}));
const table=(header:string,value:string,cell:number):Block[]=>[{id:'h'+cell,part:'pdf/page1',text:header,sha256:'',table:{table:0,row:0,cell}},{id:'v'+cell,part:'pdf/page1',text:value,sha256:'',table:{table:0,row:1,cell}}];
const notice=[...blocks(lines),...table('Уровень напряжения (кВ)','0,4',3),...table('Максимальная мощность (кВт)','50',4),
 ...table('Величина номинальной мощности присоединенных трансформаторов (кВА)','0,0',5),...table('Предельное значение коэффициента реактивной мощности (tg)','0,35',6),
 ...table('Описание точки присоединения','Контакты присоединения ВВГ 4х25 L=5м заявителя от ВУ-0,4кВ Учебное, ТП-У1 сетевой организации в сторону ВРУ-0,4кВ заявителя',2)];
const tu=blocks(['7. Точка(и) присоединения (вводные распределительные устройства): ВУ-0,4 кВ Учебное от ТП-У1 (50 кВт).','9. Резервный источник питания: нет.','10.2. Комплекс мероприятий, необходимых для организации учёта электроэнергии на границе балансовой принадлежности, применив прибор учёта электрической энергии.','11.5. Установить автоматический выключатель с Iн по расчету.'],'t');
const ctx={tuBlocks:tu,attorneys:[{number:'1/2-ТЕСТ',date:'2025-12-15',person:'Учебная Л.О.',position:'Помощник директора',validUntil:null}],tg:[{voltage:'0.4',tg:0.35}],psuAttached:true,contractDate:'2026-04-22'};
const byField=(f:{field:string}[])=>Object.fromEntries(f.map(x=>[x.field,x]))as Record<string,any>;

test('Notice: attorney, contract date, powers, transformers, tg, meter by TU, PSU, breaker, reserve match the owner walkthrough',()=>{
 const f=byField(noticeFindings({blocks:notice},ctx));
 for(const field of ['point','attorney','contractDate','powerSum','powerEverywhere','transformers','tg','meterNetwork','psu','breakerTu','reserve'])assert.equal(f[field]?.status,'MATCH',field+': '+f[field]?.reason);
 assert.equal(f.losses.status,'DIFFERENCE','«прилагается», а таблицы расчёта нет');
});
test('Notice: wrong attorney, sum, tg and missing PSU are reported',()=>{
 const changed=notice.map(b=>b.text.startsWith('ранее присоединенная')?{...b,text:'ранее присоединенная максимальная мощность 10 кВт'}:b.id==='v6'?{...b,text:'0,4'}:b);
 const f=byField(noticeFindings({blocks:changed},{...ctx,attorneys:[{...ctx.attorneys[0],date:'2025-12-16'}],psuAttached:false}));
 assert.equal(f.attorney.status,'DIFFERENCE');assert.match(f.attorney.reason,/дата/);
 assert.equal(f.powerSum.status,'DIFFERENCE');
 assert.equal(byField(noticeFindings({blocks:notice},{...ctx,tuBlocks:blocks(['7. Точка(и) присоединения: ВУ-0,4 кВ Учебное от ТП-У2 (50 кВт).'],'t')})).point.status,'DIFFERENCE','другая ТП в п. 7 ТУ');assert.equal(f.tg.status,'DIFFERENCE');assert.equal(f.psu.status,'MANUAL_REVIEW');
 assert.equal(byField(noticeFindings({blocks:notice},{...ctx,attorneys:[]})).attorney.status,'MANUAL_REVIEW','пустой справочник — ручная проверка');
});

async function merge(...docs:Uint8Array[]){const out=await PDFDocument.create();for(const d of docs){const src=await PDFDocument.load(d);for(const p of await out.copyPages(src,src.getPageIndices()))out.addPage(p);}return out.save();}
test('Document kind by title; stapled act + AVTU + losses split into separate documents',async()=>{
 const act=await syntheticPdf({lines:['АКТ','об осуществлении технологического присоединения','Настоящий акт составлен синтетически.','по договору об осуществлении технологического присоединения от 01.02.2026','№00001-26-00000004-1']});
 const avtu=await syntheticPdf({lines:['АКТ','О ВЫПОЛНЕНИИ ТЕХНИЧЕСКИХ УСЛОВИЙ','В ходе проверки рассмотрено выполнение ТУ.']});
 const losses=await syntheticPdf({lines:['Расчет потерь электроэнергии в линиях ВН, СН1, СН2, НН.','ИСХОДНЫЕ ДАННЫЕ']});
 const stapled=await merge(act,avtu,losses);
 const r=await inspectDocument(stapled);
 assert.deepEqual(r.parts.map(p=>[p.type,p.range]),[['ACT_TP','1,3'],['AVTU','2']]);
 assert.equal(r.parts[0].contractNumber,'00001-26-00000004-1');assert.equal(r.parts[0].contractDate,'2026-02-01');
 assert.equal((await PDFDocument.load(await pdfPages(stapled,'1,3'))).getPageCount(),2);
 await assert.rejects(pdfPages(stapled,'4'));
 const noticePdf=await syntheticPdf({lines:['УВЕДОМЛЕНИЕ','об обеспечении сетевой организацией возможности присоединения к электрическим сетям']});
 assert.deepEqual((await inspectDocument(noticePdf)).parts.map(p=>p.type),['NOTICE']);
 assert.deepEqual((await inspectDocument(await syntheticPdf({lines:['Синтетический документ без заголовка']}))).parts.map(p=>p.type),[null]);
});
