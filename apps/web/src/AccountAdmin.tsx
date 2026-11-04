import {useCallback,useEffect,useState} from 'react';
import './accounts.css';

type Row=Record<string,any>;
type RoleValue={role:string;resId:string|null};
const roleNames:Record<string,string>={RIRU_ENGINEER:'Инженер РИРУ',RIRU_HEAD:'Начальник РИРУ',RES_HEAD:'Начальник РЭС',SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОК',TECH_ADMIN:'Технический администратор',PROCESS_ADMIN:'Администратор процесса'};
const isScoped=(role:string)=>['RIRU_ENGINEER','RIRU_HEAD','RES_HEAD'].includes(role);

function Assignment({resUnits}:{resUnits:Row[]}){
  const [role,setRole]=useState('RIRU_ENGINEER');
  const scoped=isScoped(role);
  return <><label>Роль<select name="role" aria-label="Роль" value={role} onChange={e=>setRole(e.target.value)}>{Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label>
    {(scoped||role==='PROCESS_ADMIN')&&<label>РЭС<select name="resId" aria-label="РЭС" required={scoped} defaultValue=""><option value="">{scoped?'Выберите РЭС':'Все РЭС'}</option>{resUnits.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>}</>;
}

function ProfileForm({user,resUnits,busy,onSave,onCancel}:{user:Row;resUnits:Row[];busy:boolean;onSave:(body:object)=>void;onCancel:()=>void}){
  const [roles,setRoles]=useState<RoleValue[]>(()=>user.roles.map((r:RoleValue)=>({role:r.role,resId:r.resId})));
  const update=(index:number,value:RoleValue)=>setRoles(rows=>rows.map((row,i)=>i===index?value:row));
  return <form className="account-edit" aria-label="Редактирование учётной записи" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);
    onSave({name:data.get('name'),position:String(data.get('position')??''),login:data.get('login'),email:data.get('email'),expectedRevision:user.revision,assignments:roles});
  }}>
    <h3>Редактирование учётной записи</h3>
    <fieldset disabled={busy} className="account-fields account-form">
      <label>ФИО<input name="name" required maxLength={200} defaultValue={user.name} autoComplete="off"/></label>
      <label>Должность<input name="position" aria-label="Должность" maxLength={200} defaultValue={user.position??''} placeholder="Например: Начальник РИРУ" autoComplete="off"/></label>
      <label>Логин<input name="login" aria-label="Логин" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" minLength={3} maxLength={64} defaultValue={user.login} autoCapitalize="none" autoComplete="off"/></label>
      <label>Email<input name="email" aria-label="Email" type="email" required maxLength={254} defaultValue={user.email??''} autoCapitalize="none" autoComplete="off"/></label>
    </fieldset>
    <fieldset disabled={busy} className="account-fields account-roles"><legend>Роли и РЭС</legend>
      {roles.map((value,index)=><div className="account-role-editor" key={index}>
        <label>Роль {index+1}<select aria-label={'Роль '+(index+1)} value={value.role} onChange={e=>update(index,{role:e.target.value,resId:isScoped(e.target.value)||e.target.value==='PROCESS_ADMIN'?value.resId:null})}>
          {Object.entries(roleNames).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select></label>
        {(isScoped(value.role)||value.role==='PROCESS_ADMIN')&&<label>РЭС {index+1}<select aria-label={'РЭС '+(index+1)} required={isScoped(value.role)} value={value.resId??''} onChange={e=>update(index,{...value,resId:e.target.value||null})}>
          <option value="">{isScoped(value.role)?'Выберите РЭС':'Все РЭС'}</option>{resUnits.map(r=><option key={r.id} value={r.id}>{r.name}</option>)}
        </select></label>}
        <button type="button" className="text-button" aria-label={'Убрать роль '+(index+1)} onClick={()=>setRoles(rows=>rows.filter((_,i)=>i!==index))}>Убрать роль</button>
      </div>)}
      {!roles.length&&<p>Роли не назначены. Доступ к рабочим разделам будет закрыт.</p>}
      <button type="button" disabled={roles.length>=32} onClick={()=>setRoles(rows=>[...rows,{role:'RIRU_ENGINEER',resId:null}])}>Добавить роль</button>
    </fieldset>
    <p className="account-hint">Изменение логина, email или ролей завершит сеансы сотрудника. Роль с незавершёнными задачами или замещениями снять нельзя.</p>
    <div className="account-actions"><button disabled={busy}>Сохранить изменения</button><button disabled={busy} type="button" className="text-button" onClick={onCancel}>Отмена</button></div>
  </form>;
}

export default function AccountAdmin({api,resUnits,currentUserId,onUpdated}:{api:(p:string,b?:object)=>Promise<any>;resUnits:Row[];currentUserId:string;onUpdated?:()=>Promise<void>}){
  const [users,setUsers]=useState<Row[]>([]),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false);
  const [editing,setEditing]=useState<{user:Row;kind:'password'|'profile'}>();
  const load=useCallback(async()=>{setUsers(await api('/api/v1/admin/local-users'));setLoaded(true);},[api]);
  useEffect(()=>{void load().catch(e=>setError(e.message));},[load]);
  const run=async(fn:()=>Promise<unknown>,message:string)=>{
    if(busy)return;setBusy(true);setError('');setNotice('');
    try{await fn();await load();await onUpdated?.();setNotice(message);setEditing(undefined);}catch(e){setError((e as Error).message);}finally{setBusy(false);}
  };
  const assignment=(data:FormData)=>({role:data.get('role'),resId:data.get('resId')||null});
  return <section className="accounts"><p>Создайте отдельную учётную запись для каждого сотрудника. Указывайте тот же email, который используется в Keycloak.</p>
    {error&&<p className="error" role="alert">{error}</p>}{notice&&<p role="status" className="account-notice">{notice}</p>}
    <section className="card"><h2>Добавить сотрудника</h2><form onSubmit={e=>{
      e.preventDefault();const form=e.currentTarget;const data=new FormData(form);
      void run(async()=>{await api('/api/v1/admin/local-users',{name:data.get('name'),position:String(data.get('position')??''),login:data.get('login'),email:data.get('email'),password:data.get('password'),assignment:assignment(data)});form.reset();},'Сотрудник добавлен. Передайте ему логин и временный пароль. При первом входе он задаст свой пароль.');
    }}><fieldset className="account-fields account-form" disabled={busy||!loaded}>
      <label>ФИО<input name="name" required maxLength={200} autoComplete="off"/></label>
      <label>Должность<input name="position" aria-label="Должность" maxLength={200} placeholder="Например: Инженер РИРУ" autoComplete="off"/></label>
      <label>Логин<input name="login" aria-label="Логин" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{2,63}" minLength={3} maxLength={64} autoCapitalize="none" autoComplete="off"/><small>Латиница, цифры, точка, дефис или подчёркивание.</small></label>
      <label>Email<input name="email" aria-label="Email" type="email" required maxLength={254} autoCapitalize="none" autoComplete="off"/><small>Адрес почты сотрудника в Keycloak.</small></label>
      <label>Временный пароль<input name="password" aria-label="Временный пароль" type="password" required minLength={4} maxLength={128} autoComplete="new-password"/><small>Не менее 12 символов.</small></label>
      <Assignment resUnits={resUnits}/><button>Создать пользователя</button>
    </fieldset></form></section>
    <section className="card"><div className="account-list-heading"><h2>Пользователи ({users.length})</h2><button disabled={busy} onClick={()=>{setError('');setEditing(undefined);void load().catch(e=>setError(e.message));}}>Обновить список</button></div>
      <div className="account-list">{users.map(user=><article className="account-row" key={user.id} aria-label={'Учётная запись '+user.login}>
        <div className="account-summary"><strong>{user.name}</strong>{user.position&&<span className="account-position">{user.position}</span>}<p>{user.login} · {user.active?'Доступ открыт':'Доступ закрыт'}{user.mustChangePassword?' · Требуется смена пароля':''}</p>
          <p className={user.email?'account-email':'account-missing-email'}>{user.email??'Email не указан — заполните в учётной записи'}</p>
          <ul>{user.roles.map((r:Row,i:number)=><li key={i}>{roleNames[r.role]??r.role}{r.resId?' · '+(resUnits.find(unit=>unit.id===r.resId)?.name??'РЭС'):''}</li>)}</ul>
        </div>
        <div className="account-actions"><button disabled={busy} onClick={()=>{setError('');setEditing({user,kind:'profile'});}}>Изменить</button>
          {user.id!==currentUserId&&<><button disabled={busy} onClick={()=>setEditing({user,kind:'password'})}>Сбросить пароль</button>
            <button disabled={busy} onClick={()=>void run(()=>api('/api/v1/admin/local-users/'+user.id+'/access',{active:!user.active}),user.active?'Доступ закрыт, все сеансы сотрудника завершены.':'Доступ открыт.')}>{user.active?'Закрыть доступ':'Открыть доступ'}</button>
            <button className="account-danger" disabled={busy} onClick={()=>{if(confirm('Удалить учётную запись «'+user.name+'»? Вход будет закрыт, история действий в документах сохранится.'))void run(()=>api('/api/v1/admin/local-users/'+user.id+'/delete',{expectedRevision:user.revision}),'Учётная запись удалена. История действий сохранена.');}}>Удалить</button></>}
        </div>
        {editing&&editing.user.id===user.id&&(editing.kind==='profile'?<ProfileForm key={user.id+':'+editing.user.revision} user={editing.user} resUnits={resUnits} busy={busy} onCancel={()=>setEditing(undefined)} onSave={body=>void run(()=>api('/api/v1/admin/local-users/'+user.id+'/profile',body),'Учётная запись обновлена.')}/>
          :<form className="account-form account-edit" onSubmit={e=>{e.preventDefault();const data=new FormData(e.currentTarget);void run(()=>api('/api/v1/admin/local-users/'+user.id+'/access',{password:data.get('password')}),'Временный пароль установлен. Старые сеансы завершены.');}}>
            <label>Новый временный пароль<input name="password" aria-label="Временный пароль" type="password" required minLength={4} maxLength={128} autoComplete="new-password"/></label>
            <button disabled={busy}>Сохранить</button><button disabled={busy} type="button" className="text-button" onClick={()=>setEditing(undefined)}>Отмена</button>
          </form>)}
      </article>)}</div>
    </section>
  </section>;
}
