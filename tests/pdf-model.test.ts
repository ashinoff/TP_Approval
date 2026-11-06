import test from 'node:test';
import assert from 'node:assert/strict';
import {pdfModel,validatePdf} from '../apps/api/src/pdf-model.js';
import {compareRequisites} from '../apps/api/src/tu-rules.js';
import {checkedPdf,syntheticPdf} from './pdf-fixtures.js';

test('PDF: проверка безопасности и запрет сканов',async()=>{
 await validatePdf(await checkedPdf());
 await assert.rejects(validatePdf(Buffer.from('not a pdf at all')),{code:'INVALID_PDF'});
 await assert.rejects(validatePdf(await syntheticPdf({lines:[],scanned:true})),{code:'PDF_SCANNED'});
 await assert.rejects(validatePdf(await syntheticPdf({lines:['Синтетический документ со сценарием для проверки запрета'],script:true})),{code:'UNSAFE_PDF'});
});

test('PDF: абзацы, таблица по рамкам, координаты кусков, метка у края листа не учитывается',async()=>{
 const pdf=await syntheticPdf({lines:['Приложение к договору № 00001-26-00000004-1','Максимальная мощность (всего) 15 кВт, в том числе:'],
  table:[['№','Источник питания','Уровень напряжения (кВ)','Максимальная мощность (кВт)'],['1','ПС 110/10 кВ «Учебная»','0,4','15']],columns:[30,170,140,140],hiddenEdgeText:'Начальник учебного РЭС'});
 const m=await pdfModel(pdf);
 assert.equal(m.format,'pdf');assert.equal(m.pages.length,1);
 assert.ok(m.blocks.some(b=>b.text==='Приложение к договору № 00001-26-00000004-1'));
 assert.equal(m.blocks.some(b=>b.text.includes('Начальник учебного')),false,'Invisible signature placeholder at the page edge is ignored');
 const header=m.blocks.find(b=>b.text==='Уровень напряжения (кВ)')!,value=m.blocks.find(b=>b.text==='0,4')!;
 assert.ok(header.table&&value.table);assert.equal(header.table!.table,value.table!.table);assert.equal(header.table!.cell,value.table!.cell);assert.equal(value.table!.row,header.table!.row+1);
 const contract=m.blocks.find(b=>b.text.startsWith('Приложение'))!;
 assert.ok(contract.spans.length>0&&contract.spans.every(s=>s.box[2]>s.box[0]&&contract.text.slice(s.start,s.end).length>0));
});

test('PDF: сверка с ТУ работает на тех же правилах, напряжение — из таблицы акта',async()=>{
 const act=await pdfModel(await syntheticPdf({lines:['Акт ТП — синтетический пример','Приложение к договору № 00001-26-00000004-1','Максимальная мощность (всего) 15 кВт, в том числе существующая мощность 7 кВт.'],
  table:[['№','Источник питания','Уровень напряжения (кВ)','Максимальная мощность (кВт)'],['1','ПС 110/10 кВ «Учебная»','0,4','15']],columns:[30,170,140,140]}));
 const tu=await pdfModel(await checkedPdf('15','00001-26-00000004-1','TU'));
 const f=Object.fromEntries(compareRequisites(act.blocks,tu.blocks,'00001-26-00000004-1').map(x=>[x.field,x]));
 assert.equal(f.contract.status,'MATCH');assert.equal(f.power.status,'MATCH');assert.equal(f.voltage.status,'MATCH');
});

test('экземпляр к печати: значки в углах каждого листа, текст документа не меняется',async()=>{
 const {stampCorners}=await import('../apps/api/src/print-copy.js');
 const source=await checkedPdf('15');const stamped=Buffer.from(await stampCorners(source));
 assert.notDeepEqual(stamped,source);await validatePdf(stamped);
 const before=(await pdfModel(source)).blocks.map(b=>b.text),after=(await pdfModel(stamped)).blocks.map(b=>b.text);
 assert.deepEqual(after,before,'Stamped copy has the same text layer');
});
