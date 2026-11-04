import test from 'node:test';
import assert from 'node:assert/strict';
import {tuCardFacts} from '../apps/api/src/tu-rules.js';
import {extractTuMetadata} from '../apps/api/src/tu-import.js';
const blocks=(lines:string[])=>lines.map((text,i)=>({id:`b${i}`,part:'word/document.xml',text,sha256:''})) as any;

test('мощность и напряжение из ТУ переводятся в кВт и кВ',()=>{
 const f=tuCardFacts(blocks(['Максимальная мощность: 15 кВт, в том числе существующая 7 кВт','Класс напряжения электрических сетей: 0,4 кВ','Трёхфазный ввод']));
 assert.deepEqual([f.power_kw.value,f.power_kw.status],['15','FOUND']);
 assert.deepEqual([f.voltage_kv.value,f.voltage_kv.status],['0.4','FOUND']);
 assert.deepEqual([f.phases.value,f.phases.status],['3ф','FOUND']);
});
test('дробная мощность и однофазный ввод по напряжению',()=>{
 const f=tuCardFacts(blocks(['Максимальная мощность: 8,5 кВт','Уровень напряжения: 230 В']));
 assert.equal(f.power_kw.value,'8.5');assert.equal(f.voltage_kv.value,'0.23');
 assert.deepEqual([f.phases.value,f.phases.status],['1ф','DERIVED']);
});
test('трансформаторы тока дают 3фтт, разные значения мощности — неоднозначно',()=>{
 const f=tuCardFacts(blocks(['Максимальная мощность: 150 кВт','Максимальная мощность: 120 кВт','Класс напряжения: 0,4 кВ','Учёт через трансформаторы тока']));
 assert.equal(f.power_kw.status,'AMBIGUOUS');assert.equal(f.power_kw.value,'');
 assert.deepEqual([f.phases.value,f.phases.status],['3фтт','DERIVED']);
});
test('предложения карточки входят в ответ импорта ТУ',()=>{
 const r=extractTuMetadata(blocks(['Приложение к договору № 00123-26-00004567-1 от 03.11.2026','Максимальная мощность: 15 кВт']));
 assert.equal(r.card.power_kw.value,'15');assert.equal(r.card.voltage_kv.status,'NOT_FOUND');assert.equal(r.card.phases.status,'NOT_FOUND');
});
