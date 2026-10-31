import pg from 'pg';
import { z } from 'zod';
import { createApp } from './app.js';

const env=z.object({
  DATABASE_URL:z.string().min(1),KEYCLOAK_ISSUER:z.url(),KEYCLOAK_JWKS_URL:z.url(),KEYCLOAK_AUDIENCE:z.string().min(1),PLATFORM_ORIGIN:z.url(),
  STORAGE_PATH:z.string().default('./storage'),MAX_FILE_BYTES:z.coerce.number().int().positive().max(50*1024*1024).default(20*1024*1024),
  PORT:z.coerce.number().int().min(1).max(65535).default(3000),NODE_ENV:z.enum(['development','test','production']).default('development'),
  CLAMAV_HOST:z.string().optional(),CLAMAV_PORT:z.coerce.number().int().default(3310),HOST:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),WEB_PATH:z.string().optional()
}).parse(process.env);
if(env.NODE_ENV==='production'&&[env.KEYCLOAK_ISSUER,env.KEYCLOAK_JWKS_URL,env.PLATFORM_ORIGIN].some(url=>!url.startsWith('https://'))) throw new Error('Production requires HTTPS origins');
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:12});
const check=await pool.query("SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user");
if(check.rows[0].rolsuper||check.rows[0].rolbypassrls||check.rows[0].rolcreaterole||check.rows[0].rolcreatedb)throw new Error('Unsafe runtime database role');
const owned=await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='app' AND tableowner=current_user LIMIT 1");if(owned.rowCount)throw new Error('Runtime must not own tables');
const app=createApp(pool,{issuer:env.KEYCLOAK_ISSUER,jwksUrl:env.KEYCLOAK_JWKS_URL,audience:env.KEYCLOAK_AUDIENCE,platformOrigin:env.PLATFORM_ORIGIN,storagePath:env.STORAGE_PATH,maxFileBytes:env.MAX_FILE_BYTES,production:env.NODE_ENV==='production',clamavHost:env.CLAMAV_HOST,clamavPort:env.CLAMAV_PORT,webPath:env.WEB_PATH});
const server=app.listen(env.PORT,env.HOST,()=>console.log(`TP_Approval API: порт ${env.PORT}`));
for(const signal of ['SIGTERM','SIGINT'] as const)process.on(signal,()=>server.close(()=>{void pool.end();}));
