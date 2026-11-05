import JSZip from 'jszip';

/**
 * Схемы Visio в просмотре. Word хранит у объекта Visio картинку-превью в EMF (линии — EMF+), которую браузеры не
 * показывают. Перед отрисовкой копия DOCX в памяти готовится так: EMF/WMF переводятся сервером в PNG (кэш по sha256),
 * а объект Visio (w:object) заменяется обычным рисунком VML (w:pict) с той же картинкой и размером.
 * Исходный файл, его хеш и привязки замечаний не меняются: абзацы и их текст остаются прежними.
 */
type Renderer=(bytes:Uint8Array)=>Promise<Blob|null>;
let renderer:Renderer|undefined;
const cache=new Map<string,Promise<Uint8Array|null>>();
export function setVectorRenderer(fn?:Renderer){renderer=fn;}

// Ключ кэша в пределах сеанса (crypto.subtle нет вне HTTPS): FNV-1a + длина.
const digest=(bytes:Uint8Array)=>{let h=0x811c9dc5;for(let i=0;i<bytes.length;i++){h^=bytes[i];h=Math.imul(h,0x01000193);}return (h>>>0).toString(16)+':'+bytes.length;};
async function toPng(bytes:Uint8Array){
 if(!renderer)return null;
 const key=digest(bytes);
 if(!cache.has(key))cache.set(key,renderer(bytes).then(async b=>b?new Uint8Array(await b.arrayBuffer()):null).catch(()=>null));
 return cache.get(key)!;
}

/** Объект Visio → рисунок VML: берётся фигура с превью (v:shape с v:imagedata), сам OLE-объект отбрасывается. */
export function objectsToPictures(xml:string){
 return xml.replace(/<w:object\b[^>]*>([\s\S]*?)<\/w:object>/g,(all,inner:string)=>{
  const shape=/<v:shape\b[^>]*>[\s\S]*?<\/v:shape>/.exec(inner)?.[0];
  return shape&&/<v:imagedata\b/.test(shape)?`<w:pict>${shape}</w:pict>`:all;
 });
}

/** Любой сбой подготовки не мешает просмотру: показывается исходный документ (со схемой-заглушкой). */
export async function prepareVectorDrawings(bytes:ArrayBuffer):Promise<ArrayBuffer>{
 try{return await prepare(bytes);}catch{return bytes;}
}
async function prepare(bytes:ArrayBuffer):Promise<ArrayBuffer>{
 let zip:JSZip;
 try{zip=await JSZip.loadAsync(bytes);}catch{return bytes;}
 let changed=false;
 const media=Object.keys(zip.files).filter(n=>/^word\/media\/[^/]+\.(emf|wmf)$/i.test(n));
 await Promise.all(media.map(async name=>{
  const png=await toPng(await zip.file(name)!.async('uint8array'));
  if(png){zip.file(name,png);changed=true;}
 }));
 for(const part of Object.keys(zip.files).filter(n=>/^word\/(document|header\d*|footer\d*)\.xml$/.test(n))){
  const xml=await zip.file(part)!.async('string');const next=objectsToPictures(xml);
  if(next!==xml){zip.file(part,next);changed=true;}
 }
 return changed?zip.generateAsync({type:'arraybuffer'}):bytes;
}
