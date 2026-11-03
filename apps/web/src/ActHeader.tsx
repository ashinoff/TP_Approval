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
export default function ActHeader({detail,profile,onPanel}:{detail:Row;profile?:Row;onPanel:(panel:'details'|'matrix'|'history')=>void}){
 const presentation=detail.presentation;
 const kind=detail.act_type==='AVTU'?'АВТУ':'Акт';
 const showContractNumber=detail.contract_number&&detail.contract_number!==detail.act_number;
 return <div className="act-header">
  <div className="act-title-row">
   <h2 className="act-title"><span className="act-kind">{kind}</span>{' '}<span className="act-number">{detail.act_number}</span></h2>
   <StatusBadge status={presentation.status}/>
   {presentation.overdue&&<span className="deadline-danger">⚠ Просрочено</span>}
   <div className="card-tools">
    <button className="text-button" onClick={()=>onPanel('details')}>Реквизиты</button>
    <button className="text-button" onClick={()=>onPanel('matrix')}>Матрица</button>
    <button className="text-button" onClick={()=>onPanel('history')}>История</button>
   </div>
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
