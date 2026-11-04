// Режим проверки в настоящем Chromium на изолированной БД: инженер сверяет и отправляет, начальник РИРУ оставляет замечание.
// Только синтетические данные (.local/demo-documents из scripts/create-engineer-fixtures.py).
import {mkdtemp,cp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer as httpServer} from 'node:http';
import assert from 'node:assert/strict';
import pg from 'pg';
import {chromium} from 'playwright';
import {migrate} from '../scripts/migrate.js';
import {setupStandalone} from '../scripts/setup-standalone.js';
import {createApp} from '../apps/api/src/app.js';
import {hashPassword} from '../apps/api/src/passwords.js';

const out=resolve('.local/review-browser-report');await mkdir(out,{recursive:true});
const root=await mkdtemp(resolve(tmpdir(),'tp-review-'));
const binaries=await import(`@embedded-postgres/windows-${process.arch}`);
await cp(resolve(dirname(binaries.postgres),'..'),resolve(root,'native'),{recursive:true});const bin=resolve(root,'native','bin');
const exe=(n:string)=>resolve(bin,n+'.exe');const run=promisify(execFile);
const control=(args:string[])=>new Promise<void>((ok,fail)=>{const c=spawn(exe('pg_ctl'),args,{windowsHide:true,stdio:'ignore'});c.on('error',fail);c.on('exit',code=>code===0?ok():fail(new Error('pg_ctl '+code)));});
const probe=createServer();await new Promise<void>(r=>probe.listen(0,'127.0.0.1',r));const port=(probe.address() as any).port;await new Promise<void>(r=>probe.close(()=>r()));
const password=randomBytes(16).toString('hex'),runtimePassword=randomBytes(16).toString('hex'),pw=resolve(root,'pw');await writeFile(pw,password);
await run(exe('initdb'),['-D',resolve(root,'pg'),'-U','postgres',`--pwfile=${pw}`,'--auth=scram-sha-256','--encoding=UTF8','--locale=C']);
await control(['-D',resolve(root,'pg'),'-l',resolve(root,'pg.log'),'-o',`-h 127.0.0.1 -p ${port}`,'-w','start']);
let server:any,browser:any;
try{
 const owner=`postgres://postgres:${password}@127.0.0.1:${port}/postgres`,runtime=`postgres://tp_runtime:${runtimePassword}@127.0.0.1:${port}/postgres`;
 await setupStandalone({AUTH_MODE:'local',DATABASE_URL:runtime,MIGRATION_DATABASE_URL:owner,INITIAL_ADMIN_PASSWORD:'Synthetic-admin-123'});
 const db=new pg.Client({connectionString:owner});await db.connect();
 const userPassword='1191';const hash=await hashPassword(userPassword);
 for(const [login,name,role] of [['eng','Инженер РИРУ · синтетический','RIRU_ENGINEER'],['head','Начальник РИРУ · синтетический','RIRU_HEAD']]){
  const id=(await db.query("INSERT INTO app.users(issuer,subject,name) VALUES('urn:tp-approval:local',$1,$2) RETURNING id",[randomUUID(),name])).rows[0].id;
  await db.query("INSERT INTO app.roles(user_id,role,res_id) VALUES($1,$2,(SELECT id FROM app.res_units WHERE code='ADLER'))",[id,role]);
  await db.query('INSERT INTO app.local_credentials(user_id,login,password_hash,must_change) VALUES($1,$2,$3,false)',[id,login,hash]);
 }
 await db.end();
 const pool=new pg.Pool({connectionString:runtime});
 let handler:any=null;server=httpServer((q:any,r:any)=>handler(q,r));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 handler=createApp(pool,{authMode:'local',appOrigin:url,production:false,storagePath:resolve(root,'files'),maxFileBytes:20*1024*1024,webPath:resolve('dist/web')} as any);
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1600,height:950}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
 const shot=(n:string)=>page.screenshot({path:`${out}/${n}.png`});
 const login=async(l:string)=>{await page.goto(url);await page.getByLabel('Логин',{exact:true}).fill(l);await page.getByLabel('Пароль',{exact:true}).fill(userPassword);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).waitFor();};
 const docs='.local/demo-documents/';
 // 1. Инженер: загрузка ТУ + акт, карточка из ТУ.
 await login('eng');const form=page.getByRole('region',{name:'Загрузка документа инженером'});
 await form.getByLabel('Файл технических условий').setInputFiles(docs+'engineer-tu.docx');await form.getByText('Реквизиты извлечены из ТУ').waitFor();
 assert.equal(await form.getByLabel('Номер договора').inputValue(),'00001-26-00000004-1');assert.equal(await form.getByLabel('Максимальная мощность').inputValue(),'15');
 assert.equal(await form.getByLabel('Уровень напряжения').inputValue(),'0.4');assert.equal(await form.getByLabel('Фазность').inputValue(),'3ф');
 await form.getByLabel('Планируемая дата исполнения').fill('2026-12-15');await form.getByLabel('Файл загружаемого документа').setInputFiles(docs+'engineer-act-bad.docx');
 await shot('01-upload');console.log('OK 1: TU fills contract number and card (15 кВт, 0,4 кВ, 3ф)');
 await form.getByRole('button',{name:'Сохранить документ',exact:true}).click();await page.getByRole('button',{name:'Режим проверки'}).waitFor({timeout:20000});
 // 2. Режим проверки у инженера: автосверка подсвечивает расхождение в обоих окнах.
 await page.getByRole('button',{name:'Режим проверки'}).click();const review=page.getByRole('dialog',{name:'Режим проверки документов'});
 await review.getByRole('tab',{name:/Сверка с ТУ/}).click();await review.getByRole('button',{name:'Проверить по ТУ',exact:true}).click();await review.getByText(/⚠ Расхождение/).first().waitFor({timeout:20000});
 const frames=review.locator('iframe');await frames.nth(0).contentFrame().locator('p.check-hit').first().waitFor({timeout:15000});await frames.nth(1).contentFrame().locator('p.check-hit').first().waitFor({timeout:15000});
 await review.getByLabel('Синхронная прокрутка').check({force:true});await page.waitForTimeout(800);await shot('02-review-engineer');console.log('OK 2: review mode shows act and TU side by side; differences highlighted in both panes');
 assert.equal(await review.getByRole('button',{name:'+ Добавить замечание'}).count(),0);
 await review.getByRole('button',{name:'Завершить проверку'}).click();await review.waitFor({state:'detached'});
 // 3. Исправленная версия, сверка, отправка из режима проверки.
 await page.getByLabel('Новая версия DOCX').setInputFiles(docs+'engineer-act-good.docx');await page.locator('.word-heading select option').filter({hasText:'Версия 2'}).waitFor({state:'attached',timeout:20000});
 await page.getByRole('button',{name:'Режим проверки'}).click();await review.getByRole('tab',{name:/Сверка с ТУ/}).click();await review.getByRole('button',{name:'Проверить по ТУ',exact:true}).click();
 await review.getByText('Проверенные реквизиты совпали. Можно отправить на согласование.',{exact:true}).waitFor({timeout:20000});
 await review.getByRole('button',{name:'Отправить на согласование',exact:true}).click();await page.waitForTimeout(1500);await shot('03-sent');
 await review.getByRole('button',{name:'Завершить проверку'}).click();
 console.log('OK 3: corrected version passes check and is sent from review mode');
 // 4. Начальник РИРУ: замечание к выделенному фрагменту в режиме проверки.
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('head');
 await page.locator('[data-testid^="registry-row-"]').first().click();await page.getByRole('button',{name:'Режим проверки'}).click();
 const left=review.locator('iframe').nth(0).contentFrame();await left.locator('p[data-block-id]').filter({hasText:'15 кВт'}).first().waitFor({timeout:20000});
 await left.locator('p[data-block-id]').filter({hasText:'15 кВт'}).first().evaluate((el:Element)=>{const doc=el.ownerDocument,w=doc.createTreeWalker(el,4);let n;while(n=w.nextNode()){const i=n.textContent!.indexOf('15 кВт');if(i>=0){const r=doc.createRange();r.setStart(n,i);r.setEnd(n,i+6);doc.getSelection()!.removeAllRanges();doc.getSelection()!.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));return;}}});
 await review.getByRole('button',{name:'+ Добавить замечание'}).click();await review.getByLabel('Текст замечания').fill('Сверить мощность с расчётом нагрузки (синтетическое замечание).');
 await review.getByRole('button',{name:'Сохранить замечание',exact:true}).click();await review.locator('.review-note').first().waitFor({timeout:15000});await left.locator('mark[data-remark-ids]').first().waitFor({timeout:15000});
 await page.waitForTimeout(500);await shot('04-review-head');console.log('OK 4: reviewer adds a remark to a selected fragment of the act in review mode');
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
 assert.ok(await page.evaluate(()=>{const m=document.querySelector('.review-mode')!;return m.scrollWidth<=innerWidth&&m.scrollHeight>innerHeight;}),'Review mode on a phone scrolls vertically without horizontal overflow');
 await review.locator('.review-pane').nth(1).scrollIntoViewIfNeeded();await page.screenshot({path:`${out}/05-mobile.png`});console.log('OK 5: phone layout stacks panes and scrolls without horizontal overflow');
 assert.deepEqual(errors,[]);console.log('PASS: review mode e2e');
}catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:out+'/failure.png'});console.log('ALERTS:',await p.locator('[role=alert]').allTextContents());}console.log('FAIL:',(e as Error).message.slice(0,600));throw e;}finally{await browser?.close();server?.close();await control(['-D',resolve(root,'pg'),'-m','fast','-w','stop']).catch(()=>{});}
process.exit(0);
