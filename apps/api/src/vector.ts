import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {HttpError} from './db.js';

/**
 * Показ схем Visio: браузеры не умеют EMF/WMF (а линии схем Visio — EMF+). LibreOffice на сервере переводит рисунок
 * в PNG один раз, результат хранится в кэше по sha256 исходника. Программа не открывает сам объект Visio —
 * только картинку-превью, которую Word хранит рядом с ним. По одному преобразованию за раз, с ограничением времени.
 */
const MAX_BYTES=10*1024*1024;
export const isVector=(b:Buffer)=>b.length>=44&&(
 (b.readUInt32LE(0)===1&&b.toString('latin1',40,44)===' EMF')||   // EMF: EMR_HEADER + сигнатура « EMF»
 b.readUInt32LE(0)===0x9ac6cdd7||                                 // WMF с заголовком Aldus
 ((b.readUInt16LE(0)===1||b.readUInt16LE(0)===2)&&b.readUInt16LE(2)===9)); // WMF стандартный
let queue:Promise<unknown>=Promise.resolve();
const soffice=process.env.SOFFICE_PATH??'soffice';

function convert(input:Buffer):Promise<Buffer>{
 return new Promise((done,fail)=>{
  void (async()=>{
   const dir=await mkdtemp(join(tmpdir(),'vector-'));
   try{
    const source=join(dir,'picture.'+(input.toString('latin1',40,44)===' EMF'?'emf':'wmf'));
    await writeFile(source,input);
    await new Promise<void>((ok,bad)=>execFile(soffice,['--headless','--norestore','--nologo','--nolockcheck',`-env:UserInstallation=file://${join(dir,'profile').replace(/\\/g,'/')}`,'--convert-to','png','--outdir',dir,source],
     {timeout:30000,env:{...process.env,HOME:dir}},error=>error?bad(error):ok()));
    done(await readFile(join(dir,'picture.png')));
   }catch(e){fail(e);}
   finally{await rm(dir,{recursive:true,force:true}).catch(()=>{});}
  })();
 });
}

export async function renderVector(storage:string,input:Buffer){
 if(!input.length||input.length>MAX_BYTES||!isVector(input))throw new HttpError(415,'VECTOR_REQUIRED','Ожидается рисунок EMF или WMF.');
 const cacheDir=join(storage,'_derived');const key=createHash('sha256').update(input).digest('hex');const cached=join(cacheDir,key+'.png');
 const hit=await readFile(cached).catch(()=>null);if(hit)return hit;
 const job=queue.then(()=>convert(input));queue=job.catch(()=>{});
 let png:Buffer;
 try{png=await job;}
 catch(e){
  if((e as {code?:string}).code==='ENOENT')throw new HttpError(501,'RENDERER_UNAVAILABLE','Преобразование схем на сервере не установлено.');
  throw new HttpError(422,'VECTOR_RENDER_FAILED','Не удалось преобразовать рисунок.');
 }
 await mkdir(cacheDir,{recursive:true});await writeFile(cached,png);
 return png;
}
