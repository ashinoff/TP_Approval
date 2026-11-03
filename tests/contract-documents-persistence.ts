// Run after stopping and starting the synthetic demo, following the browser suite.
import {chromium} from 'playwright';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import './workplace.ui.js';
const report=JSON.parse(await readFile('.local/contract-documents-report/result.json','utf8'));
assert.equal(report.checks.length,7);assert.ok(report.technicalConditionsId);
const origin='http://127.0.0.1:5173';const auth=await fetch('http://127.0.0.1:4100/token',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify({subject:'sue'})});const token=(await auth.json()).token;
const api=async(path:string)=>{const r=await fetch('http://127.0.0.1:3000'+path,{headers:{Authorization:'Bearer '+token}});assert.equal(r.status,200);return r.json();};
const d=await api('/api/v1/acts/'+report.actId);assert.equal(d.state,'APPROVED');assert.equal(d.act_type,'AVTU');assert.equal(d.cycles[0].technical_conditions_id,report.technicalConditionsId);assert.equal(d.releases[0].version_id,d.versions[0].id);
const preview=await api(`/api/v1/acts/${d.id}/technical-conditions/${report.technicalConditionsId}/preview`);assert.equal(preview.sha256,report.technicalConditionsHash);
const browser=await chromium.launch({headless:true,executablePath:process.env.TP_BROWSER_EXECUTABLE??'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
try{const p=await browser.newPage();await p.goto(origin+`/#/acts/${d.id}?section=approved`);await p.getByLabel('Демонстрационный пользователь').selectOption('sue');await p.getByRole('button',{name:'Войти в тестовый стенд'}).click();await p.getByRole('heading',{name:'АВТУ '+d.act_number,exact:true}).waitFor();const folder=p.locator('details.contract-documents');await folder.locator('summary').click();await folder.getByRole('button',{name:'Открыть ТУ',exact:true}).click();await p.getByRole('region',{name:'Просмотр технических условий'}).frameLocator('iframe').locator('table').first().waitFor();await p.screenshot({path:'.local/contract-documents-report/after-restart.png',fullPage:true});await writeFile('.local/contract-documents-report/persistence.json',JSON.stringify({actId:d.id,technicalConditionsId:report.technicalConditionsId,hashMatches:true,publicationRetained:true,browserOpened:true},null,2));console.log('PASS: TU, AVTU, cycle binding, publication and source hash survive full local restart; browser preview verified');}finally{await browser.close();}
