import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {chromium} from 'playwright';

export async function runStandaloneBrowser(options:{url:string;initialPassword:string;output:string;restart:()=>Promise<void>;executablePath?:string;args?:string[]}){
  if(!['127.0.0.1','localhost'].includes(new URL(options.url).hostname))throw new Error('Browser acceptance is restricted to the isolated loopback fixture');
  await mkdir(options.output,{recursive:true});
  const browser=await chromium.launch({headless:true,executablePath:options.executablePath,args:options.args});
  const context=await browser.newContext({ignoreHTTPSErrors:true,viewport:{width:1440,height:960}});
  const page=await context.newPage(),errors:string[]=[],checks:string[]=[];
  page.on('pageerror',error=>errors.push(error.message));
  const pass=(name:string)=>{checks.push(name);console.log('BROWSER: '+name);};
  const password='Synthetic-browser-personal-456';
  const login=async(name:string,value:string)=>{
    await page.getByLabel('Логин',{exact:true}).fill(name);await page.getByLabel('Пароль',{exact:true}).fill(value);await page.getByRole('button',{name:'Войти',exact:true}).click();
  };
  const change=async(value:string)=>{
    await page.getByLabel('Временный пароль',{exact:true}).fill(value);
    await page.getByLabel('Новый пароль',{exact:true}).fill(password);
    await page.getByLabel('Повторите новый пароль',{exact:true}).fill(password);
    await page.getByRole('button',{name:'Сохранить пароль',exact:true}).click();
  };
  try{
    await page.goto(options.url);await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    await page.screenshot({path:options.output+'/login.png',fullPage:true});
    await login('admin',options.initialPassword);await page.getByRole('heading',{name:'Задайте свой пароль'}).waitFor();await change(options.initialPassword);
    await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();
    await page.reload();await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();
    const cookies=await context.cookies();assert.ok(cookies.some(c=>c.name==='__Host-tp_session'&&c.httpOnly&&c.secure));
    pass('Login, mandatory password change and session recovery after F5 on HTTPS');
    const form=page.locator('form').filter({has:page.getByRole('button',{name:'Создать пользователя',exact:true})});
    await form.getByLabel('ФИО',{exact:true}).fill('Учебный инженер');await form.getByLabel('Логин',{exact:true}).fill('browser.engineer');
    await form.getByLabel('Временный пароль',{exact:true}).fill(options.initialPassword);
    await form.getByLabel('РЭС',{exact:true}).selectOption({index:1});
    await form.getByRole('button',{name:'Создать пользователя',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Сотрудник добавлен'}).waitFor();
    await page.screenshot({path:options.output+'/users.png',fullPage:true});
    pass('Admin creates an employee with a real stored password and RES assignment');
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    await login('browser.engineer',options.initialPassword);await change(options.initialPassword);
    await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Пользователи',exact:true}).count(),0);
    await page.reload();await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    await options.restart();await page.reload();await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    pass('Employee opens the existing workspace; sessions and account survive service restart');
    await page.setViewportSize({width:390,height:844});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:options.output+'/mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.reload();
    await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    assert.deepEqual(errors,[]);pass('Mobile layout, logout revocation and no uncaught browser errors');
    await writeFile(options.output+'/result.json',JSON.stringify({browser:browser.version(),checks,errors},null,2));
  }catch(error){await page.screenshot({path:options.output+'/failure.png',fullPage:true});await writeFile(options.output+'/result.json',JSON.stringify({checks,errors,failure:String(error)},null,2));throw error;}
  finally{await browser.close();}
}
