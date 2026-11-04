import type {ReactNode} from 'react';
import {roleNames} from './Ui.js';
import './accounts.css';
type Row=Record<string,any>;

/** Подпись под ФИО: должность и РЭС (по ролям), например «Начальник РИРУ · Адлерский РЭС». */
export function profileSubtitle(profile:Row,resUnits:Row[]){
 const res=[...new Set((profile.roles??[]).map((r:Row)=>r.resId).filter(Boolean))].map(id=>resUnits.find(u=>u.id===id)?.name).filter(Boolean);
 return [profile.position,res.join(', ')].filter(Boolean).join(' · ');
}

/** Настройки профиля: сведения об учётке и смена пароля; сюда же добавляются будущие личные настройки. */
export default function ProfilePage({profile,resUnits,password,onClose}:{profile:Row;resUnits:Row[];password?:ReactNode;onClose:()=>void}){
 const roles:Row[]=profile.roles??[];
 return <section className="profile-page" aria-label="Профиль">
  <div className="card profile-card">
   <div className="profile-avatar" aria-hidden="true">{profile.name.split(/\s+/).filter(Boolean).slice(0,2).map((w:string)=>w[0]).join('').toUpperCase()}</div>
   <div className="profile-main">
    <h2>{profile.name}</h2>
    <p className="profile-sub">{profile.position??<span className="muted">Должность не указана — её задаёт администратор</span>}</p>
    <dl className="profile-facts">
     <div><dt>Email</dt><dd>{profile.email??'не указан'}</dd></div>
     <div><dt>Роли</dt><dd>{roles.length?roles.map((r,i)=><span className="profile-role" key={i}>{roleNames[r.role]??r.role}{r.resId?` · ${resUnits.find(u=>u.id===r.resId)?.name??'РЭС'}`:''}</span>):'нет ролей'}</dd></div>
    </dl>
   </div>
   <button type="button" className="secondary-button" onClick={onClose}>Закрыть</button>
  </div>
  {password&&<div className="card profile-section"><h3>Смена пароля</h3>{password}</div>}
  <div className="card profile-section profile-soon"><h3>Личные настройки</h3><p className="helper-text">Здесь появятся персональные настройки: уведомления, вид списков и другое.</p></div>
 </section>;
}
