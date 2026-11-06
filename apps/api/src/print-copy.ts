import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {PDFDocument,rgb} from 'pdf-lib';
import {HttpError,requireValue,type DB} from './db.js';
import {audit} from './workflow.js';
import {documentFilename} from './contract-documents.js';

/**
 * Экземпляр к печати (решение владельца 06.11.2026): согласованная версия PDF выходит со служебными значками
 * в четырёх углах каждого листа — маленький синий круг с фирменной молнией (как знак в меню программы).
 * Так распечатку можно опознать как выпущенную программой из согласованной версии. Исходный файл не меняется,
 * значки ставятся только в копию; без QR и служебных данных — посторонним они не нужны.
 */
const BLUE=rgb(11/255,77/255,162/255);
const ZAP='M13 2 4 14h7l-1 8 9-12h-7z';

export async function stampCorners(bytes:Uint8Array){
 const pdf=await PDFDocument.load(bytes,{updateMetadata:false});
 const r=7.5,inset=22;
 for(const page of pdf.getPages()){
  const {width,height}=page.getSize();
  for(const [cx,cy]of [[inset,height-inset],[width-inset,height-inset],[inset,inset],[width-inset,inset]]){
   page.drawCircle({x:cx,y:cy,size:r,color:BLUE,borderColor:rgb(1,1,1),borderWidth:0.8});
   // Молния: путь 24×24, ось Y вниз — drawSvgPath переворачивает сам; масштаб под круг.
   const scale=(r*1.25)/24;
   page.drawSvgPath(ZAP,{x:cx-12*scale,y:cy+12*scale,scale,color:rgb(1,1,1),borderWidth:0});
  }
 }
 return pdf.save({useObjectStreams:false});
}

/** Согласованная публикация документа → PDF со значками; только для действующей публикации в PDF. */
export async function printCopy(db:DB,storage:string,actId:string){
 const row=requireValue((await db.query(`SELECT a.id,a.contract_number,r.id AS release_id,r.status,v.number AS version_number,f.id AS file_id,f.kind,f.sha256
  FROM app.acts a JOIN app.releases r ON r.act_id=a.id AND r.status IN ('CURRENT','UNDER_REVISION') JOIN app.versions v ON v.id=r.version_id JOIN app.files f ON f.id=v.file_id AND f.scan_status='READY'
  WHERE a.id=$1`,[actId])).rows[0],409,'PRINT_REQUIRES_APPROVAL');
 if(!row.kind.endsWith('_PDF'))throw new HttpError(409,'PRINT_REQUIRES_PDF','Экземпляр к печати выпускается для документов в PDF. Согласованная версия этого документа — DOCX.');
 const bytes=await readFile(resolve(storage,row.file_id));
 if(createHash('sha256').update(bytes).digest('hex')!==row.sha256)throw new HttpError(500,'FILE_INTEGRITY_FAILURE');
 const stamped=await stampCorners(new Uint8Array(bytes));
 await audit(db,actId,'PRINT_COPY_ISSUED',{releaseId:row.release_id,versionNumber:row.version_number,sha256:createHash('sha256').update(stamped).digest('hex')});
 return {bytes:Buffer.from(stamped),filename:documentFilename(row.kind,row.contract_number,row.version_number).replace(/\.pdf$/,' — к печати.pdf')};
}
