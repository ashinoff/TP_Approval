import type {ReactNode} from 'react';
const symbols:Record<string,ReactNode>={
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
  branch:<><path d="M5 12h5m0 0V5h9m-9 7h9m-9 0v7h9"/><circle cx="4" cy="12" r="1"/></>,logout:<><path d="M9 3H3v18h6M9 12h12m-5-5 5 5-5 5"/></>,
};
export function Icon({name,size=18}:{name:string;size?:number}){return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{symbols[name]??symbols.file}</svg>;}
export const roleNames:Record<string,string>={RIRU:'РИРУ',RIRU_HEAD:'Начальник РИРУ',RES_HEAD:'Начальник РЭС',SUE:'СУЭ',STP:'СТП',GI:'ГИ',PROCESS_ADMIN:'Администратор процесса',TECH_ADMIN:'Технический администратор',PARALLEL:'СУЭ / СТП / ГИ',COMPLETED:'Завершено'};
export const statusNames:Record<string,string>={DRAFT:'Черновик',IN_REVIEW:'На согласовании',REWORK:'На доработке',APPROVED:'Согласовано',OVERDUE:'Просрочено',REVOKED:'Отозвано'};
export const dateTime=(value:string|null|undefined)=>value?new Date(value).toLocaleString('ru-RU',{timeZone:'Europe/Moscow'}):'—';
export const shortDate=(value:string)=>new Date(value).toLocaleDateString('ru-RU',{timeZone:'Europe/Moscow'});
export function StatusBadge({status}:{status:string}){return <span className={`status-badge badge-${status.toLowerCase()}`}><Icon name={status==='APPROVED'?'check':status==='REWORK'?'return':status==='OVERDUE'?'alert':status==='REVOKED'?'x':status==='DRAFT'?'file':'clock'} size={14}/>{statusNames[status]??status}</span>;}
export function IconButton({icon,label,onClick,disabled=false,reason}:{icon:string;label:string;onClick:()=>void;disabled?:boolean;reason?:string}){
  const tooltip=disabled&&reason?`${label}: ${reason}`:label;
  return <span className="icon-action" title={tooltip} tabIndex={disabled?0:undefined} aria-label={disabled?tooltip:undefined}><button type="button" className={`icon-button icon-${icon}`} aria-label={label} disabled={disabled} onClick={onClick}><Icon name={icon}/></button><span className="action-tooltip" role="tooltip">{tooltip}</span></span>;
}
