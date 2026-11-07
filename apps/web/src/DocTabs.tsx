import {Icon} from './Ui.js';

export type Panel='document'|'print'|'details'|'history'|'matrix';
const tabs:[Panel,string,string,string][]=[
 ['document','Просмотр','view','Документ и замечания к нему'],
 ['print','Печать','printer','Лист согласования, замечания и экземпляр к печати'],
 ['details','Данные','data','Реквизиты, карточка документа и загрузка файлов'],
 ['history','История','timeline','Хронология движения документа'],
 ['matrix','Матрица','grid','Матрица согласования по циклам'],
];

/** Разделы рабочего места документа: значок в рамке одного размера, у выбранного светятся контур значка и рамка. */
export default function DocTabs({panel,onPanel,badges={}}:{panel:string;onPanel:(panel:Panel)=>void;badges?:Partial<Record<Panel,number>>}){
 return <div className="doc-tabs" role="group" aria-label="Разделы документа">
  {tabs.map(([key,label,icon,hint])=><button key={key} type="button" className="doc-tab" aria-pressed={panel===key} title={hint} onClick={()=>onPanel(key)}>
   <span className="doc-tab-frame" aria-hidden="true"><Icon name={icon} size={18}/></span>
   <span className="doc-tab-label">{label}</span>
   {!!badges[key]&&<b className="doc-tab-badge" aria-label={`требует внимания: ${badges[key]}`}>{badges[key]}</b>}
  </button>)}
 </div>;
}
