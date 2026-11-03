import test from 'node:test';
import assert from 'node:assert/strict';
import {xmlBlocks} from '../apps/api/src/documents.js';
import {extractTuMetadata} from '../apps/api/src/tu-import.js';
import {documentFilename} from '../apps/api/src/contract-documents.js';
const blocks=(rows:string[])=>xmlBlocks('<w:document xmlns:w="w"><w:body>'+rows.map(t=>`<w:p><w:r><w:t>${t}</w:t></w:r></w:p>`).join('')+'</w:body></w:document>','word/document.xml');
test('TU import: contract header, applicant, multiline address, explicit date',()=>{
 const r=extractTuMetadata(blocks(['Приложение к договору № 00001-26-00000001-1 от 03.11.2026','об осуществлении технологического присоединения к электрическим сетям','Заявитель: Учебный Заявитель','2. Наименование объекта по адресу: Учебный край,','с. Учебное, ул. Тестовая, д. 1','3. Максимальная мощность: 15 кВт']));
 assert.equal(r.fields.contractNumber.value,'00001-26-00000001-1');assert.equal(r.fields.applicant.value,'Учебный Заявитель');assert.equal(r.fields.address.value,'Учебный край, с. Учебное, ул. Тестовая, д. 1');assert.equal(r.fields.contractDate.value,'2026-11-03');
});
test('TU import: ambiguous source and missing date never guessed',()=>{
 const r=extractTuMetadata(blocks(['Приложение к договору № 001','Приложение к договору № 002','Заявитель: Первый','Заявитель: Второй']));assert.equal(r.fields.contractNumber.status,'AMBIGUOUS');assert.equal(r.fields.contractNumber.value,'');assert.equal(r.fields.applicant.status,'AMBIGUOUS');assert.equal(r.fields.contractDate.value,'');
 assert.equal(extractTuMetadata(blocks(['Приложение к договору № 001 от 31.02.2026'])).fields.contractDate.value,'');
});
test('TU import: split runs and table cell paragraphs are readable; download names use package key',()=>{
 const b=xmlBlocks('<w:document xmlns:w="w"><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Приложение к договору № </w:t></w:r><w:r><w:t>00001-1</w:t></w:r></w:p><w:p><w:r><w:t>Заявитель: Учебный заявитель</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>','word/document.xml');
 assert.equal(extractTuMetadata(b).fields.contractNumber.value,'00001-1');assert.equal(documentFilename('AVTU_DOCX','00001-1',1),'00001-1 АВТУ.docx');assert.equal(documentFilename('TU_DOCX','00001-1',2),'00001-1 ТУ — редакция 2.docx');
});
