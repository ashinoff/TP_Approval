import JSZip from 'jszip';
import {XMLParser} from 'fast-xml-parser';
import {createHash} from 'node:crypto';
import {validateDocx} from './files.js';
import {HttpError} from './db.js';

// Only an explicit pre-import operation may remove an inert local template link.
// Normal file validation remains strict, and the resulting package is checked again.
export async function prepareTu(bytes:Buffer){
 const parts=await validateDocx(bytes,{prepareLocalTemplate:true});
 const name='word/_rels/settings.xml.rels',rels=parts.get(name)?.toString('utf8');
 const parser=new XMLParser({ignoreAttributes:false});
 const entries=rels?parser.parse(rels).Relationships?.Relationship??[]:[];
 const ids=new Set<string>((Array.isArray(entries)?entries:[entries]).filter(r=>r['@_TargetMode']==='External').map(r=>r['@_Id']));
 if(!ids.size)return {bytes,removedTemplateLinks:0,originalSha256:createHash('sha256').update(bytes).digest('hex')};
 if([...parts.keys()].some(n=>n.toLowerCase().startsWith('_xmlsignatures/')))throw new HttpError(415,'SIGNED_DOCX_PREPARATION_FORBIDDEN','Подписанный DOCX нельзя автоматически преобразовать.');
 const settings=parts.get('word/settings.xml')?.toString('utf8');
 if(!settings)throw new HttpError(415,'UNSAFE_DOCX');
 const attr=(xml:string,key:string)=>new RegExp('(?:\\s)'+key+'\\s*=\\s*([\'"])(.*?)\\1').exec(xml)?.[2];
 const removedR=new Set<string>(),removedS=new Set<string>();
 const cleanR=rels!.replace(/<(?:[\w.-]+:)?Relationship\b[^>]*(?:\/\s*>|>[\s\S]*?<\/(?:[\w.-]+:)?Relationship\s*>)/g,node=>{const id=attr(node,'Id');if(id&&ids.has(id)){removedR.add(id);return '';}return node;});
 const cleanS=settings.replace(/<(?:[\w.-]+:)?attachedTemplate\b[^>]*(?:\/\s*>|>[\s\S]*?<\/(?:[\w.-]+:)?attachedTemplate\s*>)/g,node=>{const id=attr(node,'[\\w.-]+:id');if(id&&ids.has(id)){removedS.add(id);return '';}return node;});
 if(removedR.size!==ids.size||removedS.size!==ids.size)throw new HttpError(415,'UNSAFE_DOCX','Связь с шаблоном не удалось безопасно удалить.');
 const changes=new Map([[name,Buffer.from(cleanR)],['word/settings.xml',Buffer.from(cleanS)]]);
 const archive=new JSZip();for(const [part,data]of parts)archive.file(part,changes.get(part)??data);
 const prepared=await archive.generateAsync({type:'nodebuffer',compression:'DEFLATE'});
 const checked=await validateDocx(prepared);
 for(const [part,data]of parts)if(!changes.has(part)&&!data.equals(checked.get(part)!))throw new HttpError(500,'FILE_INTEGRITY_FAILURE');
 return {bytes:prepared,removedTemplateLinks:ids.size,originalSha256:createHash('sha256').update(bytes).digest('hex')};
}
