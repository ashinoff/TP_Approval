import {createHash} from 'node:crypto';
import {mkdir,readdir,readFile,rename,rm,stat,statfs,unlink,writeFile} from 'node:fs/promises';
import {connect} from 'node:net';
import {join} from 'node:path';
import JSZip from 'jszip';
import {HttpError,type DB} from './db.js';

/**
 * Сервисное меню администратора (TECH_ADMIN): удаление документов насовсем, состояние базы и хранилища,
 * очистка мусора, журнал ошибок сервера, резервные копии «база + файлы» и восстановление.
 * Права проверяют функции базы (миграция 022); здесь — работа с диском и архивами.
 */
const FILE_NAME=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const BACKUP_NAME=/^backup-[0-9]{8}-[0-9]{6}(-[a-z]+)?\.zip$/;
const KEEP_BACKUPS=10;
const backupsDir=(storage:string)=>join(storage,'_backups');

// ---------- Журнал ошибок сервера (последние 200, до перезапуска) ----------
type ServerError={at:string;requestId?:string;method:string;path:string;status:number;code:string;detail?:string};
const errors:ServerError[]=[];
export function recordServerError(e:ServerError){errors.unshift(e);errors.length=Math.min(errors.length,200);}

// ---------- Документы ----------
export async function adminDocuments(db:DB,search:string){
 return (await db.query('SELECT app.admin_documents($1) AS list',[search.trim().slice(0,100)])).rows[0].list;
}
/** Удаление в базе (одна транзакция); файлы с диска удаляет вызывающий после фиксации — removeFiles. */
export async function purge(db:DB,kind:'document'|'tu'|'version',id:string){
 const fn={document:'admin_purge_act',tu:'admin_purge_tu',version:'admin_purge_version'}[kind];
 try{return (await db.query(`SELECT app.${fn}($1) AS result`,[id])).rows[0].result as {files:string[]};}
 catch(e){
  const code=(e as {code?:string}).code;
  if(code==='P0002')throw new HttpError(404,'NOT_FOUND','Не найдено — возможно, уже удалено.');
  if(code==='55006')throw new HttpError(409,'PURGE_BLOCKED',kind==='version'?'Версия уже отправлялась на согласование — удалите документ целиком.':kind==='tu'?'По этой редакции ТУ уже шёл цикл согласования — удалите документ целиком.':`ТУ этого документа используются в циклах другого документа: ${(e as Error).message.split(': ').at(-1)}. Сначала удалите его.`);
  throw e;
 }
}
export async function removeFiles(storage:string,ids:string[]){
 for(const id of ids)if(FILE_NAME.test(id))await unlink(join(storage,id)).catch(()=>{});
}

// ---------- Состояние ----------
async function diskFiles(storage:string){
 const names=(await readdir(storage).catch(()=>[] as string[])).filter(n=>FILE_NAME.test(n));
 const sizes=await Promise.all(names.map(n=>stat(join(storage,n)).then(s=>s.size).catch(()=>0)));
 return new Map(names.map((n,i)=>[n,sizes[i]]));
}
function clamavPing(host?:string,port?:number){
 if(!host||!port)return Promise.resolve('не настроен');
 return new Promise<string>(done=>{
  const socket=connect({host,port});const timer=setTimeout(()=>{socket.destroy();done('не отвечает');},2000);
  socket.on('connect',()=>socket.write('zPING\0'));
  socket.on('data',d=>{clearTimeout(timer);socket.destroy();done(d.toString().includes('PONG')?'работает':'ответ не распознан');});
  socket.on('error',()=>{clearTimeout(timer);done('не отвечает');});
 });
}
export async function listBackups(storage:string){
 const dir=backupsDir(storage);
 const names=(await readdir(dir).catch(()=>[] as string[])).filter(n=>BACKUP_NAME.test(n)).sort().reverse();
 return Promise.all(names.map(async name=>{const s=await stat(join(dir,name));return {name,size:s.size,createdAt:s.mtime.toISOString()};}));
}
export async function serviceHealth(db:DB,config:{storagePath:string;clamavHost?:string;clamavPort?:number}){
 const health=(await db.query('SELECT app.admin_health() AS h')).rows[0].h;
 const index:{id:string;size:number}[]=(await db.query('SELECT app.admin_file_index() AS f')).rows[0].f;
 const disk=await diskFiles(config.storagePath);
 const known=new Set(index.map(f=>f.id));
 const missing=index.filter(f=>!disk.has(f.id)).map(f=>f.id);
 const orphans=[...disk.keys()].filter(n=>!known.has(n));
 const fs=await statfs(config.storagePath).catch(()=>null);
 const backups=await listBackups(config.storagePath);
 health.issues.push(
  {code:'missing_on_disk',level:'error',label:'Записи файлов в базе, которых нет на диске',count:missing.length,items:missing.slice(0,20).map(id=>({id}))},
  {code:'orphans_on_disk',level:'warn',label:'Файлы на диске без записи в базе',count:orphans.length,items:orphans.slice(0,20).map(id=>({id,size:disk.get(id)}))});
 return {...health,storage:{files:disk.size,bytes:[...disk.values()].reduce((a,b)=>a+b,0),freeBytes:fs?fs.bavail*fs.bsize:null,totalBytes:fs?fs.blocks*fs.bsize:null},
  antivirus:await clamavPing(config.clamavHost,config.clamavPort),backups,errors:errors.slice(0,50),uptimeSeconds:Math.round(process.uptime()),checkedAt:new Date().toISOString()};
}
/** Очистка: непривязанные файлы старше суток, файлы на диске без записи, записи без файла (если на них ничего не ссылается). */
export async function serviceCleanup(db:DB,storage:string){
 const index:{id:string}[]=(await db.query('SELECT app.admin_file_index() AS f')).rows[0].f;
 const disk=await diskFiles(storage);const known=new Set(index.map(f=>f.id));
 const missing=index.filter(f=>!disk.has(f.id)).map(f=>f.id);
 const result=(await db.query('SELECT app.admin_cleanup($1::uuid[]) AS r',[missing])).rows[0].r as {files:string[];sessions:number};
 const orphans=[...disk.keys()].filter(n=>!known.has(n));
 return {dbFiles:result.files,orphans,sessions:result.sessions};
}

