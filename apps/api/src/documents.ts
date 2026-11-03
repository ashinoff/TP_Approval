import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {XMLParser} from 'fast-xml-parser';
import {diffWordsWithSpace} from 'diff';
import {z} from 'zod';
import {validateDocx} from './files.js';
import {HttpError,requireValue,type DB} from './db.js';
import {audit,lockAct,role} from './workflow.js';
export type Block={id:string;part:string;text:string;sha256:string};
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export function xmlBlocks(xml:string,part:string):Block[]{
 const tree=new XMLParser({preserveOrder:true,ignoreAttributes:false,trimValues:false,parseTagValue:false}).parse(xml);const blocks:Block[]=[];
 const content=(nodes:any[]):string=>nodes.map(n=>n['w:t']?content(n['w:t']):n['#text']!==undefined?String(n['#text']):n['w:tab']?'\t':n['w:br']||n['w:cr']?'\n':Object.entries(n).filter(([k])=>![':@','w:pPr','w:rPr','w:instrText','w:del','w:delText'].includes(k)).map(([,v])=>Array.isArray(v)?content(v):'').join('')).join('');
 const walk=(nodes:any[])=>{for(const n of nodes)for(const [key,value]of Object.entries(n)){if(key==='w:p'){const text=content(value as any[]);blocks.push({id:`${part}:p:${blocks.length}`,part,text,sha256:hash(text)});}else if(key!=='w:del'&&Array.isArray(value))walk(value);}};walk(tree);return blocks;
}
export async function documentModel(bytes:Buffer){const parts=await validateDocx(bytes);const blocks:Block[]=[];for(const [part,xml]of parts)if(/^word\/(document|header\d+|footer\d+)\.xml$/.test(part))blocks.push(...xmlBlocks(xml.toString('utf8'),part));return {sha256:hash(bytes),blocks};}
export const anchorSchema=z.object({kind:z.literal('OOXML_PARAGRAPH_V1'),part:z.string().max(100),blockId:z.string().max(150),blockHash:z.string().regex(/^[a-f0-9]{64}$/),fileHash:z.string().regex(/^[a-f0-9]{64}$/),start:z.number().int().min(0),end:z.number().int().min(1),quote:z.string().min(1).max(5000)}).strict();
export function checkAnchor(model:{sha256:string;blocks:Block[]},anchor:z.infer<typeof anchorSchema>){const block=model.blocks.find(b=>b.id===anchor.blockId&&b.part===anchor.part);if(anchor.fileHash!==model.sha256||!block||block.sha256!==anchor.blockHash||anchor.end<=anchor.start||block.text.slice(anchor.start,anchor.end)!==anchor.quote||anchor.end>block.text.length)throw new HttpError(409,'ANCHOR_MISMATCH','Привязка не соответствует исходному DOCX. Выделите фрагмент заново.');}
export async function versionSource(db:DB,storage:string,actId:string,versionId:string){
 const v=requireValue((await db.query("SELECT v.*,f.sha256,f.id AS private_file_id FROM app.versions v JOIN app.files f ON f.id=v.file_id AND f.scan_status='READY' WHERE v.id=$1 AND v.act_id=$2",[versionId,actId])).rows[0]);
 const bytes=await readFile(resolve(storage,v.private_file_id));if(hash(bytes)!==v.sha256)throw new HttpError(500,'FILE_INTEGRITY_FAILURE');return {version:v,bytes};
}
export async function preview(db:DB,storage:string,actId:string,versionId:string){const {version,bytes}=await versionSource(db,storage,actId,versionId);const model=await documentModel(bytes);await audit(db,actId,'DOCUMENT_VIEWED',{versionId,sha256:model.sha256,renderer:'DOCX_PREVIEW_PROTOTYPE'});return {...model,versionId,versionNumber:version.number,renderer:'DOCX_PREVIEW_PROTOTYPE',limitations:['HTML-вёрстка приблизительная; не заменяет Word/ONLYOFFICE.','Автоматическая пагинация и поля PAGE не гарантируются.','Печать недоступна до проверки надёжного генератора.']};}
export const remarkSchema=z.object({versionId:z.string().uuid(),taskId:z.string().uuid(),categoryId:z.string().uuid(),text:z.string().trim().min(1).max(10000),suggestedValue:z.string().max(5000).default(''),discussion:z.string().max(2000).default(''),anchor:anchorSchema}).strict();
export async function createRemark(db:DB,storage:string,actId:string,input:unknown){
 const b=remarkSchema.parse(input);const act=await lockAct(db,actId);
 const task=requireValue((await db.query("SELECT t.*,cy.version_id,cy.closed_at FROM app.tasks t JOIN app.cycles cy ON cy.id=t.cycle_id WHERE t.id=$1 AND t.act_id=$2 AND t.status='OPEN' AND app.task_role(t.role,t.cycle_id)<>'RIRU_ENGINEER' AND app.task_user(t.assignment_id,t.assignee_id)=app.uid()",[b.taskId,actId])).rows[0],403,'ACTIVE_REVIEW_REQUIRED');
 await role(db,task.role,act.res_id);if(task.closed_at||task.version_id!==b.versionId)throw new HttpError(409,'ACTIVE_VERSION_REQUIRED');
 const uid=(await db.query('SELECT app.uid() AS id')).rows[0].id;const source=await versionSource(db,storage,actId,b.versionId);
 if([act.author_id,source.version.created_by].includes(uid))throw new HttpError(403,'SELF_APPROVAL');
 if((await db.query('SELECT 1 FROM app.decisions d JOIN app.tasks t ON t.id=d.task_id WHERE t.act_id=$1 AND d.actor_id=app.uid() AND t.role<>$2',[actId,task.role])).rowCount)throw new HttpError(403,'MULTIPLE_ROLE_APPROVAL');
 const category=requireValue((await db.query('SELECT * FROM app.error_categories WHERE id=$1 AND active',[b.categoryId])).rows[0],422,'CATEGORY_UNAVAILABLE');checkAnchor(await documentModel(source.bytes),b.anchor);
 const c=(await db.query('INSERT INTO app.comments(act_id,version_id,task_id,author_id,text,category_id,category_name,anchor,original_value,suggested_value,discussion) VALUES($1,$2,$3,app.uid(),$4,$5,$6,$7,$8,$9,$10) RETURNING *',[actId,b.versionId,b.taskId,b.text,category.id,category.name,JSON.stringify(b.anchor),b.anchor.quote,b.suggestedValue,b.discussion])).rows[0];await audit(db,actId,'COMMENT_ADDED',{commentId:c.id,versionId:b.versionId,taskId:b.taskId});return c;
}
export function compareText(a:string,b:string){if(a.length+b.length>200000)throw new HttpError(422,'COMPARISON_TOO_LARGE');const changes=diffWordsWithSpace(a,b,{timeout:1000,maxEditLength:20000});if(!changes)throw new HttpError(422,'COMPARISON_TOO_COMPLEX');return changes.map(c=>({text:c.value,type:c.added?'added':c.removed?'removed':'same'}));}
export async function compareVersions(db:DB,storage:string,actId:string,fromId:string,toId:string){
 const from=await versionSource(db,storage,actId,fromId),to=await versionSource(db,storage,actId,toId);if(from.version.number>=to.version.number)throw new HttpError(422,'VERSION_ORDER_REQUIRED');
 const a=await documentModel(from.bytes),b=await documentModel(to.bytes);const text=(m:typeof a)=>m.blocks.map(p=>`[${p.part}] ${p.text}`).join('\n');
 const fields=Array.from(new Set([...Object.keys(from.version.snapshot),...Object.keys(to.version.snapshot)])).filter(k=>JSON.stringify(from.version.snapshot[k])!==JSON.stringify(to.version.snapshot[k])).map(key=>({key,before:from.version.snapshot[key],after:to.version.snapshot[key]}));
 const remarks=(await db.query("SELECT c.id,c.text,c.version_id,c.category_name,coalesce((SELECT e.type FROM app.comment_events e WHERE e.comment_id=c.id AND e.version_id=$2 ORDER BY e.created_at DESC,e.id DESC LIMIT 1),'OPEN') AS status FROM app.comments c JOIN app.versions v ON v.id=c.version_id WHERE c.act_id=$1 AND v.number<=$3 ORDER BY c.created_at,c.id",[actId,toId,to.version.number])).rows;
 await audit(db,actId,'DOCUMENT_COMPARED',{fromId,toId});return {from:{id:fromId,number:from.version.number,sha256:a.sha256},to:{id:toId,number:to.version.number,sha256:b.sha256},changes:compareText(text(a),text(b)),fields,remarks,limitations:'Сравнение текста и сохранённых реквизитов. Геометрия таблиц, объединение ячеек, стили, рисунки и вычисляемые поля автоматически не сравниваются. Привязки замечаний на новую версию не переносятся.'};
}