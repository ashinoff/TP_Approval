import {z} from 'zod';
import {HttpError,type DB} from './db.js';
import {RULES_VERSION} from './tu-rules.js';

export type BreakerRow={phases:'1ф'|'3ф';from:number;to:number;breaker:number;ct:string|null};
export type CableRow={voltage:'0.23'|'0.38';from:number;to:number;cores:number;section:number};
export type TgRow={voltage:string;tg:number};
export type AttorneyRow={number:string;date:string;person:string;position:string;validUntil:string|null};
export type References={breakers:{rows:BreakerRow[];revision:number};cables:{rows:CableRow[];revision:number;brands:string[]};tg:{rows:TgRow[];revision:number};attorneys:{rows:AttorneyRow[];revision:number}};

const kw=z.number().min(0).max(100000);
const breakerRow=z.object({phases:z.enum(['1ф','3ф']),from:kw,to:kw,breaker:z.number().int().min(1).max(10000),ct:z.string().trim().regex(/^\d{1,5}\/[15]$/,'Трансформатор тока записывается как 100/5').nullable()}).strict();
const cableRow=z.object({voltage:z.enum(['0.23','0.38']),from:kw,to:kw,cores:z.number().int().min(1).max(5),section:z.number().min(0.5).max(1000)}).strict();
const day=z.iso.date();
const tgRow=z.object({voltage:z.string().trim().regex(/^\d{1,3}(?:\.\d{1,2})?$/,'Напряжение записывается числом, например 0.4'),tg:z.number().min(0).max(5)}).strict();
const attorneyRow=z.object({number:z.string().trim().min(1).max(60),date:day,person:z.string().trim().min(3).max(120),position:z.string().trim().max(400).default(''),validUntil:day.nullable().default(null)}).strict();
const schemas={
 breakers:z.object({rows:z.array(breakerRow).min(1).max(200)}).strict(),
 cables:z.object({rows:z.array(cableRow).min(1).max(200),brands:z.array(z.string().trim().min(1).max(30)).min(1).max(30)}).strict(),
 tg:z.object({rows:z.array(tgRow).min(1).max(50)}).strict(),
 attorneys:z.object({rows:z.array(attorneyRow).max(500)}).strict(),
};

/** Ranges of one group (фазность или напряжение) must go up without overlaps: each row starts after the previous ends. */
function checkRanges<T extends {from:number;to:number}>(rows:T[],group:(r:T)=>string){
 const sorted=[...rows].sort((a,b)=>group(a).localeCompare(group(b))||a.from-b.from);
 sorted.forEach((r,i)=>{
  if(r.to<r.from)throw new HttpError(422,'REFERENCE_RANGE','Строка «'+group(r)+' '+r.from+'–'+r.to+'»: конец диапазона меньше начала.');
  const prev=sorted[i-1];
  if(prev&&group(prev)===group(r)&&r.from<=prev.to)throw new HttpError(422,'REFERENCE_RANGE','Диапазоны «'+group(r)+'» '+prev.from+'–'+prev.to+' и '+r.from+'–'+r.to+' пересекаются.');
 });
 return sorted;
}

export async function referenceBooks(db:DB){
 return (await db.query('SELECT code,title,rows,settings,revision,updated_at,updated_by_name FROM app.reference_books ORDER BY code')).rows;
}

export async function loadReferences(db:DB):Promise<References>{
 const rows=await referenceBooks(db);const book=(code:string)=>rows.find(r=>r.code===code);
 const b=book('breakers'),c=book('cables'),t=book('tg'),a=book('attorneys');
 return {breakers:{rows:b?.rows??[],revision:b?.revision??0},cables:{rows:c?.rows??[],revision:c?.revision??0,brands:c?.settings?.brands??[]},
  tg:{rows:t?.rows??[],revision:t?.revision??0},attorneys:{rows:a?.rows??[],revision:a?.revision??0}};
}

/** Rules version of a TU check: changing a reference book makes earlier reports stale. */
export const rulesVersion=(refs:References)=>`${RULES_VERSION}+REF${refs.breakers.revision}.${refs.cables.revision}.${refs.tg.revision}.${refs.attorneys.revision}`;
export const currentRulesVersion=async(db:DB)=>rulesVersion(await loadReferences(db));

export async function saveReferenceBook(db:DB,code:string,input:unknown){
 if(!['breakers','cables','tg','attorneys'].includes(code))throw new HttpError(404,'NOT_FOUND');
 let rows:unknown[],settings:Record<string,unknown>={};
 if(code==='breakers'){const b=schemas.breakers.parse(input);rows=checkRanges(b.rows,r=>r.phases);}
 else if(code==='cables'){const b=schemas.cables.parse(input);rows=checkRanges(b.rows,r=>r.voltage);settings={brands:[...new Set(b.brands)]};}
 else if(code==='tg'){const b=schemas.tg.parse(input);
  if(new Set(b.rows.map(r=>Number(r.voltage))).size!==b.rows.length)throw new HttpError(422,'REFERENCE_RANGE','Напряжение в справочнике tg повторяется.');
  rows=[...b.rows].sort((x,y)=>Number(x.voltage)-Number(y.voltage));}
 else{const b=schemas.attorneys.parse(input);
  const key=(n:string)=>n.toLowerCase().replace(/\s/g,'');
  if(new Set(b.rows.map(r=>key(r.number))).size!==b.rows.length)throw new HttpError(422,'REFERENCE_RANGE','Номер доверенности в справочнике повторяется.');
  rows=b.rows;}
 const saved=(await db.query('UPDATE app.reference_books SET rows=$2,settings=$3,revision=revision+1,updated_by=app.uid(),updated_at=now() WHERE code=$1 RETURNING code,revision',[code,JSON.stringify(rows),JSON.stringify(settings)])).rows[0];
 if(!saved)throw new HttpError(403,'ROLE_REQUIRED');
 await db.query("INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'REFERENCE_UPDATED',$1)",[JSON.stringify({code,revision:saved.revision,rows:rows.length})]);
 return saved;
}
