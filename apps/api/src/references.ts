import {z} from 'zod';
import {HttpError,type DB} from './db.js';
import {RULES_VERSION} from './tu-rules.js';

export type BreakerRow={phases:'1ф'|'3ф';from:number;to:number;breaker:number;ct:string|null};
export type CableRow={voltage:'0.23'|'0.38';from:number;to:number;cores:number;section:number};
export type References={breakers:{rows:BreakerRow[];revision:number};cables:{rows:CableRow[];revision:number;brands:string[]}};

const kw=z.number().min(0).max(100000);
const breakerRow=z.object({phases:z.enum(['1ф','3ф']),from:kw,to:kw,breaker:z.number().int().min(1).max(10000),ct:z.string().trim().regex(/^\d{1,5}\/[15]$/,'Трансформатор тока записывается как 100/5').nullable()}).strict();
const cableRow=z.object({voltage:z.enum(['0.23','0.38']),from:kw,to:kw,cores:z.number().int().min(1).max(5),section:z.number().min(0.5).max(1000)}).strict();
const schemas={
 breakers:z.object({rows:z.array(breakerRow).min(1).max(200)}).strict(),
 cables:z.object({rows:z.array(cableRow).min(1).max(200),brands:z.array(z.string().trim().min(1).max(30)).min(1).max(30)}).strict(),
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
 const b=book('breakers'),c=book('cables');
 return {breakers:{rows:b?.rows??[],revision:b?.revision??0},cables:{rows:c?.rows??[],revision:c?.revision??0,brands:c?.settings?.brands??[]}};
}

/** Rules version of a TU check: changing a reference book makes earlier reports stale. */
export const rulesVersion=(refs:References)=>`${RULES_VERSION}+REF${refs.breakers.revision}.${refs.cables.revision}`;
export const currentRulesVersion=async(db:DB)=>rulesVersion(await loadReferences(db));

export async function saveReferenceBook(db:DB,code:string,input:unknown){
 if(code!=='breakers'&&code!=='cables')throw new HttpError(404,'NOT_FOUND');
 let rows:unknown[],settings:Record<string,unknown>={};
 if(code==='breakers'){const b=schemas.breakers.parse(input);rows=checkRanges(b.rows,r=>r.phases);}
 else{const b=schemas.cables.parse(input);rows=checkRanges(b.rows,r=>r.voltage);settings={brands:[...new Set(b.brands)]};}
 const saved=(await db.query('UPDATE app.reference_books SET rows=$2,settings=$3,revision=revision+1,updated_by=app.uid(),updated_at=now() WHERE code=$1 RETURNING code,revision',[code,JSON.stringify(rows),JSON.stringify(settings)])).rows[0];
 if(!saved)throw new HttpError(403,'ROLE_REQUIRED');
 await db.query("INSERT INTO app.audit_events(actor_id,action,details) VALUES(app.uid(),'REFERENCE_UPDATED',$1)",[JSON.stringify({code,revision:saved.revision,rows:rows.length})]);
 return saved;
}
