import {Icon,dateTime} from './Ui.js';
export type FlowStage={role:string;label:string;status:string;current?:boolean;person?:{name:string}|null;substitution?:boolean;decidedAt?:string|null;dueAt?:string|null;commentCount?:number;overdue?:boolean;detail?:string};
export type FlowRoute={riru:FlowStage;res:FlowStage;parallel:FlowStage[];result:FlowStage};
function Stage({stage,compact}:{stage:FlowStage;compact:boolean}){
  const title=[stage.label,stage.detail,stage.person?.name,stage.substitution?'Временное замещение':null,stage.decidedAt?`Решение ${dateTime(stage.decidedAt)}`:null,stage.overdue?'Просрочено':null].filter(Boolean).join(' · ');
  return <div className={`flow-stage flow-${stage.status} ${stage.current?'flow-current':''}`} data-stage={stage.role} title={title} aria-label={`${stage.label}: ${stage.status==='completed'?'согласовано':stage.status==='returned'?'замечания':stage.status==='active'?'текущий этап':stage.status==='no_decision'?'без решения':'не начат'}`}>
    <span className="flow-symbol"><Icon size={compact?12:17} name={stage.status==='completed'?'check':stage.status==='returned'?'return':stage.status==='active'?'clock':stage.status==='no_decision'?'x':'file'}/></span>
    <span className="flow-copy"><b>{stage.label}</b>{!compact&&<><small>{stage.person?.name??(stage.role==='RESULT'?'':stage.status==='not_started'?'Этап ещё не начался':'—')}{stage.substitution?' · Замещение':''}</small>{stage.detail&&<small>{stage.detail}</small>}{stage.decidedAt&&<time>{dateTime(stage.decidedAt)}</time>}{!!stage.commentCount&&<small className="flow-comment">{stage.commentCount} замеч.</small>}</>}</span>
    {!!stage.commentCount&&compact&&<span className="flow-count">{stage.commentCount}</span>}{stage.overdue&&<span className="flow-overdue" title="Просрочено"><Icon size={12} name="alert"/>{!compact&&'Просрочено'}</span>}
  </div>;
}
export default function RouteFlow({route,compact=false}:{route:FlowRoute;compact?:boolean}){
  return <div className={`route-flow ${compact?'route-compact':'route-detailed'}`} aria-label="Маршрут согласования" data-testid={compact?'registry-route':'card-route'}>
    <Stage stage={route.riru} compact={compact}/><span className="flow-connector" aria-hidden="true"><Icon name="arrow" size={compact?12:18}/></span><Stage stage={route.res} compact={compact}/><span className="flow-connector" aria-hidden="true"><Icon name="branch" size={compact?14:22}/></span>
    <div className="flow-parallel"><span className="parallel-caption">Параллельно</span><div className="parallel-stages">{route.parallel.map(s=><Stage key={s.role} stage={s} compact={compact}/>)}</div></div>
    <span className="flow-connector" aria-hidden="true"><Icon name="arrow" size={compact?12:18}/></span><Stage stage={route.result} compact={compact}/>
  </div>;
}
