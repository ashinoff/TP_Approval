import {isBody} from './documents.js';
import {z} from 'zod';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {HttpError,requireValue,type DB} from './db.js';
import {audit,lockAct,revision,role} from './workflow.js';
import {documentModel} from './documents.js';
import {tuCardFacts} from './tu-rules.js';

type Row=Record<string,any>;
const PREPARING=['DRAFT','RETURNED','REVISING'];

export async function cardFields(db:DB,all=false){
 return (await db.query(`SELECT code,label,kind,unit,options,required,tu_source,sort,active FROM app.card_fields ${all?'':'WHERE active'} ORDER BY sort,label`)).rows;
}
export async function cardValues(db:DB,actId:string){
 return (await db.query("SELECT v.field_code,v.value,v.origin,v.updated_at,app.act_user_label(v.act_id,v.updated_by)->>'name' AS updated_by_name FROM app.card_values v WHERE v.act_id=$1",[actId])).rows;
}

/** Приводит значение к виду поля; ошибка — понятным текстом с названием поля. */
export function normalizeCardValue(field:Row,raw:string){
 const value=raw.trim();
 if(field.kind==='number'){
  const n=value.replace(/\s/g,'').replace(',','.');
  if(!/^\d{1,9}(\.\d{1,6})?$/.test(n))throw new HttpError(422,'CARD_VALUE_INVALID',`«${field.label}»: укажите число, например 15 или 8,5.`);
  return n.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'');
 }
 if(field.kind==='date'){
  const d=new Date(value+'T00:00:00Z');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||Number.isNaN(d.valueOf())||d.toISOString().slice(0,10)!==value)throw new HttpError(422,'CARD_VALUE_INVALID',`«${field.label}»: укажите дату.`);
  return value;
 }
 if(field.kind==='select'){
  if(!(field.options as string[]).includes(value))throw new HttpError(422,'CARD_VALUE_INVALID',`«${field.label}»: выберите значение из списка.`);
  return value;
 }
 if(value.length>2000)throw new HttpError(422,'CARD_VALUE_INVALID',`«${field.label}»: не более 2000 символов.`);
 return value;
}

const saveSchema=z.object({values:z.array(z.object({code:z.string().max(41),value:z.string().max(2000).nullable(),origin:z.enum(['TU','MANUAL']).default('MANUAL')}).strict()).min(1).max(100),expectedRevision:z.number().int().nonnegative().optional()}).strict();

/** Сохраняет значения карточки (пустое значение удаляет). Только инженер РИРУ своего РЭС и только в подготовке. */
export async function saveCard(db:DB,actId:string,input:unknown){
 const b=saveSchema.parse(input);
 const act=await lockAct(db,actId);if(b.expectedRevision!==undefined)revision(act,b.expectedRevision);
 await role(db,'RIRU_ENGINEER',act.res_id);
 if(!PREPARING.includes(act.state))throw new HttpError(409,'INVALID_STATE','Карточку можно менять только до отправки или на доработке.');
 const fields=new Map((await cardFields(db,true)).map(f=>[f.code,f]));
 const changes:Row[]=[];
 for(const item of b.values){
  const field=fields.get(item.code);if(!field||!field.active)throw new HttpError(422,'CARD_FIELD_UNKNOWN',`Поле ${item.code} не найдено.`);
  if(item.value===null||!item.value.trim()){await db.query('DELETE FROM app.card_values WHERE act_id=$1 AND field_code=$2',[actId,item.code]);changes.push({code:item.code,value:null});continue;}
  const value=normalizeCardValue(field,item.value);
  await db.query(`INSERT INTO app.card_values(act_id,field_code,value,origin,updated_by) VALUES($1,$2,$3,$4,app.uid())
   ON CONFLICT(act_id,field_code) DO UPDATE SET value=excluded.value,origin=excluded.origin,updated_by=excluded.updated_by,updated_at=now()`,[actId,item.code,value,item.origin]);
  changes.push({code:item.code,value,origin:item.origin});
 }
 await audit(db,actId,'CARD_UPDATED',{changes});
 return cardValues(db,actId);
}

/** Заполняет поля с источником в ТУ из текущей редакции ТУ документа. Ручные значения инженера не перезаписываются. */
export async function cardFromTu(db:DB,storage:string,actId:string){
 const act=await lockAct(db,actId);await role(db,'RIRU_ENGINEER',act.res_id);
 if(!PREPARING.includes(act.state))throw new HttpError(409,'INVALID_STATE','Карточку можно менять только до отправки или на доработке.');
 if(!act.technical_conditions_id)throw new HttpError(409,'TU_REQUIRED','Сначала загрузите ТУ.');
 const tu=requireValue((await db.query("SELECT t.file_id FROM app.technical_conditions t JOIN app.files f ON f.id=t.file_id WHERE t.id=$1 AND f.scan_status='READY'",[act.technical_conditions_id])).rows[0]);
 const model=await documentModel(await readFile(resolve(storage,tu.file_id)));
 const facts=tuCardFacts(model.blocks.filter(b=>isBody(b.part)));
 const current=new Map((await cardValues(db,actId)).map(v=>[v.field_code,v]));
 const fields=(await cardFields(db)).filter(f=>f.tu_source);
 const values=fields.filter(f=>facts[f.tu_source as keyof typeof facts].value&&current.get(f.code)?.origin!=='MANUAL')
  .map(f=>({code:f.code,value:facts[f.tu_source as keyof typeof facts].value,origin:'TU' as const}));
 const saved=values.length?await saveCard(db,actId,{values}):await cardValues(db,actId);
 return {values:saved,facts};
}

