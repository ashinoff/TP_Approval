import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {breakers,cables,currentTransformers,nominalFindings} from '../apps/api/src/nominal-rules.js';
const blocks=(lines:string[])=>lines.map((text,i)=>({id:`b${i}`,part:'word/document.xml',text,sha256:''})) as any;
// Справочники берутся из миграции, чтобы тест проверял именно исходные значения владельца.
const seeds=[...readFileSync(new URL('../db/migrations/021_reference_books.sql',import.meta.url),'utf8').matchAll(/'(\[\{[\s\S]*?\}\])'/g)].map(m=>JSON.parse(m[1]));
const refs={breakers:{rows:seeds[0],revision:1},cables:{rows:seeds[1],revision:1,brands:['СИП']}};
const act=(power:string,extra:string[])=>blocks([`Максимальная мощность (всего) ${power} кВт, в том числе:`,'Уровень напряжения: 0,4 кВ',...extra]);
const tu=blocks(['Максимальная мощность: 30 кВт','Класс напряжения: 0,4 кВ','Установка трёхфазных средств учёта прямого включения. Установить автоматический выключатель с Iн по расчету.']);
const byField=(f:any[])=>Object.fromEntries(f.map(x=>[x.field,x]));

test('номиналы ВА, ТТ и сечения читаются из текста и надписей схемы',()=>{
 assert.deepEqual(breakers(blocks(['Устройства защиты: ВА-80А.','ВА-50АВА-50А','автоматический выключатель с Iн= 25 А','ВА 47-29 3P 32 А'])).map(v=>v.value),['80','50','25','32']);
 assert.deepEqual(breakers(blocks(['совокупная мощность трансформаторов 0,0 (ноль) кВА.','Iн по расчету'])),[]);
 assert.deepEqual(currentTransformers(blocks(['Учёт через ТТ 150/5','поверку счетчиков, трансформаторов тока несет Сетевая организация','№07-02/0102-26'])).map(v=>v.value),['150']);
 assert.deepEqual(cables(blocks(['Контакты присоединения СИП 4х50 L=23м','ВВГнг-LS 3x2,5','АВВГ 4×25','ВРУ-0,4 кВ, ЛЭП-0,4кВ, ТП-А338'])).map(v=>v.value),['СИП 4×50','ВВГНГ-LS 3×2,5','АВВГ 4×25']);
});

test('30 кВт, 3ф: ВА-50А и СИП 4х16 соответствуют справочнику',()=>{
 const f=byField(nominalFindings(act('30',['ВРУ-0,4 кВ, ВА-50А','СИП 4х16 L=7м']),tu,refs));
 assert.equal(f.normBreaker.status,'MATCH');assert.match(f.normBreaker.norm,/не выше 50 А/);
 assert.equal(f.normCable.status,'MATCH');assert.equal(f.normCt,undefined);
});

test('ВА выше номинала и тонкий СИП — расхождения; явный Iн из ТУ сверяется',()=>{
 const f=byField(nominalFindings(act('30',['ВА-63А','СИП 2х16']),tu,refs));
 assert.equal(f.normBreaker.status,'DIFFERENCE');assert.match(f.normBreaker.reason,/63 А выше допустимого 50 А/);
 assert.equal(f.normCable.status,'DIFFERENCE');
 const strict=blocks(['Максимальная мощность: 15 кВт','Класс напряжения: 0,4 кВ','Трёхфазный ввод. Установить автоматический выключатель с Iн= 25 А.']);
 assert.equal(byField(nominalFindings(act('15',['ВА-20А']),strict,refs)).normBreaker.status,'DIFFERENCE');
 assert.equal(byField(nominalFindings(act('15',['ВА-25А']),strict,refs)).normBreaker.status,'MATCH');
});

test('с 50 кВт справочник требует ТТ: без них — проверить вручную, ниже нормы — расхождение',()=>{
 assert.equal(byField(nominalFindings(act('50',['ВА-80А']),tu,refs)).normCt.status,'MANUAL_REVIEW');
 assert.equal(byField(nominalFindings(act('70',['ВА-125А','ТТ 100/5']),tu,refs)).normCt.status,'DIFFERENCE');
 assert.equal(byField(nominalFindings(act('70',['ВА-125А','ТТ 200/5']),tu,refs)).normCt.status,'MATCH');
});

test('однофазный по карточке, марки вне справочника — для сведения, без фазности — вручную',()=>{
 const one=byField(nominalFindings(act('10',['ВА-50А','СИП 2х16','АВВГ 2х10']),tu,refs,{phases:'1ф'}));
 assert.equal(one.normBreaker.status,'MATCH');assert.match(one.normBreaker.norm,/1ф/);
 assert.equal(one.normCable.status,'MATCH');assert.equal(one.normCableOther.status,'INFO');
 const unknown=nominalFindings(blocks(['ВА-50А']),blocks(['ТУ без реквизитов']),refs);
 assert.equal(unknown[0].status,'MANUAL_REVIEW');
});
