import {prepareLegacyAct} from './workplace.ui.js';
import {passRiruReview} from './workplace.ui.js';
import {openAct as openWorkplace,decide as decideInWorkplace,idle} from './workplace.ui.js';
import {chromium,type Page,type BrowserContext} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID,createHash} from 'node:crypto';
import pg from 'pg';
import {demoUsers} from '../scripts/demo-users.js';

const origin='http://127.0.0.1:5173';const issuer='http://127.0.0.1:4100';const apiOrigin='http://127.0.0.1:3000';
const readyDeadline=Date.now()+20000;while(true){try{if((await fetch(origin)).ok&&(await fetch(apiOrigin+'/ready')).ok)break;}catch{}if(Date.now()>readyDeadline)throw new Error('Локальный тестовый стенд не готов');await new Promise(r=>setTimeout(r,200));}
const reportDir=resolve('.local/browser-report');await mkdir(reportDir,{recursive:true});
const checks:{name:string;details?:unknown}[]=[];const failures:string[]=[];
const check=(name:string,details?:unknown)=>{checks.push({name,details});console.log(`OK ${checks.length}: ${name}`);};
// Use an isolated browser profile. Never attach to the user's open Chrome.
const executable=process.env.TP_BROWSER_EXECUTABLE??(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':undefined);
const browser=await chromium.launch({headless:true,executablePath:executable});
const contexts:BrowserContext[]=[];const pages:Record<string,Page>={};const tokens:Record<string,string>={};
const baseline:Record<string,number>={};
const request=async(subject:string,path:string,body?:object)=>{
  if(!tokens[subject]){const response=await fetch(`${issuer}/token`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({subject})});assert.equal(response.status,200);tokens[subject]=(await response.json()).token;}
  const response=await fetch(`${apiOrigin}${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${tokens[subject]}`,...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}:{})},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>null);return {status:response.status,data};
};
async function login(page:Page,subject:string){
  await page.goto(origin);await page.getByLabel('Демонстрационный пользователь').selectOption(subject);await page.getByRole('button',{name:'Войти в тестовый стенд'}).click();
  await page.locator('header').getByText(demoUsers.find(u=>u.subject===subject)!.name,{exact:true}).waitFor();
}
async function reloadData(page:Page){await page.getByRole('button',{name:'Обновить данные',exact:true}).click();await idle(page);}
async function openAct(page:Page,actNumber:string){await openWorkplace(page,actNumber);}
async function decide(page:Page,choice='APPROVE',reason=''){return decideInWorkplace(page,choice,reason);}
async function screen(page:Page,name:string){await page.screenshot({path:resolve(reportDir,`${name}.png`),fullPage:true});}
let summary:Record<string,unknown>={};
try{
  for(const user of demoUsers){const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});contexts.push(context);const page=await context.newPage();page.on('pageerror',e=>failures.push(e.message));pages[user.subject]=page;await login(page,user.subject);}
  for(const user of demoUsers)baseline[user.subject]=(await request(user.subject,'/api/platform/badge')).data.count;
  check('Настоящий Chrome запущен; 11 изолированных пользовательских сессий вошли через подписанные JWT',{browser:browser.version()});
  const riru=pages['riru-adler'];const chief=pages['chief-adler'];const sue=pages.sue;const stp=pages.stp;const gi=pages.gi;
  const stamp=Date.now();const number=`БРАУЗЕР-${stamp}`;
  // Legacy downstream fixture: new TU-first creation is covered by engineer.browser.ts.
  const engineer=(await request('riru-adler','/api/v1/me')).data;const area=engineer.roles.find((r:any)=>r.role==='RIRU_ENGINEER').resId;
  const created=await request('riru-adler','/api/v1/acts',{resId:area,contractNumber:`ДЕМО-${stamp}/ТП`,contractDate:'2026-10-31',actNumber:number,applicant:'Учебный заявитель',address:'Условный учебный адрес'});assert.equal(created.status,200);const act=created.data;await prepareLegacyAct(act.id);await riru.evaluate(id=>{location.hash=`#/acts/${id}?section=upload`;},act.id);
  await riru.getByRole('heading',{name:`Акт ${number}`,exact:true}).waitFor();await idle(riru);check('Legacy-карточка подготовлена через API и открыта в браузере',{actId:act.id,actNumber:number});
  await riru.getByLabel('Новая версия DOCX').setInputFiles({name:'invalid.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',buffer:Buffer.from('invalid DOCX')});
  await riru.getByRole('alert').filter({hasText:'DOCX'}).waitFor();await idle(riru);await screen(riru,'01-upload-validation');check('Неверный DOCX отклонён, сообщение об ошибке видно в браузере');
  await riru.getByLabel('Новая версия DOCX').setInputFiles(resolve('.local/demo-documents/act-v1.docx'));
  await riru.getByRole('button',{name:'Отправить на согласование'}).waitFor();
  await riru.getByRole('button',{name:'Отправить на согласование'}).click();await idle(riru);await passRiruReview(act.id);
  await riru.locator('.act-detail .status').filter({hasText:'Начальник РЭС'}).waitFor();
  assert.equal((await request('chief-adler','/api/platform/badge')).data.count,baseline['chief-adler']+1);check('DOCX v1 загружен и отправлен; badge Начальника РЭС увеличился на 1');
  await openAct(chief,number);assert.ok(await chief.locator('.task-deadline').textContent());await screen(chief,'02-chief-review');
  assert.equal((await decide(chief)).status(),200);
  for(const u of ['sue','stp','gi']){assert.equal((await request(u,'/api/platform/badge')).data.count,baseline[u]+1);await openAct(pages[u],number);}
  check('Первичное согласование в браузере открыло три независимые задачи СУЭ/СТП/ГИ');
  assert.equal((await decide(sue,'RETURN','В учебном акте ошибочно указано 150 кВт вместо 15 кВт.')).status(),200);
  await sue.locator('.act-detail .status').filter({hasText:'Проверка служб продолжается'}).waitFor();await screen(sue,'03-comments-collection');
  assert.equal((await request('riru-adler','/api/platform/badge')).data.count,baseline['riru-adler']);
  assert.equal((await request('stp','/api/platform/badge')).data.count,baseline.stp+1);assert.equal((await request('gi','/api/platform/badge')).data.count,baseline.gi+1);
  assert.equal((await decide(stp)).status(),200);assert.equal((await decide(gi)).status(),200);
  await openAct(riru,number);await riru.locator('.act-detail .status').filter({hasText:'На доработке'}).waitFor();
  assert.equal((await request('riru-adler','/api/platform/badge')).data.count,baseline['riru-adler']+1);
  assert.ok((await riru.locator('.comment.unresolved').textContent())?.includes('Демо · СУЭ'));
  assert.equal(await riru.locator('.comment.unresolved').evaluate(el=>getComputedStyle(el).borderLeftColor),'rgb(189, 64, 57)');
  await screen(riru,'04-returned-red-comment');check('Остальные подразделения завершили проверки; акт вернулся РИРУ с красным замечанием и автором');
  const before=(await request('riru-adler',`/api/v1/acts/${act.id}`)).data;
  await riru.reload();await riru.getByRole('heading',{name:'Авторизация'}).waitFor();await login(riru,'riru-adler');await openAct(riru,number);
  assert.ok(await riru.locator('.comment.unresolved').getByText('В учебном акте ошибочно указано 150 кВт вместо 15 кВт.',{exact:true}).isVisible());
  const after=(await request('riru-adler',`/api/v1/acts/${act.id}`)).data;
  assert.deepEqual(after.versions,before.versions);assert.deepEqual(after.comments,before.comments);assert.deepEqual(after.tasks,before.tasks);
  check('После обновления страницы и повторного входа версии, замечания и решения сохранились');
  await riru.getByLabel('Новая версия DOCX').setInputFiles(resolve('.local/demo-documents/act-v2.docx'));
  await riru.getByRole('button',{name:'Указать исправление'}).waitFor();
  await riru.getByLabel('Описание исправления или проверки').fill('Исправлена мощность: 15 кВт, версия 2.');await riru.getByRole('button',{name:'Указать исправление'}).click();
  await riru.locator('.remark-history').filter({hasText:'Исправлена мощность: 15 кВт, версия 2.'}).waitFor();
  await riru.getByRole('button',{name:'Отправить на согласование'}).click();await idle(riru);await passRiruReview(act.id);
  await riru.locator('.act-detail .status').filter({hasText:'Начальник РЭС'}).waitFor();
  await openAct(chief,number);assert.equal((await decide(chief)).status(),200);await openAct(sue,number);
  assert.equal(await sue.getByRole('button',{name:'Согласовать',exact:true}).isDisabled(),true);const pending=(await request('sue','/api/v1/tasks/mine')).data.find((t:any)=>t.act_id===act.id);assert.equal((await request('sue',`/api/v1/tasks/${pending.id}/decision`,{decision:'APPROVE'})).status,409);check('Нельзя согласовать новую версию до подтверждения устранения своего замечания');
  await sue.getByLabel('Описание исправления или проверки').fill('Проверена версия 2: мощность 15 кВт.');await sue.getByRole('button',{name:'Подтвердить устранение'}).click();
  await sue.locator('.comment.resolved').waitFor();assert.equal(await sue.locator('.comment.resolved').evaluate(el=>getComputedStyle(el).borderLeftColor),'rgb(51, 134, 89)');await screen(sue,'05-fix-confirmed');
  assert.equal((await decide(sue)).status(),200);await openAct(stp,number);assert.equal((await decide(stp)).status(),200);await openAct(gi,number);assert.equal((await decide(gi)).status(),200);
  await openAct(riru,number);await riru.locator('.act-detail .status').filter({hasText:'Согласовано'}).waitFor();await screen(riru,'06-approved-desktop');
  const final=(await request('riru-adler',`/api/v1/acts/${act.id}`)).data;
  assert.equal(final.state,'APPROVED');assert.equal(final.cycles.length,2);assert.equal(final.versions.length,2);assert.equal(final.tasks.filter((t:any)=>t.decision).length,10);assert.equal(final.releases[0].status,'CURRENT');
  check('Полный повторный браузерный цикл завершён: APPROVED, 2 версии, 2 цикла, 10 решений и 1 публикация');
  const downloadEvent=riru.waitForEvent('download');await riru.getByRole('button',{name:'Скачать оригинал'}).last().click();const download=await downloadEvent;
  const downloaded=resolve(reportDir,'downloaded-v2.docx');await download.saveAs(downloaded);
  const hash=(data:Buffer)=>createHash('sha256').update(data).digest('hex');assert.equal(hash(await readFile(downloaded)),hash(await readFile('.local/demo-documents/act-v2.docx')));check('Скачанная через браузер версия DOCX побайтно совпадает с загруженной');
  const privateFile=final.versions[0].file_id;
  for(const subject of ['riru-hosta','chief-hosta','tech']){
    assert.equal((await request(subject,`/api/v1/acts/${act.id}`)).status,404);assert.equal((await request(subject,`/api/v1/files/${privateFile}/download`)).status,404);
    assert.ok(!(await request(subject,'/api/v1/acts')).data.some((a:any)=>a.id===act.id));
    await reloadData(pages[subject]);assert.equal(await pages[subject].getByText(number,{exact:true}).count(),0);
  }
  check('Хостинский РЭС и TECH_ADMIN не видят акт/файл в UI и при прямом API-запросе (404)');
  for(const u of demoUsers){const badge=await request(u.subject,'/api/platform/badge');const notifications=await request(u.subject,'/api/v1/notifications');assert.equal(badge.status,200);assert.equal(badge.data.count,baseline[u.subject]);assert.equal(notifications.status,200);const count=notifications.data.filter((n:any)=>n.act_id===act.id).length;assert.equal(count,['riru-adler','riru-head-adler','chief-adler','sue','stp','gi'].includes(u.subject)?2:0);}
  const notes=(await request('riru-adler','/api/v1/notifications')).data.filter((n:any)=>n.act_id===act.id);assert.ok(notes.some((n:any)=>n.type==='RETURNED'));assert.ok(notes.some((n:any)=>n.type==='APPROVED'));
  assert.equal((await request('riru-hosta',`/api/v1/notifications/${notes[0].id}/read`,{})).status,404);
  await riru.getByRole('button',{name:/^Уведомления/}).click();await riru.getByText(/Согласование завершено/).first().waitFor();await screen(riru,'07-notifications');await riru.getByRole('button',{name:'Закрыть уведомления',exact:true}).click();check('Badge проверен для всех 11 ролей/пользователей; уведомления персональны, чужое сообщение недоступно');
  // A dedicated extra task proves overdue rendering without touching the approved act.
  const overdueNumber=`СРОК-${stamp}`;const overdueCreated=await request('riru-adler','/api/v1/acts',{resId:area,contractNumber:`УЧЕБНЫЙ-СРОК-${stamp}`,contractDate:'2026-10-31',actNumber:overdueNumber,applicant:'Учебный срок',address:'Условный объект для проверки срока'});assert.equal(overdueCreated.status,200);const overdueAct=overdueCreated.data;await prepareLegacyAct(overdueAct.id);await riru.evaluate(id=>{location.hash=`#/acts/${id}?section=upload`;},overdueAct.id);await riru.getByRole('heading',{name:`Акт ${overdueNumber}`,exact:true}).waitFor();await idle(riru);
  await riru.getByLabel('Новая версия DOCX').setInputFiles(resolve('.local/demo-documents/act-v1.docx'));await riru.getByRole('button',{name:'Отправить на согласование'}).waitFor();await riru.getByRole('button',{name:'Отправить на согласование'}).click();await idle(riru);await passRiruReview(overdueAct.id);await riru.locator('.act-detail .status').filter({hasText:'Начальник РЭС'}).waitFor();
  const state=JSON.parse(await readFile('.local/demo.json','utf8'));const root=resolve(state.root);assert.equal(dirname(root),resolve(tmpdir()));assert.ok(root.split(sep).at(-1)!.startsWith('tp-approval-demo-'));
  const db=new pg.Client({host:'127.0.0.1',port:55432,database:'tp_approval_demo',user:'postgres',password:state.ownerPassword});await db.connect();
  try{assert.equal((await db.query("SELECT kind FROM public.demo_marker")).rows[0].kind,'TP_APPROVAL_SYNTHETIC_ONLY');await db.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[overdueAct.id]);}finally{await db.end();}
  await openAct(chief,overdueNumber);await chief.locator('.task-deadline.overdue').waitFor();assert.equal((await request('chief-adler','/api/platform/badge')).data.count,baseline['chief-adler']+1);await screen(chief,'08-overdue');
  assert.ok((await request('process','/api/v1/admin/run-deadlines',{})).data.emitted>=2);assert.equal((await request('process','/api/v1/admin/run-deadlines',{})).data.emitted,0);check('Просрочка видна красным, badge не удвоен; уведомление и эскалация дедуплицируются');
  await riru.reload();await login(riru,'riru-adler');await openAct(riru,number);const persisted=(await request('riru-adler',`/api/v1/acts/${act.id}`)).data;assert.equal(persisted.state,'APPROVED');assert.equal(persisted.tasks.filter((t:any)=>t.decision).length,10);assert.equal(persisted.comments[0].events.length,2);assert.deepEqual(await riru.evaluate(()=>Object.keys(localStorage)),[]);check('Итоговое согласование и исправления сохраняются после повторного входа; JWT не хранится в localStorage');
  await riru.setViewportSize({width:390,height:844});await screen(riru,'09-approved-mobile');assert.ok(await riru.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));check('Мобильный viewport 390×844 не имеет горизонтального переполнения страницы');
  assert.deepEqual(failures,[]);check('Ошибок JavaScript в браузере не обнаружено');
  summary={actId:act.id,actNumber:number,overdueActId:overdueAct.id,overdueActNumber:overdueNumber,state:persisted.state,browser:browser.version()};
}catch(error){failures.push((error as Error).message);for(const [subject,page]of Object.entries(pages))await screen(page,`failure-${subject}`).catch(()=>{});throw error;}
finally{
  await writeFile(resolve(reportDir,'result.json'),JSON.stringify({at:new Date().toISOString(),browserLaunched:true,summary,checks,failures},null,2));
  for(const context of contexts)await context.close();await browser.close();console.log(`Отчёт: ${reportDir}`);
}
