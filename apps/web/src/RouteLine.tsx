import {Fragment} from 'react';
import {Icon,dateTime} from './Ui.js';

type Person={id?:string;name?:string}|string|null|undefined;
type Stage={role:string;label:string;status:string;person?:Person;substitution?:boolean;decidedAt?:string|null;dueAt?:string|null;overdue?:boolean;detail?:string};
export type Route={riru:Stage;head?:Stage|null;res:Stage;parallel:Stage[];result?:Stage};

const personName=(p:Person)=>typeof p==='string'?p:p?.name??'';
const personId=(p:Person)=>typeof p==='string'?undefined:p?.id;
const shortTime=(value?:string|null)=>value?dateTime(value).replace(/:\d\d$/,''):'';

const stageTitles:Record<string,string>={RIRU:'Инженер РИРУ',RIRU_HEAD:'Начальник РИРУ',RES_HEAD:'Начальник РЭС',SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОК'};

/** Text under the stage name: what happened or what is expected, in plain words. */
function stageNote(stage:Stage){
 if(stage.role==='RIRU'){
  if(stage.status==='completed')return 'документ отправлен';
  if(stage.status==='returned')return 'доработка после замечаний';
  return stage.detail?.toLowerCase()??'подготовка';
 }
 if(stage.status==='completed')return `согласовано ${shortTime(stage.decidedAt)}`.trim();
 if(stage.status==='returned')return `вернул(а) ${shortTime(stage.decidedAt)}`.trim();
 if(stage.status==='active')return stage.overdue?`просрочено, срок ${shortTime(stage.dueAt)}`:`ждёт решения${stage.dueAt?`, до ${shortTime(stage.dueAt)}`:''}`;
 if(stage.status==='no_decision')return 'без решения';
 return 'ещё не начато';
}
const stateLabel:Record<string,string>={completed:'выполнено',returned:'возврат',active:'текущий этап',not_started:'не начато',no_decision:'без решения'};
const stateIcon:Record<string,string>={completed:'check',returned:'return',active:'clock'};

function Node({stage,me}:{stage:Stage;me?:{id?:string;name?:string}}){
 const name=personName(stage.person);
 const mine=!!name&&(personId(stage.person)?personId(stage.person)===me?.id:name===me?.name);
 return <li className={`route-node route-${stage.status}${stage.overdue?' route-late':''}`}>
  <span className="route-dot" aria-hidden="true">{stateIcon[stage.status]&&<Icon name={stateIcon[stage.status]} size={10}/>}</span>
  <span className="route-text">
   <span className="route-role">{stageTitles[stage.role]??stage.label}<span className="sr-only">: {stateLabel[stage.status]??stage.status}</span></span>
   {name&&<span className="route-person">{name}{mine?' (вы)':''}{stage.substitution?' · замещение':''}</span>}
   <span className="route-note">{stageNote(stage)}</span>
  </span>
 </li>;
}

/**
 * Approval route drawn like a single-line diagram: sequential stages on one line,
 * the three central services as feeders from a common bus.
 */
export default function RouteLine({route,me}:{route:Route;me?:{id?:string;name?:string}}){
 const sequence=[route.riru,...(route.head?[route.head]:[]),route.res];
 const wire=(stage:Stage)=><li className={`route-wire${stage.status==='completed'?' route-wire-done':''}`} aria-hidden="true"/>;
 return <div className="route-line" data-testid="act-route">
  <ol className="route-sequence" aria-label="Маршрут согласования: последовательно, затем три службы параллельно">
   {sequence.map(stage=><Fragment key={stage.role}><Node stage={stage} me={me}/>{wire(stage)}</Fragment>)}
   <li className="route-bus-item">
    <ol className="route-bus" aria-label="Параллельно: СУЭ, СТП, ТЕХБЛОК">
     {route.parallel.map(stage=><Node key={stage.role} stage={stage} me={me}/>)}
    </ol>
   </li>
  </ol>
 </div>;
}
