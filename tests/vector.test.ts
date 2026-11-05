import test from 'node:test';
import assert from 'node:assert/strict';
import {objectsToPictures} from '../apps/web/src/vector-preview.js';
import {isVector,renderVector} from '../apps/api/src/vector.js';

test('объект Visio заменяется рисунком VML с той же фигурой; прочие объекты не трогаются',()=>{
 const shape='<v:shape id="_x0000_i1025" type="#_x0000_t75" style="width:467pt;height:300pt" o:ole=""><v:imagedata r:id="rId9" o:title=""/></v:shape>';
 const xml=`<w:p><w:r><w:object w:dxaOrig="9340" w:dyaOrig="6000"><v:shapetype id="_x0000_t75"/>${shape}<o:OLEObject Type="Embed" ProgID="Visio.Drawing.15" ShapeID="_x0000_i1025" r:id="rId10"/></w:object></w:r></w:p>`;
 assert.equal(objectsToPictures(xml),`<w:p><w:r><w:pict>${shape}</w:pict></w:r></w:p>`);
 const noPreview='<w:object><o:OLEObject r:id="rId3"/></w:object>';
 assert.equal(objectsToPictures(noPreview),noPreview);
});

test('распознаются EMF и WMF; прочее не отправляется в преобразование',async()=>{
 const emf=Buffer.alloc(64);emf.writeUInt32LE(1,0);emf.write(' EMF',40,'latin1');
 const wmf=Buffer.alloc(64);wmf.writeUInt32LE(0x9ac6cdd7,0);
 assert.equal(isVector(emf),true);assert.equal(isVector(wmf),true);
 assert.equal(isVector(Buffer.from('\x89PNG\r\n\x1a\n'+'x'.repeat(60),'latin1')),false);
 await assert.rejects(renderVector('.',Buffer.from('not a picture'.repeat(5))),{code:'VECTOR_REQUIRED'});
});
