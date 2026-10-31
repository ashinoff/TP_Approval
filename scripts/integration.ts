import { mkdtemp, cp,writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { execFile,spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { migrate } from './migrate.js';
import { runIntegration } from '../tests/core.integration.js';
import pg from 'pg';
import {runMatrixIntegration} from '../tests/matrix.integration.js';

// Real native PostgreSQL, isolated cluster; no production connection is accepted here.
const root=await mkdtemp(resolve(tmpdir(),'tp-approval-test-'));
const packageName=`@embedded-postgres/${process.platform==='win32'?'windows':process.platform}-${process.arch}`;
const binaries=await import(packageName);
let bin=dirname(binaries.postgres);
if(process.platform==='win32') {await cp(resolve(bin,'..'),resolve(root,'native'),{recursive:true});bin=resolve(root,'native','bin');}
const exe=(name:string)=>resolve(bin,`${name}${process.platform==='win32'?'.exe':''}`);
const run=promisify(execFile);
const control=(args:string[])=>new Promise<void>((ok,fail)=>{
  const child=spawn(exe('pg_ctl'),args,{windowsHide:true,stdio:'ignore'});
  child.on('error',fail);child.on('exit',code=>code===0?ok():fail(new Error(`pg_ctl exit ${code}`)));
});
const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));
const port=(probe.address() as {port:number}).port;await new Promise<void>(r=>probe.close(()=>r()));
const password=randomBytes(24).toString('hex');const runtimePassword=randomBytes(24).toString('hex');
const data=resolve(root,'pg');const pw=resolve(root,'password');await writeFile(pw,password,{mode:0o600});
let started=false;
try {
  await run(exe('initdb'),['-D',data,'-U','postgres',`--pwfile=${pw}`,'--auth=scram-sha-256','--encoding=UTF8','--locale=C'],{windowsHide:true,timeout:60000});
  await control(['-D',data,'-l',resolve(root,'postgres.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);started=true;
  const url=`postgres://postgres:${password}@127.0.0.1:${port}/postgres`;
  await migrate(url,runtimePassword);await migrate(url,runtimePassword);
  await runIntegration(url,`postgres://tp_runtime:${runtimePassword}@127.0.0.1:${port}/postgres`,root);
  const admin=new pg.Client({connectionString:url});await admin.connect();try{await admin.query('CREATE DATABASE matrix_tests');}finally{await admin.end();}
  const matrixUrl=`postgres://postgres:${password}@127.0.0.1:${port}/matrix_tests`;
  await migrate(matrixUrl,runtimePassword);
  await runMatrixIntegration(matrixUrl,`postgres://tp_runtime:${runtimePassword}@127.0.0.1:${port}/matrix_tests`,root);
}finally{if(started)await control(['-D',data,'-m','fast','-w','stop']);}
