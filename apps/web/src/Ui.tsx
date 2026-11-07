import type {ReactNode} from 'react';
const symbols:Record<string,ReactNode>={
  bell:<><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></>,more:<><circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/></>,
  open:<><path d="M14 3h7v7M21 3l-9 9"/><path d="M10 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5"/></>,
  matrix:<><rect x="3" y="3" width="18" height="18" rx="3"/><path d="M3 9h18M9 3v18M9 15h12"/></>,
  check:<path d="m5 12 4 4L19 6"/>,return:<><path d="m9 4-6 6 6 6"/><path d="M3 10h11a7 7 0 0 1 7 7v3"/></>,
  print:<><path d="M7 8V3h10v5M7 17H3v-7h18v7h-4"/><path d="M7 14h10v7H7zM17 11h.01"/></>,
  download:<><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/></>,
  history:<><path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/></>,
  comment:<><path d="M4 3h16v13H9l-5 5V3Z"/><path d="M8 7h8M8 11h5"/></>,
  search:<><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></>,
  filter:<path d="M3 4h18l-7 8v7l-4 2v-9L3 4Z"/>,plus:<path d="M12 4v16M4 12h16"/>,x:<path d="m6 6 12 12M6 18 18 6"/>,
  clock:<><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,alert:<><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/></>,
  file:<><path d="M14 2H5v20h14V7l-5-5Z"/><path d="M14 2v6h5M8 12h8M8 16h6"/></>,
  arrow:<path d="M4 12h16m-6-6 6 6-6 6"/>,back:<path d="M20 12H4m6-6-6 6 6 6"/>,refresh:<><path d="M20 4v6h-6M4 20v-6h6"/><path d="M5 8a8 8 0 0 1 14-3M19 16A8 8 0 0 1 5 19"/></>,
  view:<><path d="M13 3H6.5A2.5 2.5 0 0 0 4 5.5v13A2.5 2.5 0 0 0 6.5 21H11"/><path d="M13 3l5 5v2.5M13 3v5h5"/><circle cx="16.5" cy="16.5" r="3.5"/><path d="m19 19 2.5 2.5"/></>,
  data:<><ellipse cx="12" cy="5.5" rx="7.5" ry="2.5"/><path d="M4.5 5.5v13c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5v-13"/><path d="M4.5 12c0 1.4 3.4 2.5 7.5 2.5s7.5-1.1 7.5-2.5"/></>,
  grid:<><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M3 9h18M9 3v18"/><path d="m12.5 14.8 1.8 1.8 3.2-3.6"/></>,
  timeline:<><path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3 4v4.5h4.5"/><path d="M12 7.5V12l3 2"/></>,
  printer:<><path d="M7 9V3.5h10V9"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M7 14h10v7H7z"/><path d="M17.5 12h.01"/></>,
  upload:<><path d="M12 16V4m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
  engineer:<><circle cx="9" cy="7" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 10.5-5.1"/><path d="m14.5 20.5.9-3.4 4.6-4.6 2.5 2.5-4.6 4.6z"/></>,
  chief:<><circle cx="9" cy="7" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="m16 10.5 2 2 4-4"/></>,
  building:<><path d="M4 21V6l8-3.5L20 6v15"/><path d="M2 21h20M9.5 21v-5h5v5"/><path d="M8 9h.01M12 9h.01M16 9h.01M8 12.5h.01M12 12.5h.01M16 12.5h.01"/></>,
  meter:<><rect x="3" y="4" width="18" height="16" rx="2.5"/><path d="M7 15a5 5 0 0 1 10 0"/><path d="m12 15 2.6-3.2"/><path d="M8.5 17.5h7"/></>,
  plug:<><path d="M9 2.5v4.5M15 2.5v4.5"/><path d="M6 7h12v3a6 6 0 0 1-12 0z"/><path d="M12 16v5.5"/></>,
  gear:<><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></>,
  newdoc:<><path d="M14 2.5H6.5A2.5 2.5 0 0 0 4 5v14a2.5 2.5 0 0 0 2.5 2.5h11A2.5 2.5 0 0 0 20 19V8.5z"/><path d="M14 2.5v6h6M12 11.5v6M9 14.5h6"/></>,
  folder:<><path d="M3 7.5V18a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V9.5a2 2 0 0 0-2-2h-7L10 5H5a2 2 0 0 0-2 2.5z"/><path d="M3 11h18"/></>,
  inbox:<><path d="M3 13.5 5.5 5h13l2.5 8.5V19a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 19z"/><path d="M3 13.5h5l1.5 2.5h5l1.5-2.5h5"/></>,
  stack:<><path d="m12 3 9 4.5-9 4.5-9-4.5z"/><path d="m3 12 9 4.5 9-4.5M3 16.5 12 21l9-4.5"/></>,
  users:<><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8"/></>,
  calendar:<><rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 2.5v4M16 2.5v4M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 17h2M11 17h2"/></>,
  form:<><rect x="4" y="3" width="16" height="18" rx="2.5"/><path d="M8 7.5h8M8 11.5h8M8 15.5h5"/></>,
  book:<><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v16H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 0 6.5 23H20v-5M8 6.5h8M8 10h5"/></>,
  wrench:<><path d="M14.7 6.3a4.5 4.5 0 0 0 5.6 5.6l-8.6 8.6a2.1 2.1 0 0 1-3-3z"/><path d="M14.7 6.3 17.5 3.5a4.5 4.5 0 0 1 3 3l-2.8 2.8"/></>,
  pencil:<><path d="M4 20h4L19.5 8.5a2.8 2.8 0 0 0-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></>,
  send:<><path d="M21 3 10 14"/><path d="m21 3-7 18-4-7-7-4z"/></>,
  xcircle:<><circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/></>,
  okcircle:<><circle cx="12" cy="12" r="9"/><path d="m8 12.5 2.8 2.8L16.5 9.5"/></>,
  breaker:<><rect x="6" y="2.5" width="12" height="19" rx="2"/><rect x="9.5" y="7" width="5" height="7" rx="1"/><path d="M12 9v3M9 17.5h6"/></>,
  cable:<><path d="M3 18c3 0 3-12 6-12s3 12 6 12 3-12 6-12"/></>,
  phase1:<><path d="M2.5 12c2.4-6.5 4.8-6.5 7.2 0s4.8 6.5 7.2 0"/><path d="M19 9.5v5M21.5 9.5v5"/></>,
  phase3:<><path d="M2 12c1.7-4.5 3.3-4.5 5 0s3.3 4.5 5 0 3.3-4.5 5 0 3.3 4.5 5 0"/><path d="M2 7.5h20M2 16.5h20" opacity=".45"/></>,
  extra:<><path d="M8 3H5.5A2.5 2.5 0 0 0 3 5.5v13A2.5 2.5 0 0 0 5.5 21h8"/><path d="M8 3h7l5 5v6"/><path d="M15 3v5h5M18 17v6M15 20h6"/></>,
  zap:<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>,
  heart:<><path d="M3 12h4l2-5 4 10 2-5h6"/></>,
  branch:<><path d="M5 12h5m0 0V5h9m-9 7h9m-9 0v7h9"/><circle cx="4" cy="12" r="1"/></>,logout:<><path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/></>,
};
export function Icon({name,size=18}:{name:string;size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{symbols[name]??symbols.file}</svg>;}
export const roleNames:Record<string,string>={RIRU:'РИРУ',RIRU_ENGINEER:'Инженер РИРУ',RIRU_HEAD:'Начальник РИРУ',RES_HEAD:'Начальник РЭС',SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОК',SUE_ENGINEER:'Инженер СУЭ',STP_ENGINEER:'Инженер СТП',GI_ENGINEER:'Инженер ТЕХБЛОКА',PROCESS_ADMIN:'Администратор процесса',TECH_ADMIN:'Технический администратор',PARALLEL:'СУЭ / СТП / ТЕХБЛОК',COMPLETED:'Завершено'};
export const statusNames:Record<string,string>={DRAFT:'Черновик',IN_REVIEW:'На согласовании',COLLECTING:'Сбор замечаний',REVISING:'Пересмотр',REWORK:'На доработке',APPROVED:'Согласовано',OVERDUE:'Просрочено',REVOKED:'Отозвано'};
export const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
export const shortDate=(value:string|null)=>value?new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'}):'Не указана';
export function StatusBadge({status}:{status:string}){return <span className={`status-badge badge-${status.toLowerCase()}`}><Icon name={status==='APPROVED'?'check':status==='REWORK'?'return':status==='OVERDUE'?'alert':status==='REVOKED'?'x':status==='DRAFT'?'file':'clock'} size={14}/>{statusNames[status]??status}</span>;}
export function IconButton({icon,label,onClick,disabled=false,reason}:{icon:string;label:string;onClick:()=>void;disabled?:boolean;reason?:string}){
  const tooltip=disabled&&reason?`${label}: ${reason}`:label;
  return <span className="icon-action" title={tooltip} tabIndex={disabled?0:undefined} aria-label={disabled?tooltip:undefined}><button type="button" className={`icon-button icon-${icon}`} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button><span className="action-tooltip" role="tooltip">{tooltip}</span></span>;
}