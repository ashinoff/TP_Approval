import express from 'express';
import type pg from 'pg';
import {z} from 'zod';
import {createHash,timingSafeEqual} from 'node:crypto';
import {type DB,HttpError,transaction} from './db.js';
import {requireContractNumber} from './contract-number.js';

/**
 * Синхронизация с «Учёт ПУ» (решение владельца 09.11.2026). «Учёт ПУ» по номеру договора ТП забирает РЭС, реквизиты
 * и технические характеристики (поля карточки из ТУ) и ставит отметку «синхронизирован»; здесь хранится только отметка
 * и хеш переданных данных. Статус: NOT_SYNCED — ещё не забирали, SYNCED — забрали актуальные данные,
 * CHANGED — данные изменились после синхронизации (нужно забрать повторно).
 */
export type SyncStatus='NOT_SYNCED'|'SYNCED'|'CHANGED';
const rowsSql=`SELECT r.*,to_char(r.contract_date,'YYYY-MM-DD') AS contract_day,s.synced_at,s.first_synced_at,s.synced_count,s.external_id,s.payload_hash AS synced_hash,
 CASE WHEN s.number_key IS NULL THEN 'NOT_SYNCED' WHEN s.payload_hash=r.payload_hash THEN 'SYNCED' ELSE 'CHANGED' END AS sync_status
 FROM app.pu_sync_rows(app.contract_key($1)) r LEFT JOIN app.pu_sync s ON s.number_key=r.number_key`;

const listQuery=z.object({q:z.string().trim().max(200).default(''),res:z.string().trim().max(64).default(''),status:z.enum(['all','NOT_SYNCED','SYNCED','CHANGED']).default('all'),
 page:z.coerce.number().int().min(1).default(1),limit:z.coerce.number().int().min(1).max(200).default(50)});

/** Строки синхронизации с фильтрами; visible — условие области (рабочее место) или true (сервис «Учёт ПУ»). */
async function list(db:DB,raw:unknown,visible:string){
 const q=listQuery.parse(raw);const like='%'+q.q.replace(/[\\%_]/g,m=>'\\'+m)+'%';
 const where=`(${visible}) AND ($1='' OR r.contract_number ILIKE $1 OR coalesce(r.applicant,'') ILIKE $1 OR coalesce(r.address,'') ILIKE $1) AND ($2='' OR r.res_code=$2 OR r.res_id::text=$2)`;
 const base=`WITH x AS (${rowsSql.replace('$1','NULL')}) SELECT * FROM x r WHERE ${where}`;
 const params=[q.q?like:'',q.res];
 const counts=(await db.query(`SELECT count(*)::int AS all,count(*) FILTER(WHERE sync_status='NOT_SYNCED')::int AS "NOT_SYNCED",count(*) FILTER(WHERE sync_status='SYNCED')::int AS "SYNCED",count(*) FILTER(WHERE sync_status='CHANGED')::int AS "CHANGED" FROM (${base}) c`,params)).rows[0];
 const items=(await db.query(`${base} AND ($3='all' OR r.sync_status=$3) ORDER BY r.contract_date DESC NULLS LAST,r.contract_number LIMIT $4 OFFSET $5`,[...params,q.status,q.limit,(q.page-1)*q.limit])).rows;
 return {items,counts,total:q.status==='all'?counts.all:counts[q.status],page:q.page,limit:q.limit};
}
/** Рабочее место: только РЭС пользователя (инженер/руководители своего РЭС, службы и TECH_ADMIN — все). */
const workplaceScope="app.can_read(r.res_id) OR app.has_role('RIRU_ENGINEER',r.res_id)";
export const workplaceSync=(db:DB,query:unknown)=>list(db,query,workplaceScope);
/** Отметка синхронизации для карточки документа. */
export async function actSync(db:DB,contractNumber:string){
 const row=(await db.query(rowsSql,[contractNumber])).rows[0];
 return row?{status:row.sync_status as SyncStatus,syncedAt:row.synced_at,count:row.synced_count}:null;
}

/** Сервисный API для «Учёт ПУ»: заголовок X-Sync-Key = SYNC_API_KEY. Без ключа в окружении API выключен (503). */
export function syncService(pool:pg.Pool,apiKey?:string){
 const router=express.Router();
 const digest=(v:string)=>createHash('sha256').update(v).digest();
 router.use((req,_res,next)=>{
  if(!apiKey)return next(new HttpError(503,'SYNC_NOT_CONFIGURED','Синхронизация не настроена: задайте SYNC_API_KEY.'));
  const given=req.get('x-sync-key')??'';
  if(!given||!timingSafeEqual(digest(given),digest(apiKey)))return next(new HttpError(401,'SYNC_KEY_INVALID','Неверный ключ синхронизации.'));
  next();
 });
 const run=<T>(fn:(db:DB)=>Promise<T>)=>transaction(pool,'',fn);
 const view=(r:Record<string,any>)=>({contractNumber:r.contract_number,contractDate:r.contract_day,res:{code:r.res_code,name:r.res_name},
  applicant:r.applicant,address:r.address,documentType:r.act_type,documentState:r.state,approved:r.approved,tu:r.tu,technical:r.technical,
  hash:r.payload_hash,sync:{status:r.sync_status,syncedAt:r.synced_at,count:r.synced_count,externalId:r.external_id}});
 router.get('/res',async(_req,res,next)=>{try{res.json(await run(async db=>(await db.query('SELECT code,name FROM app.res_units ORDER BY name')).rows));}catch(e){next(e);}});
 router.get('/contracts',async(req,res,next)=>{try{const r=await run(db=>list(db,req.query,'true'));res.json({...r,items:r.items.map(view)});}catch(e){next(e);}});
 router.get('/contracts/:number',async(req,res,next)=>{try{
  const row=await run(async db=>(await db.query(rowsSql,[requireContractNumber(String(req.params.number))])).rows[0]);
  if(!row)throw new HttpError(404,'CONTRACT_NOT_FOUND','Договор с таким номером не найден.');res.json(view(row));
 }catch(e){next(e);}});
 router.post('/contracts/:number/synced',async(req,res,next)=>{try{
  const b=z.object({hash:z.string().regex(/^[0-9a-f]{32}$/),externalId:z.string().trim().min(1).max(200).optional()}).strict().parse(req.body);
  const row=await run(async db=>{
   try{await db.query('SELECT app.pu_sync_mark($1,$2,$3)',[requireContractNumber(String(req.params.number)),b.hash,b.externalId??null]);}
   catch(e){const m=(e as Error).message;
    if(m==='PU_SYNC_NOT_FOUND')throw new HttpError(404,'CONTRACT_NOT_FOUND','Договор с таким номером не найден.');
    if(m==='PU_SYNC_STALE')throw new HttpError(409,'SYNC_STALE','Данные договора изменились — перечитайте договор и синхронизируйте ещё раз.');throw e;}
   return (await db.query(rowsSql,[requireContractNumber(String(req.params.number))])).rows[0];
  });res.json(view(row));
 }catch(e){next(e);}});
 return router;
}
