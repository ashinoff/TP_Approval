import pg from 'pg';
import { z } from 'zod';
import { mkdir,access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createApp, type AppConfig } from './app.js';

const env=z.object({
  AUTH_MODE:z.enum(['local','keycloak']).default('keycloak'),DATABASE_URL:z.string().min(1),
  STORAGE_PATH:z.string().default('./storage'),MAX_FILE_BYTES:z.coerce.number().int().positive().max(50*1024*1024).default(20*1024*1024),
  PORT:z.coerce.number().int().min(1).max(65535).default(3000),NODE_ENV:z.enum(['development','test','production']).default('development'),
  CLAMAV_HOST:z.string().trim().min(1).optional(),CLAMAV_PORT:z.coerce.number().int().min(1).max(65535).default(3310),
  HOST:z.enum(['127.0.0.1','0.0.0.0']).default('127.0.0.1'),WEB_PATH:z.string().optional(),
  TRUST_PROXY_HOPS:z.coerce.number().int().min(0).max(3).default(0),SYNC_API_KEY:z.string().trim().min(32).optional(),APP_ORIGIN:z.url().optional()
}).parse(process.env);
const production=env.NODE_ENV==='production';
const base={storagePath:env.STORAGE_PATH,maxFileBytes:env.MAX_FILE_BYTES,production,clamavHost:env.CLAMAV_HOST,clamavPort:env.CLAMAV_PORT,webPath:env.WEB_PATH,trustProxyHops:env.TRUST_PROXY_HOPS,syncApiKey:env.SYNC_API_KEY};
let config:AppConfig;
if(env.AUTH_MODE==='local'){
  if(production&&env.APP_ORIGIN&&!env.APP_ORIGIN.startsWith('https://'))throw new Error('APP_ORIGIN must use HTTPS');
  config={...base,authMode:'local',appOrigin:env.APP_ORIGIN?new URL(env.APP_ORIGIN).origin:undefined};
}else{
  const auth=z.object({KEYCLOAK_ISSUER:z.url(),KEYCLOAK_JWKS_URL:z.url(),KEYCLOAK_AUDIENCE:z.string().min(1),PLATFORM_ORIGIN:z.url()}).parse(process.env);
  if(production&&[auth.KEYCLOAK_ISSUER,auth.KEYCLOAK_JWKS_URL,auth.PLATFORM_ORIGIN].some(url=>!url.startsWith('https://')))throw new Error('Production requires HTTPS origins');
  config={...base,authMode:'keycloak',issuer:auth.KEYCLOAK_ISSUER,jwksUrl:auth.KEYCLOAK_JWKS_URL,audience:auth.KEYCLOAK_AUDIENCE,platformOrigin:auth.PLATFORM_ORIGIN};
}
const pool=new pg.Pool({connectionString:env.DATABASE_URL,max:12});
try{
  const check=await pool.query('SELECT rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=current_user');
  if(check.rows[0].rolsuper||check.rows[0].rolbypassrls||check.rows[0].rolcreaterole||check.rows[0].rolcreatedb)throw new Error('Unsafe runtime database role');
  const owned=await pool.query("SELECT 1 FROM pg_tables WHERE schemaname='app' AND tableowner=current_user LIMIT 1");
  if(owned.rowCount)throw new Error('Runtime must not own tables');
  await pool.query('SELECT id FROM app.res_units LIMIT 1');
  if(env.AUTH_MODE==='local')await pool.query("SELECT app.local_session('')");
  await mkdir(env.STORAGE_PATH,{recursive:true});await access(env.STORAGE_PATH,constants.W_OK);
  if(env.WEB_PATH)await access(env.WEB_PATH+'/index.html',constants.R_OK);
  const app=createApp(pool,config);
  const server=app.listen(env.PORT,env.HOST,()=>console.log(`TP_Approval: порт ${env.PORT}, вход ${env.AUTH_MODE}`));
  for(const signal of ['SIGTERM','SIGINT'] as const)process.once(signal,()=>server.close(()=>{void pool.end();}));
}catch(error){await pool.end();throw error;}
