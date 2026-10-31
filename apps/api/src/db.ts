import pg from 'pg';
export type DB = pg.PoolClient;
export async function transaction<T>(pool: pg.Pool, userId: string, fn: (db: DB)=>Promise<T>,readSnapshot=false): Promise<T> {
  const db=await pool.connect();
  try { await db.query(readSnapshot?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN'); await db.query("SELECT set_config('app.user_id',$1,true)",[userId]);
    const result=await fn(db); await db.query('COMMIT'); return result;
  } catch(e) { await db.query('ROLLBACK'); throw e; } finally { db.release(); }
}
export class HttpError extends Error { constructor(public status:number, public code:string, message=code) { super(message); } }
export function requireValue<T>(value:T|null|undefined, status=404, code='NOT_FOUND'):T { if(value==null) throw new HttpError(status,code); return value; }
