import {mkdir,readFile,writeFile,mkdtemp,cp,access} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer as netServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import express from 'express';
import cors from 'cors';
import pg from 'pg';
import {generateKeyPair,exportPKCS8,exportSPKI,importPKCS8,importSPKI,exportJWK,SignJWT} from 'jose';
import {createServer as viteServer} from 'vite';
import {migrate} from './migrate.js';
import {demoUsers} from './demo-users.js';
import {createApp} from '../apps/api/src/app.js';

// Standalone synthetic test harness. Never reads .env or DATABASE_URL.
if(process.env.NODE_ENV==='production')throw new Error('Demo is forbidden in production');
const local=resolve('.local');await mkdir(local,{recursive:true});
const issuer='http://127.0.0.1:4100';const frontend='http://127.0.0.1:5173';
const run=promisify(execFile);
const stopOnly=process.argv.includes('--stop');
if(stopOnly){
  const state=JSON.parse(await readFile(resolve(local,'demo.json'),'utf8'));
  const response=await fetch(`${issuer}/shutdown`,{method:'POST',headers:{'X-Demo-Control':state.control}});
  if(!response.ok)throw new Error('Demo shutdown failed');console.log('Локальный стенд останавливается');
}else{
  // Refuse to attach to any pre-existing service, including an existing database.
  for(const port of [3000,4100,5173,55432])await new Promise<void>((ok,fail)=>{const s=netServer();s.once('error',()=>fail(new Error(`Порт ${port} занят. Стенд не подключается к чужим сервисам.`)));s.listen(port,'127.0.0.1',()=>s.close(()=>ok()));});
  let state:{root:string;ownerPassword:string;runtimePassword:string;control:string;privateKey:string;publicKey:string};
  try{state=JSON.parse(await readFile(resolve(local,'demo.json'),'utf8'));}
  catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;
    const key=await generateKeyPair('RS256',{extractable:true});
    state={root:await mkdtemp(resolve(tmpdir(),'tp-approval-demo-')),ownerPassword:randomBytes(24).toString('hex'),runtimePassword:randomBytes(24).toString('hex'),control:randomBytes(32).toString('hex'),privateKey:await exportPKCS8(key.privateKey),publicKey:await exportSPKI(key.publicKey)};
    await writeFile(resolve(local,'demo.json'),JSON.stringify(state),{mode:0o600,flag:'wx'});
  }
  const root=resolve(state.root);
  if(dirname(root)!==resolve(tmpdir())||!root.split(sep).at(-1)!.startsWith('tp-approval-demo-'))throw new Error('Unexpected demo data path');
  const packageName=`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`;
  const binaries=await import(packageName);let bin=dirname(binaries.postgres);
  if(process.platform==='win32') {try{await access(resolve(root,'native','bin','postgres.exe'));}catch{await cp(resolve(bin,'..'),resolve(root,'native'),{recursive:true});}bin=resolve(root,'native','bin');}
  const exe=(name:string)=>resolve(bin,`${name}${process.platform==='win32'?'.exe':''}`);
  const data=resolve(root,'pg');
  const control=(args:string[])=>new Promise<void>((ok,fail)=>{const child=spawn(exe('pg_ctl'),args,{windowsHide:true,stdio:'ignore'});child.once('error',fail);child.once('exit',code=>code===0?ok():fail(new Error(`pg_ctl exit ${code}`)));});
  try{await access(resolve(data,'PG_VERSION'));}catch{
    const pw=resolve(root,'password');await writeFile(pw,state.ownerPassword,{mode:0o600});
    await run(exe('initdb'),['-D',data,'-U','postgres',`--pwfile=${pw}`,'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  }
  await control(['-D',data,'-l',resolve(root,'postgres.log'),'-o','-h 127.0.0.1 -p 55432','-w','start']);
  let pool:pg.Pool|undefined;let api:ReturnType<ReturnType<typeof createApp>['listen']>|undefined;
  let auth:ReturnType<ReturnType<typeof express>['listen']>|undefined;let web:Awaited<ReturnType<typeof viteServer>>|undefined;let closing=false;
  const shutdown=async()=>{if(closing)return;closing=true;await web?.close();for(const s of [api,auth])if(s)await new Promise<void>(r=>s.close(()=>r()));await pool?.end();await control(['-D',data,'-m','fast','-w','stop']);console.log('Стенд остановлен. Синтетическая БД сохранена.');};
  try{
    const base=`postgres://postgres:${state.ownerPassword}@127.0.0.1:55432`;
    const bootstrap=new pg.Client({connectionString:`${base}/postgres`});await bootstrap.connect();
    try{if(!(await bootstrap.query("SELECT 1 FROM pg_database WHERE datname='tp_approval_demo'")).rowCount)await bootstrap.query('CREATE DATABASE tp_approval_demo');}finally{await bootstrap.end();}
    await migrate(`${base}/tp_approval_demo`,state.runtimePassword);
    const owner=new pg.Client({connectionString:`${base}/tp_approval_demo`});await owner.connect();
    try{
      await owner.query('BEGIN');
      await owner.query("CREATE TABLE IF NOT EXISTS public.demo_marker(kind text PRIMARY KEY CHECK(kind='TP_APPROVAL_SYNTHETIC_ONLY'))");
      await owner.query("INSERT INTO public.demo_marker VALUES('TP_APPROVAL_SYNTHETIC_ONLY') ON CONFLICT DO NOTHING");
      for(const user of demoUsers){const u=(await owner.query('INSERT INTO app.users(issuer,subject,name) VALUES($1,$2,$3) ON CONFLICT(issuer,subject) DO UPDATE SET name=excluded.name RETURNING id',[issuer,user.subject,user.name])).rows[0];
        await owner.query('INSERT INTO app.roles(user_id,role,res_id) VALUES($1,$2,(SELECT id FROM app.res_units WHERE code=$3)) ON CONFLICT DO NOTHING',[u.id,user.role,user.res]);}
      await owner.query("INSERT INTO app.calendar_days SELECT d::date,extract(isodow FROM d)<6,'ДЕМО: только будни, не производственный календарь',1 FROM generate_series(current_date-7,current_date+730,'1 day') d ON CONFLICT DO NOTHING");
      await owner.query('COMMIT');
    }catch(e){await owner.query('ROLLBACK');throw e;}finally{await owner.end();}
    const signingKey=await importPKCS8(state.privateKey,'RS256');const jwk=await exportJWK(await importSPKI(state.publicKey,'RS256'));jwk.kid='local-demo-only';
    const authApp=express();authApp.use(express.json({limit:'4kb'}));authApp.use(cors({origin:frontend}));authApp.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store');next();});
    authApp.get('/jwks',(_req,res)=>res.json({keys:[jwk]}));
    authApp.get('/users',(_req,res)=>res.json(demoUsers));
    authApp.post('/token',async(req,res)=>{
      if(req.get('Origin')!==frontend||req.get('Host')!=='127.0.0.1:4100'){res.sendStatus(403);return;}
      const user=demoUsers.find(u=>u.subject===req.body?.subject);if(!user){res.sendStatus(400);return;}
      const token=await new SignJWT({realm_access:{roles:['tp-approval-user']},demo:true}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer(issuer).setAudience('tp-approval-local-demo').setSubject(user.subject).setIssuedAt().setExpirationTime('1h').sign(signingKey);
      res.json({token});
    });
    authApp.post('/shutdown',(req,res)=>{if(req.get('X-Demo-Control')!==state.control){res.sendStatus(403);return;}res.json({stopping:true});setTimeout(()=>void shutdown(),100);});
    auth=authApp.listen(4100,'127.0.0.1');
    pool=new pg.Pool({connectionString:`postgres://tp_runtime:${state.runtimePassword}@127.0.0.1:55432/tp_approval_demo`,max:12});
    const app=createApp(pool,{issuer,audience:'tp-approval-local-demo',jwksUrl:`${issuer}/jwks`,platformOrigin:frontend,storagePath:resolve(local,'demo-storage'),maxFileBytes:20*1024*1024,production:false});
    api=app.listen(3000,'127.0.0.1');
    web=await viteServer({configFile:resolve('apps/web/vite.config.ts'),envFile:false,server:{host:'127.0.0.1',port:5173,strictPort:true},define:{'import.meta.env.VITE_DEMO_AUTH_ORIGIN':JSON.stringify(issuer)}});await web.listen();
    console.log(`ДЕМО: ${frontend} | API http://127.0.0.1:3000 | JWT ${issuer} | PostgreSQL 127.0.0.1:55432/tp_approval_demo`);
    await writeFile(resolve(local,'demo-running.json'),JSON.stringify({pid:process.pid,frontend,api:'http://127.0.0.1:3000',issuer,startedAt:new Date().toISOString()}));
    for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,()=>void shutdown());
  }catch(e){await shutdown();throw e;}
}
