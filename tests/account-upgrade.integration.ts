import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash,randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import pg from 'pg';
import request from 'supertest';
import {bootstrapLocalAdmin} from '../scripts/setup-standalone.js';
import {migrate} from '../scripts/migrate.js';
import {createApp} from '../apps/api/src/app.js';
import {hashPassword} from '../apps/api/src/passwords.js';
import {transaction} from '../apps/api/src/db.js';

export async function runAccountUpgradeIntegration(ownerUrl:string,runtimeUrl:string,root:string){
  if(!['127.0.0.1','localhost'].includes(new URL(ownerUrl).hostname))throw new Error('Upgrade acceptance requires an isolated loopback database');
  const owner=new pg.Pool({connectionString:ownerUrl}),runtime=new pg.Pool({connectionString:runtimeUrl});
  try{
    // Reconstruct the deployed v015 schema, including genuine migration checksums.
    await owner.query('CREATE TABLE public.schema_migrations(name text PRIMARY KEY,hash text NOT NULL,applied_at timestamptz DEFAULT now())');
    for(const name of (await readdir('db/migrations')).filter(n=>/^0(0[1-9]|1[0-5])_.*\.sql$/.test(n)).sort()){
      const sql=await readFile('db/migrations/'+name,'utf8');await owner.query(sql);
      await owner.query('INSERT INTO public.schema_migrations(name,hash) VALUES($1,$2)',[name,createHash('sha256').update(sql).digest('hex')]);
    }
    const initial='Synthetic-upgrade-initial-123',personal='Synthetic-upgrade-personal-456';
    await bootstrapLocalAdmin(ownerUrl,initial);
    const app=createApp(runtime,{authMode:'local',production:true,appOrigin:'https://upgrade.test',storagePath:resolve(root,'upgrade-files'),maxFileBytes:1024*1024});
    const auth=await request(app).post('/auth/login').set('Host','upgrade.test').set('Origin','https://upgrade.test').send({login:'admin',password:initial});assert.equal(auth.status,200);
    const change=await request(app).post('/auth/password').set('Host','upgrade.test').set('Origin','https://upgrade.test')
      .set('Cookie',auth.headers['set-cookie'][0].split(';')[0]).set('X-CSRF-Token',auth.body.csrfToken).send({currentPassword:initial,newPassword:personal});assert.equal(change.status,200);
    const cookie=change.headers['set-cookie'][0].split(';')[0],csrf=change.body.csrfToken;
    const get=(path:string)=>request(app).get(path).set('Cookie',cookie);
    const me=(await get('/api/v1/me')).body;
    const area=(await owner.query('SELECT id FROM app.res_units ORDER BY code LIMIT 1')).rows[0].id;
    const passwordHash=await hashPassword(initial);
    const employee=await transaction(runtime,me.id,async db=>(await db.query('SELECT app.local_admin_create($1,$2,$3,$4,$5) AS id',['legacy.employee','Учебный сотрудник до обновления',passwordHash,'RIRU_ENGINEER',area])).rows[0].id);
    const before=(await owner.query('SELECT password_hash FROM app.local_credentials WHERE user_id=$1',[employee])).rows[0].password_hash;
    assert.equal((await get('/api/v1/admin/local-users')).body.error.code,'ACCOUNT_SCHEMA_REQUIRED');
    assert.equal((await get('/api/v1/me')).status,200);
    await migrate(ownerUrl,decodeURIComponent(new URL(runtimeUrl).password));await migrate(ownerUrl,decodeURIComponent(new URL(runtimeUrl).password));
    assert.equal((await get('/api/v1/me')).body.id,me.id);
    const list=await get('/api/v1/admin/local-users');assert.equal(list.status,200);
    const old=list.body.find((u:any)=>u.id===employee);assert.equal(old.login,'legacy.employee');assert.equal(old.email,null);
    assert.equal((await owner.query('SELECT password_hash FROM app.local_credentials WHERE user_id=$1',[employee])).rows[0].password_hash,before);
    const update=await request(app).post('/api/v1/admin/local-users/'+employee+'/profile').set('Host','upgrade.test').set('Origin','https://upgrade.test')
      .set('Cookie',cookie).set('X-CSRF-Token',csrf).set('Idempotency-Key',randomUUID())
      .send({name:old.name,login:old.login,email:'legacy.employee@example.test',expectedRevision:old.revision,assignments:old.roles});
    assert.equal(update.status,200,JSON.stringify(update.body));
    assert.equal((await get('/api/v1/admin/local-users')).body.find((u:any)=>u.id===employee).email,'legacy.employee@example.test');
    console.log('PASS: Account upgrade from migration 015 preserves IDs, credentials and active sessions; pre-upgrade API explains required migration');
  }finally{await runtime.end();await owner.end();}
}
