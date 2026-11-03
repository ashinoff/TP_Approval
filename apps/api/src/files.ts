import yauzl from 'yauzl';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { connect } from 'node:net';
import { HttpError } from './db.js';

export async function validateDocx(buffer:Buffer,options:{prepareLocalTemplate?:boolean}={}) {
  const entries=new Map<string,Buffer>(); let total=0;let entryCount=0;
  await new Promise<void>((resolve,reject)=>yauzl.fromBuffer(buffer,{lazyEntries:true,validateEntrySizes:true},(error,zip)=>{
    if(error||!zip) {reject(new HttpError(415,'INVALID_DOCX'));return;}
    const fail=(e:unknown)=>{zip.close(); reject(e);};
    zip.on('error',fail); zip.on('end',resolve);
    zip.on('entry',(entry:yauzl.Entry)=>{
      total+=entry.uncompressedSize;
      if(++entryCount>2000||total>100*1024*1024||entry.generalPurposeBitFlag&1||entries.has(entry.fileName)||/(^|\/)(\.\.|embeddings|activeX)(\/|$)|vbaProject|\.exe$/i.test(entry.fileName)) {fail(new HttpError(415,'UNSAFE_DOCX'));return;}
      if(entry.fileName.endsWith('/')) {zip.readEntry();return;}
      zip.openReadStream(entry,(err,stream)=>{
        if(err||!stream) {fail(new HttpError(415,'INVALID_DOCX'));return;}
        const chunks:Buffer[]=[];let size=0;
        stream.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>30*1024*1024) {stream.destroy();fail(new HttpError(413,'DOCX_PART_TOO_LARGE'));} else chunks.push(chunk);});
        stream.on('error',fail);
        stream.on('end',()=>{entries.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();});
      });
    }); zip.readEntry();
  }));
  if(!entries.has('[Content_Types].xml')||!entries.has('word/document.xml')||!entries.has('_rels/.rels')) throw new HttpError(415,'INVALID_DOCX');
  for(const [name,content] of entries) if(/\.(xml|rels)$/i.test(name)) {
    const xml=content.toString('utf8');
    if(/<!DOCTYPE|<!ENTITY/i.test(xml)||XMLValidator.validate(xml)!==true) throw new HttpError(415,'UNSAFE_XML');
    if(name.endsWith('.rels')) {
      const parsed=new XMLParser({ignoreAttributes:false}).parse(xml);
      const relations=parsed.Relationships?.Relationship??[];
      for(const rel of Array.isArray(relations)?relations:[relations]) if(rel['@_TargetMode']==='External') {
        const preparable=options.prepareLocalTemplate&&name==='word/_rels/settings.xml.rels'&&rel['@_Type']==='http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate'&&typeof rel['@_Id']==='string'&&typeof rel['@_Target']==='string'&&/^file:/i.test(rel['@_Target']);
        if(!preparable)throw new HttpError(415,'EXTERNAL_RELATIONSHIP');
      }
    }
  }
  const types=entries.get('[Content_Types].xml')!.toString('utf8');
  if(!types.includes('application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml')||/macroEnabled/i.test(types)) throw new HttpError(415,'INVALID_DOCX_TYPE');
  return entries;
}
export async function antivirus(buffer:Buffer,host?:string,port=3310) {
  if(!host) return; // Development structural validation only; production config requires ClamAV.
  await new Promise<void>((resolve,reject)=>{
    const socket=connect(port,host); let response=''; let settled=false;
    const finish=(error?:Error)=>{if(settled)return;settled=true;socket.destroy();error?reject(error):resolve();};
    socket.setTimeout(15000,()=>finish(new HttpError(503,'SCANNER_TIMEOUT')));
    socket.on('error',()=>finish(new HttpError(503,'SCANNER_UNAVAILABLE')));
    socket.on('data',chunk=>{response+=chunk.toString();if(response.includes('\0')) finish(response.includes('stream: OK')?undefined:new HttpError(415,'ANTIVIRUS_REJECTED'));});
    socket.on('end',()=>finish(new HttpError(503,'SCANNER_INCOMPLETE')));
    socket.on('connect',()=>{
      socket.write('zINSTREAM\0');
      for(let i=0;i<buffer.length;i+=65536){const part=buffer.subarray(i,i+65536);const header=Buffer.alloc(4);header.writeUInt32BE(part.length);socket.write(header);socket.write(part);}
      socket.write(Buffer.alloc(4));
    });
  });
}
