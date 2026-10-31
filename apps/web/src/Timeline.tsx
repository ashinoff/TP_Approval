import {Icon,dateTime,roleNames} from './Ui.js';
type Event={id:string;type:string;at:string;actor:{id:string;name:string;source?:string}|null;department:string;title:string;result:string;cycleNumber?:number;cycleId?:string;versionNumber?:number;versionId?:string;commentId?:string};
export default function Timeline({events,onLink,compact=false}:{events:Event[];onLink:(type:string,id:string)=>void;compact?:boolean}){
  return <section className={`timeline-panel ${compact?'timeline-compact':''}`} aria-label="Временная шкала событий"><div className="section-heading"><div><span className="eyebrow">ХРОНОЛОГИЯ</span><h3>История согласования</h3></div><span className="count-label">{events.length} событий</span></div>
    <ol className="timeline">{events.map(e=><li className={`timeline-event event-${e.type.toLowerCase()} ${e.type==='DECISION'&&e.result!=='Согласовано без замечаний'?'event-with-result':''}`} key={e.id} data-event-type={e.type}>
      <span className="timeline-dot"><Icon size={14} name={e.type==='COMMENT_ADDED'?'comment':e.type==='APPROVED'||e.type==='VERIFIED'?'check':e.type==='RETURNED'?'return':e.type==='RELEASE_REVOKED'?'x':e.type==='VERSION_CREATED'?'file':'history'}/></span>
      <div className="timeline-content"><div className="timeline-meta"><time dateTime={e.at}>{dateTime(e.at)}</time>{e.cycleNumber&&<span>Цикл {e.cycleNumber}</span>}</div><h4>{e.title}</h4><p className="timeline-actor">{e.actor?.name??'Система'} · {roleNames[e.department]??e.department}</p><p className="timeline-result">{e.result}</p>
        <div className="timeline-links">{e.commentId&&<button className="text-button" onClick={()=>onLink('comment',e.commentId!)}>Открыть замечание</button>}{e.versionId&&<button className="text-button" onClick={()=>onLink('version',e.versionId!)}>Word v{e.versionNumber??'—'}</button>}{e.cycleId&&<button className="text-button" onClick={()=>onLink('cycle',e.cycleId!)}>Матрица цикла</button>}</div>
      </div>
    </li>)}</ol>
  </section>;
}