// ---------- Резервные копии ----------
const stamp=()=>new Date().toISOString().replace(/[-:]/g,'').replace('T','-').slice(0,15);
export async function createBackup(db:DB,storage:string,label?:string,actor?:string){
 const data=(await db.query('SELECT app.admin_backup() AS b')).rows[0].b as {migrations:string[];tables:Record<string,{id:string;sha256:string}[]>};
 const zip=new JSZip();
 const files=data.tables.files??[];
 for(const f of files){
  const bytes=await readFile(join(storage,f.id)).catch(()=>null);
  if(bytes)zip.file('files/'+f.id,bytes);
 }
 zip.file('db.json',JSON.stringify(data));
 zip.file('manifest.json',JSON.stringify({format:'tp-approval-backup',version:1,createdAt:new Date().toISOString(),createdBy:actor,migrations:data.migrations,
  documents:data.tables.acts?.length??0,files:files.length,filesSaved:Object.keys(zip.files).filter(n=>n.startsWith('files/')).length},null,1));
 const bytes=await zip.generateAsync({type:'nodebuffer',compression:'DEFLATE',compressionOptions:{level:6}});
 const dir=backupsDir(storage);await mkdir(dir,{recursive:true});
 const name=`backup-${stamp()}${label?'-'+label:''}.zip`;
 await writeFile(join(dir,name),bytes);
 const all=await listBackups(storage);for(const old of all.slice(KEEP_BACKUPS))await unlink(join(dir,old.name)).catch(()=>{});
 return {name,size:bytes.length,documents:data.tables.acts?.length??0,files:files.length};
}
export function backupPath(storage:string,name:string){
 if(!BACKUP_NAME.test(name))throw new HttpError(404,'NOT_FOUND');
 return join(backupsDir(storage),name);
}
export async function deleteBackup(storage:string,name:string){await unlink(backupPath(storage,name)).catch(()=>{throw new HttpError(404,'NOT_FOUND');});}

/** Разбор архива копии: формат, данные и целостность каждого файла (sha256 из базы). */
export async function readBackup(bytes:Buffer){
 let zip:JSZip;try{zip=await JSZip.loadAsync(bytes);}catch{throw new HttpError(422,'BACKUP_INVALID','Файл не является архивом резервной копии.');}
 const manifest=JSON.parse(await zip.file('manifest.json')?.async('string')??'null');
 if(manifest?.format!=='tp-approval-backup'||manifest.version!==1)throw new HttpError(422,'BACKUP_INVALID','Это не резервная копия ТП Согласования.');
 const data=JSON.parse(await zip.file('db.json')?.async('string')??'null');
 if(!data?.tables||!Array.isArray(data.migrations))throw new HttpError(422,'BACKUP_INVALID','В копии нет данных базы.');
 const files=new Map<string,Buffer>();
 for(const f of (data.tables.files??[]) as {id:string;sha256:string}[]){
  if(!FILE_NAME.test(f.id))throw new HttpError(422,'BACKUP_INVALID','Некорректный файл в копии.');
  const entry=zip.file('files/'+f.id);if(!entry)continue;
  const content=await entry.async('nodebuffer');
  if(createHash('sha256').update(content).digest('hex')!==f.sha256)throw new HttpError(422,'BACKUP_CORRUPTED','Файл в копии повреждён: контрольная сумма не совпадает.');
  files.set(f.id,content);
 }
 return {manifest,data,files};
}
/** Файлы копии раскладываются заранее в _restore; после восстановления базы заменяют текущие одним проходом переименований. */
export async function stageRestoreFiles(storage:string,files:Map<string,Buffer>){
 const dir=join(storage,'_restore');await rm(dir,{recursive:true,force:true});await mkdir(dir,{recursive:true});
 for(const [id,content]of files)await writeFile(join(dir,id),content);
 return dir;
}
export async function applyRestoreFiles(storage:string,staged:string){
 for(const name of (await readdir(storage)).filter(n=>FILE_NAME.test(n)))await unlink(join(storage,name)).catch(()=>{});
 for(const name of await readdir(staged))await rename(join(staged,name),join(storage,name));
 await rm(staged,{recursive:true,force:true});
}
