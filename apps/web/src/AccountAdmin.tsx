import {useCallback,useEffect,useState} from 'react';
import './accounts.css';
type Row=Record<string,any>;
const roleNames:Record<string,string>={RIRU_ENGINEER:'Инженер РИРУ',RIRU_HEAD:'Начальник РИРУ',RES_HEAD:'Начальник РЭС',SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОК',TECH_ADMIN:'Технический администратор',PROCESS_ADMIN:'Администратор процесса'};
function Assignment({resUnits}:{resUnits:Row[]}){
  const [role,setRole]=useState('RIRU_ENGINEER');
  const scoped=['RIRU_ENGINEER','RIRU_HEAD','RES_HEAD'].includes(role);
  return <><label>Роль<select name="role" aria-label="Роль" value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {(scoped||role==='PROCESS_ADMIN')&&<label>РЭС<select name="resId" aria-label="РЭС" required={scoped} defaultValue=""><option value="">{scoped?'Выберите РЭС':'Все РЭС'}</option>{resUnits.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}</>;
}
export default function AccountAdmin({api,resUnits,currentUserId}:{api:(p:string,b?:object)=>Promise<any>;resUnits:Row[];currentUserId:string}){
  const [users,setUsers]=useState<Row[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false);
  const [editing,setEditing]=useState<{id:string;kind:'password'|'role'}>();
  const load=useCallback(async()=>setUsers(await api('/api/v1/admin/local-users')),[api]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  const run=async(fn:()=>Promise<unknown>,message:string)=>{if(busy)return;setBusy(true);setError('');setNotice('');try{await fn();await load();setNotice(message);setEditing(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
  const assignment=(data:FormData)=>({role:data.get('role'),resId:data.get('resId')||null});
  return <section className="accounts"><p>Создайте отдельную учётную запись для каждого сотрудника и назначьте его роль.</p>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="account-notice">{notice}</p>}
    <section className="card"><h2>Добавить сотрудника</h2><form className="account-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);void run(async()=>{await api('/api/v1/admin/local-users',{name:data.get('name'),login:data.get('login'),password:data.get('password'),assignment:assignment(data)});form.reset();},'Сотрудник добавлен. Передайте ему логин и временный пароль. При первом входе он задаст свой пароль.');}}>
      <label>ФИО<input name="name" required maxLength={200} autoComplete="off"/></label>
      <label>Логин<input name="login" aria-label="Логин" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" minLength={3} maxLength={64} autoCapitalize="none" autoComplete="off"/><small>Латиница, цифры, точка, дефис или подчёркивание.</small></label>
      <label>Временный пароль<input name="password" aria-label="Временный пароль" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/><small>Не менее 12 символов.</small></label>
      <Assignment resUnits={resUnits}/><button disabled={busy}>Создать пользователя</button>
    </form></section>
    <section className="card"><h2>Пользователи ({users.length})</h2><div className="account-list">{users.map(user=><article className="account-row" key={user.id}>
      <div><strong>{user.name}</strong><p>{user.login} · {user.active?'Доступ открыт':'Доступ закрыт'}{user.mustChangePassword?' · Требуется смена пароля':''}</p>
        <ul>{user.roles.map((r:Row,i:number)=><li key={i}>{roleNames[r.role]??r.role}{r.resId?' · '+(resUnits.find(unit=>unit.id===r.resId)?.name??'РЭС'):''}</li>)}</ul></div>
      <div className="account-actions"><button disabled={busy} onClick={()=>setEditing({id:user.id,kind:'role'})}>Добавить роль</button>
        {user.id!==currentUserId&&<><button disabled={busy} onClick={()=>setEditing({id:user.id,kind:'password'})}>Сбросить пароль</button><button disabled={busy} onClick={()=>void run(()=>api('/api/v1/admin/local-users/'+user.id+'/access',{active:!user.active}),user.active?'Доступ закрыт, все сеансы сотрудника завершены.':'Доступ открыт.')}>{user.active?'Закрыть доступ':'Открыть доступ'}</button></>}</div>
      {editing&&editing.id===user.id&&<form className="account-form account-edit" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(()=>api('/api/v1/admin/local-users/'+user.id+(editing.kind==='password'?'/access':'/roles'),editing.kind==='password'?{password:data.get('password')}:assignment(data)),editing.kind==='password'?'Временный пароль установлен. Старые сеансы завершены.':'Роль назначена. Сотруднику нужно обновить страницу.');}}>
        {editing.kind==='password'?<label>Новый временный пароль<input name="password" aria-label="Временный пароль" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>:<Assignment resUnits={resUnits}/>}
        <button disabled={busy}>Сохранить</button><button type="button" className="text-button" onClick={()=>setEditing(undefined)}>Отмена</button>
      </form>}
    </article>)}</div></section></section>;
}
