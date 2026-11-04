import {useState} from 'react';

export type LocalSession={mode:'local';authenticated:boolean;csrfToken?:string;mustChangePassword?:boolean};
export async function authRequest(path:string,body:object,csrfToken?:string):Promise<LocalSession>{
  const response=await fetch(path,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json',...(csrfToken?{'X-CSRF-Token':csrfToken}:{})},body:JSON.stringify(body)});
  const data=await response.json();
  if(!response.ok)throw new Error(data.error?.message??'Не удалось выполнить запрос.');
  return data;
}

export function PasswordForm({session,onSession,onCancel}:{session:LocalSession;onSession:(s:LocalSession)=>void;onCancel?:()=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  return <section className="card login-card"><h2>{session.mustChangePassword?'Задайте свой пароль':'Сменить пароль'}</h2>
    {session.mustChangePassword&&<p>Замените временный пароль перед началом работы.</p>}
    {error&&<p role="alert" className="error">{error}</p>}
    <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);if(data.get('newPassword')!==data.get('repeatPassword')){setError('Новые пароли не совпадают.');return;}setBusy(true);setError('');try{onSession(await authRequest('/auth/password',{currentPassword:data.get('currentPassword'),newPassword:data.get('newPassword')},session.csrfToken));form.reset();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label>{session.mustChangePassword?'Временный пароль':'Текущий пароль'}<input name="currentPassword" type="password" autoComplete="current-password" required maxLength={128}/></label>
      <label>Новый пароль<input name="newPassword" type="password" autoComplete="new-password" required minLength={4} maxLength={128}/></label>
      <label>Повторите новый пароль<input name="repeatPassword" type="password" autoComplete="new-password" required minLength={4} maxLength={128}/></label>
      <small>Не менее 4 символов.</small><button disabled={busy}>{busy?'Сохранение…':'Сохранить пароль'}</button>
      {onCancel&&<button type="button" className="text-button" onClick={onCancel}>Отмена</button>}
    </form></section>;
}

export default function LocalLogin({session,onSession}:{session?:LocalSession;onSession:(s:LocalSession)=>void}){
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  if(session?.authenticated&&session.mustChangePassword)return <PasswordForm session={session} onSession={onSession}/>;
  return <section className="card login-card"><h2>Вход в ТП Согласование</h2><p>Введите данные, выданные администратором.</p>
    {error&&<p role="alert" className="error">{error}</p>}
    <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);setBusy(true);setError('');try{const result=await authRequest('/auth/login',{login:data.get('login'),password:data.get('password')});form.reset();onSession(result);}catch(e){setError((e as Error).message);}finally{setBusy(false);}}}>
      <label>Логин<input name="login" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={64}/></label>
      <label>Пароль<input name="password" type="password" autoComplete="current-password" required maxLength={128}/></label>
      <button disabled={busy}>{busy?'Вход…':'Войти'}</button>
    </form><small>Если забыли пароль, обратитесь к администратору.</small></section>;
}
