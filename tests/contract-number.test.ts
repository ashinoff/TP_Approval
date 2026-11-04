import test from 'node:test';
import assert from 'node:assert/strict';
import {isContractNumber,normalizeContractNumber,requireContractNumber} from '../apps/api/src/contract-number.js';
import {extractTuMetadata} from '../apps/api/src/tu-import.js';

const blocks=(lines:string[])=>lines.map((text,i)=>({id:`b${i}`,part:'word/document.xml',text})) as any;

test('формат номера договора ТП совпадает с «Учётом ПУ»',()=>{
 assert.equal(isContractNumber('00123-26-00004567-1'),true);
 for(const bad of ['0001/ТП','00123-26-0004567-1','00123-26-00004567','А0123-26-00004567-1',' 00123-26-00004567-1x'])assert.equal(isContractNumber(bad),false,bad);
});
test('типографские тире и пробелы приводятся к единому виду',()=>{
 assert.equal(normalizeContractNumber(' 00123 – 26 — 00004567 ‑ 1 '),'00123-26-00004567-1');
 assert.equal(requireContractNumber('00123—26—00004567—1'),'00123-26-00004567-1');
 assert.throws(()=>requireContractNumber('ТЕСТ-1'),(e:any)=>e.code==='CONTRACT_NUMBER_FORMAT'&&e.status===422);
});
test('номер из ТУ в чужом формате не считается найденным',()=>{
 assert.equal(extractTuMetadata(blocks(['Приложение к договору № 00123–26–00004567–1 от 03.11.2026'])).fields.contractNumber.status,'FOUND');
 const r=extractTuMetadata(blocks(['Приложение к договору № 0001/ТП']));
 assert.equal(r.fields.contractNumber.status,'INVALID_FORMAT');assert.equal(r.fields.contractNumber.value,'0001/ТП');
});
