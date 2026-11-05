import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareTu} from '../apps/api/src/prepare-tu.js';
import {validateDocx} from '../apps/api/src/files.js';
import {zip,docxParts} from './zip.js';
const relationship=(type='attachedTemplate',target='file:///synthetic/template.dotx')=>`<Relationships><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" TargetMode="External" Target="${target}"/></Relationships>`;
const parts={...docxParts,'word/settings.xml':'<w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="rId1"/><w:zoom w:percent="100"/></w:settings>','word/_rels/settings.xml.rels':relationship()};
// С 05.11.2026 внешние связи бланков игнорируются (решение владельца), но связь ТУ с локальным шаблоном по-прежнему удаляется до импорта.
test('TU preparation removes only local attached template; the rest of the file is unchanged',async()=>{
 const original=zip(parts),copy=Buffer.from(original);await validateDocx(original);const r=await prepareTu(original);assert.equal(r.removedTemplateLinks,1);assert.deepEqual(original,copy);const checked=await validateDocx(r.bytes);
 for(const [name,data]of Object.entries(parts))if(!['word/settings.xml','word/_rels/settings.xml.rels'].includes(name))assert.equal(checked.get(name)?.toString(),data);
 assert.ok(checked.get('word/settings.xml')?.toString().includes('w:zoom'));assert.ok(!checked.get('word/settings.xml')?.toString().includes('attachedTemplate'));
 const again=await prepareTu(r.bytes);assert.equal(again.removedTemplateLinks,0);assert.deepEqual(again.bytes,r.bytes);
});
test('TU preparation never rewrites signed files and rejects mismatched template references',async()=>{
 for(const changes of [
  {'_xmlsignatures/sig1.xml':'<Signature/>'},
  {'word/settings.xml':'<w:settings xmlns:w="w"/>'},
 ] as Record<string,string>[])await assert.rejects(prepareTu(zip({...parts,...changes})));
 // Гиперссылка в шапке бланка не мешает подготовке.
 const linked=await prepareTu(zip({...parts,'word/_rels/document.xml.rels':relationship('hyperlink','http://www.example.test')}));assert.equal(linked.removedTemplateLinks,1);
});
