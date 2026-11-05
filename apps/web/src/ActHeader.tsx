import {StatusBadge,roleNames,shortDate} from './Ui.js';
import RouteLine from './RouteLine.js';

type Row=Record<string,any>;

/** Name of the current stage for the compact caption (kept stable: tests and users rely on it). */
function stageCaption(detail:Row,presentation:Row){
 if(detail.state==='CENTRAL_COLLECTING')return 'Проверка служб продолжается';
 if(detail.state==='RETURNED')return 'На доработке';
 if(presentation.status==='APPROVED')return 'Согласовано';
 return roleNames[presentation.stage];
}

/**
 * Top of the document workplace: what the document is, for whom and where, its status and the route.
 * Everything a reviewer needs to recognise the package without scrolling.
 */
type Panel='document'|'details'|'matrix'|'history';
const panels:[Panel,string][]=[['document','Документ'],['details','Реквизиты'],['matrix','Матрица'],['history','История']];
export default function ActHeader({detail,profile,panel='document',onPanel,onDelete}:{detail:Row;profile?:Row;panel?:string;onPanel:(panel:Panel)=>void;onDelete?:()=>void}){
 const presentation=detail.presentation;
 const kind=detail.act_type==='AVTU'?'АВТУ':'Акт';
 const showContractNumber=detail.contract_number&&detail.contract_number!==detail.act_number;
 return <div className="act-header">
  <div className="act-title-row">
   <h2 className="act-title"><span className="act-kind">{kind}</span>{' '}<span className="act-number">{detail.act_number}</span></h2>
   <StatusBadge status={presentation.status}/>
   {presentation.overdue&&<span className="deadline-danger">⚠ Просрочено</span>}
   <div className="card-tools act-panels" role="group" aria-label="Разделы документа">
    {panels.map(([key,label])=><button key={key} type="button" aria-pressed={panel===key} onClick={()=>onPanel(key)}>{label}</button>)}
   </div>
   {onDelete&&<button type="button" className="danger-button act-delete" onClick={onDelete} title="Только администратор: удалить документ насовсем">Удалить документ</button>}
  </div>
  <dl className="act-facts">
   <div><dt>Заявитель</dt><dd>{detail.applicant||'не указан'}</dd></div>
   <div className="act-fact-wide"><dt>Адрес</dt><dd title={detail.address||undefined}>{detail.address||'не указан'}</dd></div>
   <div><dt>Договор</dt><dd>{showContractNumber?`№ ${detail.contract_number}, `:''}{detail.contract_date?`от ${shortDate(detail.contract_date)}`:'дата не указана'}</dd></div>
   <div><dt>РЭС</dt><dd>{presentation.res_name}</dd></div>
  </dl>
  <div className="act-route-row">
   <RouteLine route={presentation.route} me={profile?{id:profile.id,name:profile.name}:undefined}/>
   <span className="status act-stage-caption" data-testid="act-current-stage">{stageCaption(detail,presentation)}</span>
  </div>
 </div>;
}
