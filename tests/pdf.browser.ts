// PDF — основной формат: загрузка, точный просмотр pdf.js, отметки сверки рамками на странице, «куда смотреть» и замечание
// по выделению в настоящем Chromium на изолированной БД. Только синтетические PDF (tests/pdf-fixtures.ts).
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
import {checkedPdf,syntheticPdf} from './pdf-fixtures.js';
import {PDFDocument} from 'pdf-lib';

const out=resolve('.local/pdf-browser-report');await mkdir(out,{recursive:true});
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
  await db.query('UPDATE app.users SET position=$2 WHERE id=$1',[id,role==='RIRU_HEAD'?'Начальник РИРУ (тест)':'Инженер РИРУ (тест)']);
 }
 {const id=(await db.query("INSERT INTO app.users(issuer,subject,name) VALUES('urn:tp-approval:local',$1,'Администратор · синтетический') RETURNING id",[randomUUID()])).rows[0].id;
  await db.query("INSERT INTO app.roles(user_id,role,res_id) VALUES($1,'TECH_ADMIN',NULL)",[id]);await db.query('INSERT INTO app.local_credentials(user_id,login,password_hash,must_change) VALUES($1,$2,$3,false)',[id,'adm',hash]);}
 await db.end();
 const pool=new pg.Pool({connectionString:runtime});
 let handler:any=null;server=httpServer((q:any,r:any)=>handler(q,r));
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const url=`http://127.0.0.1:${server.address().port}`;
 handler=createApp(pool,{authMode:'local',appOrigin:url,production:false,storagePath:resolve(root,'files'),maxFileBytes:20*1024*1024,webPath:resolve('dist/web')} as any);
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1600,height:950}});const page=await context.newPage();const errors:string[]=[];page.on('pageerror',(e:Error)=>errors.push(e.message));
 const shot=(n:string)=>page.screenshot({path:`${out}/${n}.png`});
 const login=async(l:string)=>{await page.goto(url);await page.getByLabel('Логин',{exact:true}).fill(l);await page.getByLabel('Пароль',{exact:true}).fill(userPassword);await page.getByRole('button',{name:'Войти',exact:true}).click();await page.getByRole('button',{name:'Выйти',exact:true}).waitFor();};
 const docs=resolve(root,'pdf')+'/';await mkdir(docs,{recursive:true});
 // Скреплённый PDF «уведомление + АВТУ» (09.11.2026): вид по заголовку, документы сохраняются раздельно.
 {const out=await PDFDocument.create();for(const lines of [['УВЕДОМЛЕНИЕ','об обеспечении сетевой организацией возможности присоединения к электрическим сетям','по договору об осуществлении технологического присоединения от 01.02.2026','Приложение к договору № 00001-26-00000004-1'],['АКТ','О ВЫПОЛНЕНИИ ТЕХНИЧЕСКИХ УСЛОВИЙ','Приложение к договору № 00001-26-00000004-1']]){const src=await PDFDocument.load(await syntheticPdf({lines}));for(const pg of await out.copyPages(src,[0]))out.addPage(pg);}await writeFile(docs+'stapled.pdf',await out.save());}
 await writeFile(docs+'tu.pdf',await checkedPdf('15','00001-26-00000004-1','TU'));await writeFile(docs+'act-bad.pdf',await checkedPdf('150'));await writeFile(docs+'act-good.pdf',await checkedPdf('15'));
 // 1. Инженер: загрузка ТУ и акта в PDF, карточка из ТУ.
 await login('eng');const form=page.getByRole('region',{name:'Загрузка документа инженером'});
 // Вкладки со значком в рамке (08.11.2026): выбранная — синий контур и заливка, без бегунка-таблетки.
 const modes=form.getByRole('group',{name:'Вид загружаемого документа'});await modes.getByRole('button',{name:'Доп. документы'}).click();
 assert.equal(await modes.getByRole('button',{name:'Доп. документы'}).getAttribute('aria-pressed'),'true');await modes.screenshot({path:`${out}/00a-tabs.png`});
 await modes.getByRole('button',{name:'Новый документ'}).click();await page.waitForTimeout(600);
 await form.getByLabel('Файл технических условий').setInputFiles(docs+'tu.pdf');await form.getByText('Реквизиты извлечены из ТУ').waitFor({timeout:20000});
 assert.equal(await form.getByLabel('Номер договора').inputValue(),'00001-26-00000004-1');assert.equal(await form.getByLabel('Максимальная мощность').inputValue(),'15');
 await form.getByLabel('Планируемая дата исполнения').fill('2026-12-15');await form.getByLabel('Файл загружаемого документа').setInputFiles(docs+'act-bad.pdf');
 await form.getByLabel('Файл: Поопорная схема').setInputFiles(docs+'tu.pdf');await page.screenshot({path:`${out}/00-upload-form.png`,fullPage:true});
 await form.getByRole('button',{name:'Сохранить документ',exact:true}).click();
 // Ход сохранения по шагам и «Документ учтён» со счётчиком черновиков, затем документ открывается сам (09.11.2026).
 const progress=form.getByRole('list',{name:'Ход сохранения'});await progress.waitFor();
 const done=form.getByRole('status').filter({hasText:'Документ учтён'});await done.waitFor({timeout:20000});
 assert.equal(await progress.locator('.up-done').count(),await progress.locator('li').count());assert.match(await done.innerText(),/теперь там\s*1/);
 await page.screenshot({path:`${out}/00b-upload-done.png`,fullPage:true});
 await page.getByRole('button',{name:'Режим проверки'}).waitFor({timeout:20000});
 await page.locator('.pdf-page canvas').first().waitFor({timeout:20000});await shot('01-document');
 await page.locator('.doc-picker select option').filter({hasText:'Поопорная схема'}).waitFor({state:'attached'});await page.getByRole('group',{name:'Разделы документа'}).getByRole('button',{name:'Данные'}).click();await page.locator('.package-extra').filter({hasText:'Поопорная схема'}).waitFor();await page.getByRole('group',{name:'Разделы документа'}).getByRole('button',{name:'Просмотр'}).click();console.log('OK 1: TU and act uploaded as PDF with visible step progress and «Документ учтён»; the act opens in the exact PDF view');
 // Тот же номер договора второй раз не проходит: предупреждение до сохранения, кнопка сохранения заблокирована.
 {await page.getByRole('button',{name:'Новый документ',exact:true}).click();const again=page.getByRole('region',{name:'Загрузка документа инженером'});
  await again.getByLabel('Файл технических условий').setInputFiles(docs+'tu.pdf');await again.getByText('Реквизиты извлечены из ТУ').waitFor({timeout:20000});await again.getByLabel('Файл загружаемого документа').setInputFiles(docs+'act-bad.pdf');
  const warn=again.getByRole('alert').filter({hasText:'уже есть в системе'});await warn.waitFor();assert.equal(await again.getByRole('button',{name:'Сохранить документ',exact:true}).isDisabled(),true);
  await warn.screenshot({path:`${out}/00c-duplicate.png`});
  // Тот же договор, но другие виды: уведомление и АВТУ в одном PDF — два документа, каждый своего вида.
  await again.getByLabel('Файл загружаемого документа').setInputFiles(docs+'stapled.pdf');
  const parts=again.getByRole('list',{name:'Документы в файле'});await parts.getByRole('listitem').nth(1).waitFor({timeout:20000});
  const partText=await parts.innerText();assert.ok(partText.includes('Уведомление')&&partText.includes('АВТУ')&&partText.includes('стр. 1')&&partText.includes('стр. 2'),partText);
  assert.equal(await again.getByLabel('Дата договора').inputValue(),'2026-02-01','дата договора из уведомления (в ТУ её нет)');
  await warn.waitFor({state:'detached'});await page.screenshot({path:`${out}/00e-stapled.png`,fullPage:true});
  await again.getByRole('button',{name:'Сохранить документ',exact:true}).click();await again.getByRole('status').filter({hasText:'Документ учтён'}).waitFor({timeout:30000});
  const steps=await again.getByRole('list',{name:'Ход сохранения'}).innerText();assert.ok(steps.includes('Уведомление · версия 1 · стр. 1')&&steps.includes('АВТУ · версия 1 · стр. 2'),steps);
  await page.getByRole('button',{name:'Режим проверки'}).waitFor({timeout:20000});
  assert.equal(await page.getByRole('heading',{level:1}).innerText(),'Уведомление');
  console.log('OK 1b: duplicate of the same kind is blocked; a stapled PDF is split by titles into a notice and an AVTU saved as separate documents');}
 // «Синхронизация» с «Учёт ПУ»: договор с техническими характеристиками из ТУ и отметкой «не синхронизирован».
 {await page.getByRole('button',{name:'Синхронизация',exact:true}).click();const panel=page.getByRole('region',{name:'Синхронизация с «Учёт ПУ»'});
  const row=panel.getByRole('article',{name:'Договор 00001-26-00000004-1'});await row.waitFor();
  const tech=await row.getByLabel('Технические характеристики').innerText();assert.ok(tech.includes('15 кВт')&&tech.includes('0,4 кВ'),tech);
  assert.ok((await row.getByRole('status').innerText()).includes('Не синхронизирован'));
  assert.equal(await panel.getByRole('button',{name:'Не синхронизированы: 1'}).count(),1);
  await page.screenshot({path:`${out}/00d-sync.png`,fullPage:true});
  await row.getByRole('button',{name:'00001-26-00000004-1'}).click();await page.getByRole('button',{name:'Режим проверки'}).waitFor();
  console.log('OK 1c: «Синхронизация» lists the contract with TU characteristics and sync status; the document opens from the list');}
 // 2. Сверка: рамки цвета статуса прямо на странице; клик по красному значению — пара в ТУ обведена, значение выделено.
 await page.getByRole('button',{name:'Режим проверки'}).click();const review=page.getByRole('dialog',{name:'Режим проверки документов'});
 await review.getByRole('tab',{name:/Сверка с ТУ/}).click();await review.getByRole('button',{name:'Проверить по ТУ',exact:true}).click();await review.getByText(/⚠ Расхождение/).first().waitFor({timeout:20000});
 assert.equal(await review.locator('option',{hasText:'Поопорная схема'}).count(),1,'Extra document can be opened for comparison');
 const panes=review.locator('.review-pane');const left=panes.nth(0),right=panes.nth(1);
 await left.locator('.pdf-mark[data-mark=bad]').first().waitFor({timeout:15000});await right.locator('.pdf-mark[data-mark=bad]').first().waitFor({timeout:15000});
 assert.ok(await left.locator('.pdf-mark[data-mark=ok]').count()>=3,'Matching requisites are framed green on the PDF page');
 const bad=await left.locator('.pdf-mark[data-mark=bad]').first().boundingBox();await page.mouse.click(bad!.x+bad!.width/2,bad!.y+bad!.height/2);
 await right.locator('.pdf-jump[data-jump=bad]').waitFor();await right.locator('.pdf-value-hit').first().waitFor();await left.locator('.pdf-jump[data-jump=bad]').waitFor();
 await page.waitForTimeout(400);await shot('02-review-pdf');console.log('OK 2: PDF pages in review mode; marks drawn on the page; click shows the paired value in the TU');
 await review.getByRole('button',{name:'Завершить проверку'}).click();await review.waitFor({state:'detached'});
 // 3. Исправленная версия PDF проходит сверку и уходит на согласование.
 await page.getByRole('group',{name:'Разделы документа'}).getByRole('button',{name:'Данные'}).click();await page.getByLabel('Новая версия DOCX').setInputFiles(docs+'act-good.pdf');await page.locator('.word-heading select option').filter({hasText:'Версия 2'}).waitFor({state:'attached',timeout:20000});
 await page.getByRole('button',{name:'Режим проверки'}).click();await review.getByRole('tab',{name:/Сверка с ТУ/}).click();await review.getByRole('button',{name:'Проверить по ТУ',exact:true}).click();
 await review.getByText('Проверенные реквизиты совпали. Можно отправить на согласование.',{exact:true}).waitFor({timeout:20000});
 await review.getByRole('button',{name:'Отправить на согласование',exact:true}).click();await page.waitForTimeout(1500);
 await review.getByRole('button',{name:'Завершить проверку'}).click();console.log('OK 3: corrected PDF version passes the TU check and is submitted');
 // 4. Начальник РИРУ выделяет «15 кВт» в тексте PDF и оставляет замечание — оно привязано именно к этим словам.
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('head');
 await page.locator('[data-testid^="registry-row-"]').first().click();await page.getByRole('button',{name:'Режим проверки'}).click();
 const span=left.locator('.textLayer span').filter({hasText:'15 кВт'}).first();await span.waitFor({timeout:20000});
 await span.evaluate((el:Element)=>{const n=el.firstChild!;const i=n.textContent!.indexOf('15 кВт');const r=document.createRange();r.setStart(n,i);r.setEnd(n,i+6);getSelection()!.removeAllRanges();getSelection()!.addRange(r);el.dispatchEvent(new MouseEvent('mouseup',{bubbles:true}));});
 await review.getByRole('button',{name:'＋ Замечание'}).click();await review.getByLabel('Текст замечания').fill('Сверить мощность с расчётом нагрузки (синтетическое замечание к PDF).');
 await review.getByRole('button',{name:'Сохранить замечание',exact:true}).click();await review.locator('.review-note').first().waitFor({timeout:15000});await left.locator('.pdf-remark').first().waitFor({timeout:15000});
 assert.match(await left.locator('.pdf-remark').first().getAttribute('aria-label')??'',/Замечание: 15 кВт$/);
 await page.waitForTimeout(400);await shot('03-remark-pdf');console.log('OK 4: reviewer selects words in the PDF text layer; the remark is anchored to exactly those words');
 // 5. Администратор: «Все документы» всех РЭС с фильтром по РЭС, просмотр без права действий, кнопка удаления.
 await review.getByRole('button',{name:'Завершить проверку'}).click();await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('adm');await page.getByRole('button',{name:'Все документы',exact:true}).click();
 await page.getByRole('heading',{name:'Все документы'}).waitFor();await page.locator('[data-testid^="registry-row-"]').first().waitFor({timeout:15000});
 await page.getByLabel('РЭС').first().waitFor();await shot('05-admin-all');
 await page.locator('[data-testid^="registry-row-"]').first().click();await page.locator('.pdf-page canvas').first().waitFor({timeout:20000});
 await page.getByRole('button',{name:'Удалить документ'}).waitFor();assert.equal(await page.getByRole('button',{name:'Согласовать'}).count(),0);
 await shot('06-admin-document');console.log('OK 5: admin sees all documents with a RES filter, opens them read-only and has the delete button');
 assert.deepEqual(errors,[]);console.log('PASS: PDF documents e2e');
}catch(e){const p=browser?.contexts()[0]?.pages()[0];if(p){await p.screenshot({path:out+'/failure.png'});console.log('ALERTS:',await p.locator('[role=alert]').allTextContents());}console.log('FAIL:',(e as Error).message.slice(0,600));throw e;}finally{await browser?.close();server?.close();await control(['-D',resolve(root,'pg'),'-m','fast','-w','stop']).catch(()=>{});}
process.exit(0);
