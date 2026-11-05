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
    await form.getByLabel('Email',{exact:true}).fill('browser.engineer@example.test');
    await form.getByLabel('Временный пароль',{exact:true}).fill(options.initialPassword);
    await form.getByLabel('РЭС',{exact:true}).selectOption({index:1});
    await form.getByRole('button',{name:'Создать пользователя',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Сотрудник добавлен'}).waitFor();
    await page.screenshot({path:options.output+'/users.png',fullPage:true});
    pass('Admin creates an employee with email, a real stored password and RES assignment');
    // Сервисное меню администратора: состояние базы и проверки, резервная копия.
    await page.getByRole('button',{name:'Сервис',exact:true}).click();
    const service=page.getByRole('region',{name:'Сервисное меню'});await service.getByText('Проверки',{exact:true}).waitFor();await service.getByText('Антивирус',{exact:true}).waitFor();
    await service.getByRole('button',{name:'Резервные копии'}).click();await service.getByRole('button',{name:'Создать копию'}).click();
    await service.getByRole('status').filter({hasText:'Копия создана'}).waitFor({timeout:20000});await service.getByRole('cell',{name:/^backup-/}).first().waitFor();
    await service.getByRole('button',{name:'Состояние'}).click();await service.getByText('Проверки',{exact:true}).waitFor();await page.waitForTimeout(300);
    await page.screenshot({path:options.output+'/service.png',fullPage:true});
    await page.getByRole('button',{name:'Пользователи',exact:true}).click();
    pass('Admin service menu shows database health and creates a backup');

    await form.getByLabel('ФИО',{exact:true}).fill('Учебный второй сотрудник');await form.getByLabel('Логин',{exact:true}).fill('browser.other');
    await form.getByLabel('Email',{exact:true}).fill('BROWSER.ENGINEER@example.test');
    await form.getByLabel('Временный пароль',{exact:true}).fill(options.initialPassword);await form.getByLabel('РЭС',{exact:true}).selectOption({index:1});
    await form.getByRole('button',{name:'Создать пользователя',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Этот email уже указан'}).waitFor();
    await form.getByLabel('Email',{exact:true}).fill('browser.other@example.test');await form.getByRole('button',{name:'Создать пользователя',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Сотрудник добавлен'}).waitFor();
    let row=page.getByRole('article',{name:'Учётная запись browser.engineer',exact:true});
    await row.getByRole('button',{name:'Изменить',exact:true}).click();
    let edit=row.getByRole('form',{name:'Редактирование учётной записи'});
    await edit.getByLabel('ФИО',{exact:true}).fill('Учебное новое имя');await edit.getByLabel('Логин',{exact:true}).fill('browser.engineer.new');
    await edit.getByLabel('Email',{exact:true}).fill('Updated.Engineer@Example.Test');await edit.getByLabel('РЭС 1',{exact:true}).selectOption({index:2});
    await edit.getByRole('button',{name:'Добавить роль',exact:true}).click();await edit.getByLabel('Роль 2',{exact:true}).selectOption('SUE');
    await edit.getByRole('button',{name:'Сохранить изменения',exact:true}).click();await page.getByRole('status').filter({hasText:'Учётная запись обновлена'}).waitFor();
    await page.reload();row=page.getByRole('article',{name:'Учётная запись browser.engineer.new',exact:true});
    await row.getByText('updated.engineer@example.test',{exact:true}).waitFor();await row.getByText('Учебное новое имя',{exact:true}).waitFor();await row.getByText('СУЭ',{exact:true}).waitFor();
    await row.getByRole('button',{name:'Изменить',exact:true}).click();edit=row.getByRole('form',{name:'Редактирование учётной записи'});
    // The list is sorted by role code: the additional SUE assignment is second.
    assert.equal(await edit.getByLabel('Роль 1',{exact:true}).inputValue(),'RIRU_ENGINEER');assert.equal(await edit.getByLabel('Роль 2',{exact:true}).inputValue(),'SUE');
    await edit.getByRole('button',{name:'Убрать роль 2',exact:true}).click();
    await edit.getByLabel('Email',{exact:true}).fill('browser.other@example.test');await edit.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.getByRole('alert').filter({hasText:'Этот email уже указан'}).waitFor();
    await edit.getByLabel('Email',{exact:true}).fill('updated.engineer@example.test');await edit.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Учётная запись обновлена'}).waitFor();assert.equal(await row.getByText('СУЭ',{exact:true}).count(),0);
    pass('Duplicate email is explained; name/login/email/RES and additional roles can be edited and persist after F5');
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    await login('browser.engineer.new',options.initialPassword);await change(options.initialPassword);
    await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:'Пользователи',exact:true}).count(),0);
    await page.reload();await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    await options.restart();await page.reload();await page.getByRole('heading',{name:'Загрузка документа',exact:true}).waitFor();
    pass('Employee opens the existing workspace; sessions and account survive service restart');
    await page.setViewportSize({width:390,height:844});
    // На ошибке перечисляем элементы, выходящие за ширину экрана, чтобы сразу было видно виновника.
    const overflow=await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth?[]:[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>`${e.tagName.toLowerCase()}.${(e as HTMLElement).className} → ${Math.round(e.getBoundingClientRect().right)}px`));
    assert.deepEqual(overflow,[],'Mobile overflow');
    await page.screenshot({path:options.output+'/mobile.png',fullPage:true});
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.reload();
    await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    pass('Mobile employee layout and logout revocation');

    await login('admin',password);await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();
    row=page.getByRole('article',{name:'Учётная запись browser.engineer.new',exact:true});
    await row.getByRole('button',{name:'Изменить',exact:true}).click();
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
    await page.screenshot({path:options.output+'/account-edit-mobile.png',fullPage:true});
    await row.getByRole('button',{name:'Отмена',exact:true}).click();
    page.once('dialog',dialog=>dialog.dismiss());await row.getByRole('button',{name:'Удалить',exact:true}).click();
    assert.equal(await row.count(),1);
    page.once('dialog',dialog=>dialog.accept());await row.getByRole('button',{name:'Удалить',exact:true}).click();
    await page.getByRole('status').filter({hasText:'Учётная запись удалена'}).waitFor();assert.equal(await row.count(),0);
    await options.restart();await page.reload();await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();assert.equal(await row.count(),0);
    assert.equal(await page.getByRole('article',{name:'Учётная запись admin',exact:true}).getByRole('button',{name:'Удалить',exact:true}).count(),0);
    await page.screenshot({path:options.output+'/accounts-after-delete.png',fullPage:true});
    await page.getByRole('button',{name:'Выйти',exact:true}).click();await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();
    await login('browser.engineer.new',password);await page.getByRole('alert').filter({hasText:'Неверный логин или пароль'}).waitFor();
    pass('Mobile account editor, deletion confirmation/cancel, persistent removal and revoked login');
    await login('admin',password);await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();
    const own=page.getByRole('article',{name:'Учётная запись admin',exact:true});await own.getByRole('button',{name:'Изменить',exact:true}).click();
    const ownEdit=own.getByRole('form',{name:'Редактирование учётной записи'});
    await ownEdit.getByLabel('Email',{exact:true}).fill('browser.admin@example.test');await ownEdit.getByLabel('ФИО',{exact:true}).fill('Учебный администратор');
    await ownEdit.getByRole('button',{name:'Сохранить изменения',exact:true}).click();
    await page.getByRole('heading',{name:'Вход в ТП Согласование'}).waitFor();await login('admin',password);
    await page.getByRole('heading',{name:'Добавить сотрудника'}).waitFor();await own.getByText('browser.admin@example.test',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);pass('Administrator can fill their own email and sign back in after session revocation without browser errors');
    await writeFile(options.output+'/result.json',JSON.stringify({browser:browser.version(),checks,errors},null,2));
  }catch(error){await page.screenshot({path:options.output+'/failure.png',fullPage:true});await writeFile(options.output+'/result.json',JSON.stringify({checks,errors,failure:String(error)},null,2));throw error;}
  finally{await browser.close();}
}