/** Обязательные поля для отправки; при проверке ТУ (рабочие документы) — блокирует отправку. */
/** Названия обязательных полей карточки без значения (пусто, если карточка для документа не обязательна). */
export async function missingCardFields(db:DB,act:Row):Promise<string[]>{
 if(!act.tu_check_required)return [];
 return (await db.query('SELECT f.label FROM app.card_fields f WHERE f.active AND f.required AND NOT EXISTS(SELECT 1 FROM app.card_values v WHERE v.act_id=$1 AND v.field_code=f.code) ORDER BY f.sort',[act.id])).rows.map(r=>r.label);
}
export async function requireCompleteCard(db:DB,act:Row){
 const missing=await missingCardFields(db,act);
 if(missing.length)throw new HttpError(409,'CARD_INCOMPLETE',`Заполните карточку документа: ${missing.join(', ')}.`);
}
export const cardSnapshotSql="(SELECT coalesce(jsonb_object_agg(v.field_code,jsonb_build_object('label',f.label,'value',v.value,'unit',f.unit,'origin',v.origin)),'{}'::jsonb) FROM app.card_values v JOIN app.card_fields f ON f.code=v.field_code WHERE v.act_id=$1)";

const fieldSchema=z.object({label:z.string().trim().min(1).max(200),kind:z.enum(['text','number','date','select']),unit:z.string().trim().max(20).nullable().default(null),
 options:z.array(z.string().trim().min(1).max(100)).max(50).default([]),required:z.boolean().default(false),sort:z.number().int().min(0).max(10000).default(100)}).strict();
const translit:Record<string,string>={а:'a',б:'b',в:'v',г:'g',д:'d',е:'e',ё:'e',ж:'zh',з:'z',и:'i',й:'i',к:'k',л:'l',м:'m',н:'n',о:'o',п:'p',р:'r',с:'s',т:'t',у:'u',ф:'f',х:'h',ц:'c',ч:'ch',ш:'sh',щ:'sch',ы:'y',э:'e',ю:'yu',я:'ya'};
const codeFor=(label:string)=>('f_'+label.toLowerCase().split('').map(c=>translit[c]??c).join('').replace(/[^a-z0-9]+/g,'_').replace(/^_|_$/g,'')).slice(0,40).replace(/_$/,'')||'f_field';

export async function createCardField(db:DB,input:unknown){
 const b=fieldSchema.parse(input);
 if(b.kind==='select'&&!b.options.length)throw new HttpError(422,'CARD_OPTIONS_REQUIRED','Для списка укажите варианты значений.');
 let code=codeFor(b.label);for(let i=2;(await db.query('SELECT 1 FROM app.card_fields WHERE code=$1',[code])).rowCount;i++)code=`${codeFor(b.label).slice(0,36)}_${i}`;
 const row=(await db.query('INSERT INTO app.card_fields(code,label,kind,unit,options,required,sort) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *',[code,b.label,b.kind,b.unit||null,JSON.stringify(b.kind==='select'?b.options:[]),b.required,b.sort])).rows[0];
 await db.query("INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'CARD_FIELD_CREATED',$1)",[JSON.stringify({code,label:b.label})]);
 return row;
}
export async function updateCardField(db:DB,code:string,input:unknown){
 const b=fieldSchema.partial().extend({active:z.boolean().optional()}).strict().parse(input);
 const field=requireValue((await db.query('SELECT * FROM app.card_fields WHERE code=$1 FOR UPDATE',[code])).rows[0]);
 // Тип поля и источник в ТУ не меняются: иначе сохранённые значения станут несовместимыми.
 if(b.kind&&b.kind!==field.kind)throw new HttpError(409,'CARD_KIND_FIXED','Тип поля менять нельзя — создайте новое поле.');
 const options=b.options??field.options;
 if(field.kind==='select'&&!options.length)throw new HttpError(422,'CARD_OPTIONS_REQUIRED','Для списка укажите варианты значений.');
 const row=(await db.query('UPDATE app.card_fields SET label=$2,unit=$3,options=$4,required=$5,sort=$6,active=$7 WHERE code=$1 RETURNING *',
  [code,b.label??field.label,b.unit===undefined?field.unit:(b.unit||null),JSON.stringify(field.kind==='select'?options:[]),b.required??field.required,b.sort??field.sort,b.active??field.active])).rows[0];
 await db.query("INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'CARD_FIELD_UPDATED',$1)",[JSON.stringify({code,changes:b})]);
 return row;
}
