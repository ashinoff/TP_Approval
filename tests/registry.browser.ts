import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const origin='http://127.0.0.1:5173';
const fixture=JSON.parse(await readFile('.local/browser-report/result.json','utf8')).summary;
const out=resolve('.local/registry-report');await mkdir(out,{recursive:true});
const browser=await chromium.launch({headless:true,executablePath:process.env.TP_BROWSER_EXECUTABLE??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const checks:string[]=[],errors:string[]=[];const pass=(s:string)=>{checks.push(s);console.log(`REGISTRY BROWSER OK ${checks.length}: ${s}`);};
const context=await browser.newContext({viewport:{width:1500,height:1000},locale:'ru-RU',timezoneId:'Europe/Moscow',acceptDownloads:true});
const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
async function login(user:string){await page.goto(origin);await page.getByLabel('Демонстрационный пользователь').selectOption(user);await page.getByRole('button',{name:'Войти в тестовый стенд'}).click();await page.getByRole('button',{name:'Выйти',exact:true}).waitFor();}
async function search(q:string){if(await page.getByLabel('Поиск документов').inputValue()===q){await page.getByTestId(`registry-row-${fixture.actId}`).waitFor();return;}const response=page.waitForResponse(r=>r.url().includes('/api/v1/registry?')&&new URL(r.url()).searchParams.get('q')===q);await page.getByLabel('Поиск документов').fill(q);assert.equal((await response).status(),200);await page.getByTestId(`registry-row-${fixture.actId}`).waitFor();}
const row=()=>page.getByTestId(`registry-row-${fixture.actId}`);
try{
 await login('riru-adler');await search(fixture.actNumber);
 assert.equal(await row().getByTestId('registry-route').locator('[data-stage]').count(),6);
 assert.equal(await row().locator('.flow-completed').count(),6);assert.equal(await row().locator('.flow-parallel [data-stage]').count(),3);
 assert.equal(await row().locator('.row-actions button svg').count(),8);assert.equal(await row().getByRole('button',{name:'Согласовать акт',exact:true}).isDisabled(),true);
 await page.screenshot({path:resolve(out,'01-registry-desktop.png'),fullPage:true});pass('Реальный утверждённый акт: шесть завершённых этапов, параллельная группа, восемь SVG-действий и запрет самосогласования');
 for(const [index,value] of [[1,'APPROVED'],[2,'COMPLETED'],[3,'with']] as const){await Promise.all([page.waitForResponse(r=>r.url().includes('/api/v1/registry?')).then(r=>assert.equal(r.status(),200)),page.locator('.filter-grid select').nth(index).selectOption(value)]);await row().waitFor();}
 const response=page.waitForResponse(r=>r.url().includes('/api/v1/registry?'));await page.getByLabel('Мои документы',{exact:true}).check();await response;await row().waitFor();pass('Поиск и совмещённые фильтры статуса, этапа, замечаний и автора сохраняют фактический акт');
 await row().getByRole('button',{name:'История акта',exact:true}).click();await page.getByRole('tab',{name:'История',exact:true}).waitFor();await page.locator('#act-history-panel .timeline-event[data-event-type="APPROVED"]').waitFor();
 assert.equal(await page.getByTestId('card-route').locator('.flow-completed').count(),6);
 assert.equal(await page.locator('#act-history-panel .timeline-event[data-event-type="DECISION"]').count(),8);
 assert.equal(await page.locator('#act-history-panel .timeline-event[data-event-type="SUBMITTED"]').count(),2);
 await page.screenshot({path:resolve(out,'02-history.png'),fullPage:true});pass('История показывает два цикла, восемь решений и публикацию; подробный маршрут соответствует утверждённой версии');
 await page.locator('#act-history-panel .timeline-event[data-event-type="COMMENT_ADDED"]').getByRole('button',{name:'Открыть замечание'}).click();await page.locator('.comment.resolved').waitFor();
 await page.getByRole('tab',{name:'Матрица согласования',exact:true}).click();await page.getByTestId('matrix-row-SUE').getByText('Согласовано',{exact:true}).waitFor();pass('Ссылка timeline открывает замечание, существующая матрица доступна в той же карточке');
 await page.getByRole('button',{name:'Реестр актов',exact:true}).click();await search(fixture.actNumber);
 const download=page.waitForEvent('download');await row().getByRole('button',{name:'Скачать Word',exact:true}).click();assert.ok((await download).suggestedFilename().endsWith('.docx'));pass('Действие строки скачивает настоящий DOCX');
 assert.equal(await row().getByRole('button',{name:'Печать DOCX',exact:true}).isDisabled(),true);pass('Печать DOCX недоступна до проверки надёжного генератора; карточка не выдаётся за Word');
 await page.getByRole('button',{name:'Реестр актов',exact:true}).click();await page.setViewportSize({width:390,height:844});await search(fixture.actNumber);await page.screenshot({path:resolve(out,'03-mobile-registry.png'),fullPage:true});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await row().getByRole('button',{name:'Открыть карточку',exact:true}).click();await page.getByTestId('card-route').waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));pass('Реестр и карточка адаптированы к viewport 390×844 без переполнения страницы');
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('chief-hosta');await page.getByLabel('Поиск документов').fill(fixture.actNumber);await page.getByText('Документы не найдены',{exact:true}).waitFor();pass('Пользователь другого РЭС не видит акт через поиск');
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('riru-adler');await page.getByRole('button',{name:'Сбросить фильтры',exact:true}).click();
 const number=`UI-РЕЕСТР-${Date.now()}`;await page.getByRole('button',{name:'Создать акт',exact:true}).click();
 for(const [label,value] of [['Номер договора',number],['Дата договора','2026-10-31'],['Номер акта',number],['Заявитель','Учебная проверка действий'],['Адрес объекта','Условный адрес']])await page.getByLabel(label,{exact:true}).fill(value);
 await page.getByRole('button',{name:'Создать карточку'}).click();await page.getByRole('heading',{name:`Акт ${number}`,exact:true}).waitFor();await page.getByLabel('Новая версия DOCX').setInputFiles(resolve('.local/demo-documents/act-v1.docx'));await page.getByRole('button',{name:'Направить Начальнику РЭС'}).click();await page.getByTestId('act-current-stage').getByText('Начальник РЭС',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('chief-adler');await page.getByLabel('Поиск документов').fill(number);const createdRow=page.getByRole('row').filter({has:page.getByText(number,{exact:true})});await createdRow.getByRole('button',{name:'Согласовать акт',exact:true}).click();await page.getByRole('dialog').getByRole('button',{name:'Подтвердить согласование'}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await createdRow.locator('[data-stage="SUE"].flow-active').waitFor();pass('Решение из SVG-кнопки строки сохраняется на сервере и открывает параллельный этап');
 await page.getByRole('button',{name:'Выйти',exact:true}).click();await login('sue');await page.getByLabel('Поиск документов').fill(number);await createdRow.getByRole('button',{name:'Вернуть с замечаниями',exact:true}).click();await page.getByRole('dialog').getByLabel('Текст замечания').fill('Учебное замечание из строки реестра');await page.getByRole('button',{name:'Сохранить возврат',exact:true}).click();await page.getByRole('dialog').waitFor({state:'hidden'});await createdRow.locator('[data-stage="SUE"].flow-returned').waitFor();await createdRow.locator('[data-stage="STP"].flow-active').waitFor();pass('Возврат из строки сохраняет замечание; остальные параллельные проверки продолжаются');
 assert.deepEqual(errors,[]);
}catch(e){errors.push((e as Error).message);await page.screenshot({path:resolve(out,'failure.png'),fullPage:true});throw e;}
finally{await writeFile(resolve(out,'result.json'),JSON.stringify({at:new Date().toISOString(),browserLaunched:true,browser:browser.version(),checks,errors},null,2));await browser.close();}
