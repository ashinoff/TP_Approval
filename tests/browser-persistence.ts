import {openAct} from './workplace.ui.js';
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
// Run after stopping and restarting `npm run demo` against the same isolated cluster.
const previous=JSON.parse(await readFile('.local/browser-report/result.json','utf8'));
assert.equal(previous.summary.state,'APPROVED');
const browser=await chromium.launch({headless:true,executablePath:process.env.TP_BROWSER_EXECUTABLE??(process.platform==='win32'?'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe':undefined)});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  await page.goto('http://127.0.0.1:5173');await page.getByLabel('Демонстрационный пользователь').selectOption('riru-adler');await page.getByRole('button',{name:'Войти в тестовый стенд'}).click();
  await openAct(page,previous.summary.actNumber);
  await page.locator('.act-detail .status').filter({hasText:'Согласовано'}).waitFor();await page.locator('.comment.resolved').waitFor();
  const response=await fetch('http://127.0.0.1:4100/token',{method:'POST',headers:{Origin:'http://127.0.0.1:5173','Content-Type':'application/json'},body:JSON.stringify({subject:'riru-adler'})});const {token}=await response.json();
  const act=await (await fetch(`http://127.0.0.1:3000/api/v1/acts/${previous.summary.actId}`,{headers:{Authorization:`Bearer ${token}`}})).json();
  assert.equal(act.state,'APPROVED');assert.equal(act.versions.length,2);assert.equal(act.cycles.length,2);assert.equal(act.tasks.filter((t:any)=>t.decision).length,10);assert.equal(act.comments[0].events.length,2);
  await page.screenshot({path:resolve('.local/browser-report/10-after-service-restart.png'),fullPage:true});
  await writeFile('.local/browser-report/restart-result.json',JSON.stringify({at:new Date().toISOString(),browser:browser.version(),actId:act.id,passed:true,state:act.state,versions:2,cycles:2,decisions:10,commentEvents:2},null,2));
  console.log('PASS: после перезапуска PostgreSQL, API, JWT-сервиса и frontend в новом браузере сохранены APPROVED, 2 версии, 2 цикла, 10 решений и 2 события замечания');
}finally{await browser.close();}