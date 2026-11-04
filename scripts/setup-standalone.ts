import pg from 'pg';
import { z } from 'zod';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { migrate } from './migrate.js';
import { hashPassword } from '../apps/api/src/passwords.js';

export async function bootstrapLocalAdmin(url:string,password?:string,login='admin',name='Администратор') {
  const db=new pg.Client({connectionString:url});await db.connect();
  try{
    await db.query('BEGIN');await db.query('SELECT pg_advisory_xact_lock(817625)');
    // Repeated container starts must never reset an existing password.
    if((await db.query('SELECT 1 FROM app.local_credentials LIMIT 1')).rowCount){await db.query('COMMIT');return false;}
    const valid=z.object({password:z.string().min(12).max(128),login:z.string().regex(/^[a-z0-9][a-z0-9._-]{2,63}$/),name:z.string().trim().min(1).max(200)}).parse({password,login,name});
    const user=(await db.query("INSERT INTO app.users(issuer,subject,name) VALUES('urn:tp-approval:local',$1,$2) RETURNING id",[randomUUID(),valid.name])).rows[0].id;
    await db.query("INSERT INTO app.roles(user_id,role) VALUES($1,'TECH_ADMIN')",[user]);
    await db.query('INSERT INTO app.local_credentials(user_id,login,password_hash) VALUES($1,$2,$3)',[user,valid.login,await hashPassword(valid.password)]);
    await db.query("INSERT INTO app.audit_events(actor_id,action) VALUES($1,'LOCAL_ADMIN_BOOTSTRAPPED')",[user]);
    await db.query('COMMIT');return true;
  }catch(error){await db.query('ROLLBACK');throw error;}finally{await db.end();}
}

export async function setupStandalone(env:NodeJS.ProcessEnv) {
  if(env.AUTH_MODE!=='local')throw new Error('Первичная настройка разрешена только при AUTH_MODE=local');
  if(!env.DATABASE_URL||!env.MIGRATION_DATABASE_URL)throw new Error('Нужны DATABASE_URL и MIGRATION_DATABASE_URL');
  const runtime=new URL(env.DATABASE_URL),owner=new URL(env.MIGRATION_DATABASE_URL);
  if(!['postgres:','postgresql:'].includes(runtime.protocol)||!['postgres:','postgresql:'].includes(owner.protocol))throw new Error('Ожидаются адреса PostgreSQL');
  if(runtime.hostname!==owner.hostname||(runtime.port||'5432')!==(owner.port||'5432')||runtime.pathname!==owner.pathname)throw new Error('Адреса должны указывать на одну отдельную базу TP_Approval');
  const runtimePassword=decodeURIComponent(runtime.password);
  if(decodeURIComponent(runtime.username)!=='tp_runtime'||runtimePassword.length<16)throw new Error('В DATABASE_URL укажите tp_runtime и отдельный пароль от 16 символов');
  if(decodeURIComponent(owner.username)==='tp_runtime')throw new Error('Для миграций нужна отдельная роль владельца БД');
  await migrate(env.MIGRATION_DATABASE_URL,runtimePassword);
  const created=await bootstrapLocalAdmin(env.MIGRATION_DATABASE_URL,env.INITIAL_ADMIN_PASSWORD,env.INITIAL_ADMIN_LOGIN??'admin',env.INITIAL_ADMIN_NAME??'Администратор');
  console.log(created?'Миграции применены, создан первый администратор.':'Миграции применены, существующие учётные записи сохранены.');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await setupStandalone(process.env);
