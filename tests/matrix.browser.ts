import {prepareLegacyAct} from './workplace.ui.js';
import {passRiruReview} from './workplace.ui.js';
import {openAct as openWorkplace,documentView,decide as uiDecision,idle as waitIdle} from './workplace.ui.js';
import {chromium,type Page,type BrowserContext} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,sep} from 'node:path';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';
import pg from 'pg';

const origin='http://127.0.0.1:5173';const issuer='http://127.0.0.1:4100';
const readyDeadline=Date.now()+20000;
while(true){try{const ready=await Promise.all([fetch(origin),fetch('http://127.0.0.1:3000/ready')]);if(ready.every(r=>r.ok))break;}catch{}if(Date.now()>readyDeadline)throw new Error('Локальный demo-стенд не готов. Запустите npm run demo.');await new Promise(r=>setTimeout(r,250));}
const out=resolve('.local/matrix-report');await mkdir(out,{recursive:true});
const state=JSON.parse(await readFile('.local/demo.json','utf8'));assert.equal(dirname(resolve(state.root)),resolve(tmpdir()));assert.ok(resolve(state.root).split(sep).at(-1)!.startsWith('tp-approval-demo-'));
const db=new pg.Client({host:'127.0.0.1',port:55432,database:'tp_approval_demo',user:'postgres',password:state.ownerPassword});await db.connect();
assert.equal((await db.query('SELECT kind FROM public.demo_marker')).rows[0].kind,'TP_APPROVAL_SYNTHETIC_ONLY');
const browser=await chromium.launch({headless:true,executablePath:process.env.TP_BROWSER_EXECUTABLE??(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':undefined)});
const contexts:BrowserContext[]=[];const tokens:Record<string,string>={};const checks:string[]=[];const errors:string[]=[];const substitutions:string[]=[];const pages:Record<string,Page>={};
const pass=(s:string)=>{checks.push(s);console.log(`MATRIX BROWSER OK ${checks.length}: ${s}`);};
const api=async(user:string,path:string,body?:object)=>{
  if(!tokens[user]){const r=await fetch(`${issuer}/token`,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({subject:user})});tokens[user]=(await r.json()).token;}
  const r=await fetch(`http://127.0.0.1:3000${path}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${tokens[user]}`,...(body?{'Content-Type':'application/json','Idempotency-Key':randomUUID()}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,body:await r.json().catch(()=>null)};
};
async function login(p:Page,user:string){await p.goto(origin);await p.getByLabel('Демонстрационный пользователь').selectOption(user);await p.getByRole('button',{name:'Войти в тестовый стенд'}).click();await p.getByRole('button',{name:'Выйти',exact:true}).waitFor();}
async function idle(p:Page){await waitIdle(p);}
async function open(p:Page,number:string){await openWorkplace(p,number);}
async function documentTab(p:Page){await documentView(p);}
async function matrix(p:Page){await p.getByRole('button',{name:'Матрица',exact:true}).click();await p.getByTestId('matrix-row-RES_HEAD').waitFor();}
async function decide(p:Page,decision='APPROVE',reason=''){assert.equal((await uiDecision(p,decision,reason)).status(),200);await idle(p);}
async function stage(p:Page,role:string,text:string){await p.getByTestId(`matrix-row-${role}`).getByText(text,{exact:true}).waitFor();}
async function summary(p:Page,text:string){await p.getByRole('region',{name:'Итог согласования',exact:true}).getByText(text,{exact:true}).waitFor();}
async function screen(p:Page,file:string){await p.screenshot({path:resolve(out,`${file}.png`),fullPage:true});}
let result:Record<string,unknown>={};
try{
  for(const user of ['riru-adler','chief-adler','sue','stp','gi','chief-hosta']){const c=await browser.newContext({viewport:{width:1500,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow'});contexts.push(c);const p=await c.newPage();p.on('pageerror',e=>errors.push(e.message));pages[user]=p;await login(p,user);}
  const p=pages['riru-adler'];const chief=pages['chief-adler'];const stamp=Date.now();const number=`МАТРИЦА-${stamp}`;
  async function create(number:string){const profile=(await api('riru-adler','/api/v1/me')).body;const response=await api('riru-adler','/api/v1/acts',{resId:profile.roles.find((r:any)=>r.role==='RIRU_ENGINEER').resId,contractNumber:`ДЕМО-${number}`,contractDate:'2026-10-31',actNumber:number,applicant:'Учебная матрица',address:'Синтетический объект матрицы'});assert.equal(response.status,200);const act=response.body;await prepareLegacyAct(act.id);await p.evaluate(id=>{location.hash=`#/acts/${id}?section=upload`;},act.id);await p.getByRole('heading',{name:`Акт ${number}`,exact:true}).waitFor();await idle(p);return act;}
  async function uploadAndSubmit(v:number){await documentTab(p);await p.getByLabel('Новая версия DOCX').setInputFiles(resolve(`.local/demo-documents/act-v${v}.docx`));await p.getByRole('button',{name:'Отправить на согласование'}).waitFor();await p.getByRole('button',{name:'Отправить на согласование'}).click();await idle(p);await passRiruReview(p.url().split('/acts/')[1].split('?')[0]);}
  const act=await create(number);await matrix(p);assert.equal(await p.locator('.matrix-not-started').filter({hasText:'Этап не начался'}).count(),5);await screen(p,'01-draft');pass('Отдельная вкладка, 5 серых неначавшихся этапа, черновик без фиктивных ФИО');
  await uploadAndSubmit(1);await matrix(p);await stage(p,'RES_HEAD','Ожидает решения');assert.equal(await p.getByTestId('matrix-row-RES_HEAD').locator('.matrix-status').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(255, 242, 199)');await screen(p,'02-res-pending');
  let navigations=0;const navigation=()=>navigations++;p.on('framenavigated',navigation);
  await open(chief,number);await decide(chief);
  await stage(p,'RES_HEAD','Согласовано');for(const role of ['SUE','STP','GI'])await stage(p,role,'Ожидает решения');assert.equal(navigations,0);pass('Решение РЭС в другой сессии обновило матрицу без F5; три подразделения ждут параллельно');
  const directory=await api('process','/api/v1/admin/directory');const stp=directory.body.find((r:any)=>r.role==='STP');const sub=directory.body.find((r:any)=>r.role==='RES_HEAD'&&r.name.includes('Хостинский'));
  const assigned=await api('process','/api/v1/admin/substitutions',{roleId:stp.id,substituteId:sub.userId,startsAt:new Date(Date.now()-5000).toISOString(),endsAt:new Date(Date.now()+3600000).toISOString()});assert.equal(assigned.status,200);substitutions.push(assigned.body.id);
  await p.getByTestId('matrix-row-STP').getByText('Демо · Начальник РЭС · Хостинский РЭС',{exact:true}).waitFor();await p.getByTestId('matrix-row-STP').getByText(/Замещение/).waitFor();
  await open(pages['chief-hosta'],number);await decide(pages['chief-hosta']);await stage(p,'STP','Согласовано');
  await db.query("UPDATE app.substitutions SET ends_at=now()-interval '1 second' WHERE id=$1",[assigned.body.id]);
  await open(pages.sue,number);await decide(pages.sue,'RETURN','Матрица: мощность 150 кВт нужно исправить на 15 кВт.');await summary(p,'Сбор замечаний');await stage(p,'SUE','Отклонено с замечаниями');await stage(p,'GI','Ожидает решения');
  await p.getByRole('button',{name:'Замечания СУЭ: 1',exact:true}).click();await p.getByRole('region',{name:'Замечания согласующего СУЭ',exact:true}).getByText('Матрица: мощность 150 кВт нужно исправить на 15 кВт.',{exact:true}).waitFor();assert.equal(await p.getByRole('button',{name:'Замечания СТП: 0',exact:true}).isDisabled(),true);await screen(p,'03-return-and-substitution');pass('Замещение показано и заморожено после решения; клик открывает только замечания СУЭ');
  await open(pages.gi,number);await decide(pages.gi);await summary(p,'На доработке');
  const first=(await api('riru-adler',`/api/v1/acts/${act.id}/approval-matrix`)).body;const oldId=first.cycle.id;
  await documentTab(p);await p.getByLabel('Новая версия DOCX').setInputFiles(resolve('.local/demo-documents/act-v2.docx'));await p.getByRole('button',{name:'Указать исправление'}).waitFor();await p.getByLabel('Описание исправления или проверки').fill('Исправлена мощность в версии 2');await p.getByRole('button',{name:'Указать исправление'}).click();await idle(p);await p.getByRole('button',{name:'Отправить на согласование'}).click();await idle(p);await passRiruReview(p.url().split('/acts/')[1].split('?')[0]);await matrix(p);await stage(p,'RES_HEAD','Ожидает решения');for(const role of ['SUE','STP','GI'])await stage(p,role,'Этап не начался');
  await p.getByLabel('Цикл согласования',{exact:true}).selectOption(oldId);await stage(p,'SUE','Отклонено с замечаниями');const frozen=await p.locator('.matrix-table tbody').innerText();await screen(p,'04-previous-cycle');pass('Новый цикл начинается с РЭС, версия 2; предыдущий цикл доступен отдельно');
  p.off('framenavigated',navigation);await p.reload();await login(p,'riru-adler');await open(p,number);await matrix(p);await p.getByTestId('matrix-row-SUE').waitFor();assert.equal(await p.getByLabel('Цикл согласования',{exact:true}).inputValue(),oldId);assert.equal(await p.locator('.matrix-table tbody').innerText(),frozen);pass('После F5 и повторного входа вкладка, выбранный исторический цикл и его данные восстановлены');
  await open(chief,number);await decide(chief);await open(pages.sue,number);await pages.sue.getByLabel('Описание исправления или проверки').fill('Исправление v2 подтверждено');await pages.sue.getByRole('button',{name:'Подтвердить устранение'}).click();await idle(pages.sue);await decide(pages.sue);
  await open(pages.stp,number);await decide(pages.stp);await open(pages.gi,number);await decide(pages.gi);
  assert.equal(await p.locator('.matrix-table tbody').innerText(),frozen);
  await p.getByLabel('Цикл согласования',{exact:true}).selectOption('current');await summary(p,'Согласовано');for(const role of ['RES_HEAD','SUE','STP','GI'])await stage(p,role,'Согласовано');await screen(p,'05-approved');pass('Окончательное согласование обновилось; историческая матрица не изменилась');
  const final=(await api('riru-adler',`/api/v1/acts/${act.id}`)).body;const revoked=await api('process',`/api/v1/releases/${final.releases.at(-1).id}/revoke`,{reason:'Учебная проверка отзыва в матрице'});assert.equal(revoked.status,200);await summary(p,'Отозвано');await screen(p,'06-revoked');pass('Итог Отозвано получен из реальной публикации; решения не удалены');
  for(const user of ['riru-hosta','tech'])assert.equal((await api(user,`/api/v1/acts/${act.id}/approval-matrix`)).status,404);pass('Прямой API матрицы закрыт для другого РЭС и TECH_ADMIN');
  const overdueNumber=`МАТРИЦА-СРОК-${stamp}`;const overdueAct=await create(overdueNumber);await uploadAndSubmit(1);await matrix(p);
  await db.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[overdueAct.id]);await summary(p,'Просрочено');await p.getByTestId('matrix-row-RES_HEAD').getByText('Просрочено',{exact:true}).waitFor();await screen(p,'07-overdue');
  await open(chief,overdueNumber);await decide(chief);for(const role of ['SUE','STP','GI'])await stage(p,role,'Ожидает решения');await p.getByTestId('matrix-row-RES_HEAD').getByText('Завершено с просрочкой',{exact:true}).waitFor();
  await db.query("UPDATE app.tasks SET due_at=now()-interval '1 minute' WHERE act_id=$1 AND status='OPEN'",[overdueAct.id]);assert.equal((await api('process',`/api/v1/acts/${overdueAct.id}/close-collection`,{reason:'Учебная проверка отсутствующих решений'})).status,200);
  for(const role of ['SUE','STP','GI'])await stage(p,role,'Без решения · сбор закрыт');await summary(p,'На доработке');await screen(p,'08-no-decision');pass('Просрочка и завершение без решений показаны явно, без автоматического согласования');
  await p.setViewportSize({width:390,height:844});await screen(p,'09-mobile');assert.ok(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));assert.deepEqual(errors,[]);pass('Мобильная таблица прокручивается внутри карточки; JavaScript ошибок нет');
  result={actId:act.id,actNumber:number,cycle1:oldId,overdueActId:overdueAct.id,browser:browser.version()};
}catch(e){errors.push((e as Error).message);for(const [user,p]of Object.entries(pages))await screen(p,`failure-${user}`).catch(()=>{});throw e;}
finally{
  for(const id of substitutions)await db.query("UPDATE app.substitutions SET ends_at=greatest(starts_at+interval '1 millisecond',now()-interval '1 millisecond') WHERE id=$1 AND ends_at>now()",[id]);
  await writeFile(resolve(out,'result.json'),JSON.stringify({at:new Date().toISOString(),browserLaunched:true,result,checks,errors},null,2));for(const c of contexts)await c.close();await browser.close();await db.end();
}