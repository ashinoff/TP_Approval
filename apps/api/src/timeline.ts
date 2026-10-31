import {type DB,requireValue} from './db.js';
type Row=Record<string,any>;
export function timelineEvents(data:Row){
  const out:Row[]=[];
  const audit=(action:string,match:(e:Row)=>boolean=()=>true)=>data.audit.find((e:Row)=>e.action===action&&match(e));
  const person=(e:Row|undefined,fallback:Row|null=null)=>e?.actor_snapshot??fallback;
  const push=(id:string,type:string,at:string,actor:Row|null,department:string,title:string,result:string,refs:Row={},order=0)=>out.push({id,type,at,actor,department,title,result,...refs,order});
  push(`act:${data.id}`,'CREATED',data.created_at,person(audit('CREATED'),data.author),'РИРУ','Акт создан',`Акт ${data.act_number} · договор ${data.contract_number}`,{},0);
  for(const v of data.versions){const e=audit('VERSION_CREATED',e=>e.details.versionId===v.id);push(`version:${v.id}`,'VERSION_CREATED',v.created_at,person(e,v.creator),'РИРУ',`Загружена версия Word ${v.number}`,'Исходный DOCX сохранён без изменения байтов',{versionId:v.id,versionNumber:v.number},10);}
  for(const c of data.cycles){
    const e=audit('SUBMITTED',e=>e.details.cycleId===c.id);
    push(`cycle:${c.id}`,'SUBMITTED',c.started_at,person(e,data.author),'РИРУ',c.number===1?'Отправлено на согласование':`Запущен новый цикл ${c.number}`,'Документ направлен Начальнику соответствующего РЭС',{cycleId:c.id,cycleNumber:c.number,versionId:c.version_id,versionNumber:c.version_number},20);
    if(c.state==='RETURNED')push(`return:${c.id}`,'RETURNED',c.closed_at,null,'Маршрут согласования','Возврат на доработку','Цикл закрыт, создана задача устранения замечаний для РИРУ',{cycleId:c.id,cycleNumber:c.number,versionId:c.version_id,versionNumber:c.version_number},50);
  }
  for(const t of data.tasks){if(!t.decision)continue;const c=data.cycles.find((c:Row)=>c.id===t.cycle_id);
    const remarks=data.comments.filter((comment:Row)=>comment.task_id===t.id);
    push(`decision:${t.decision_id}`,'DECISION',t.decided_at,{id:t.actor_id,name:t.actor_name,source:'DECISION'},t.role,t.decision==='APPROVE'?'Документ согласован подразделением':'Документ возвращён с замечанием',t.decision==='RETURN'?`Замечаний: ${remarks.length}. Требуется исправление.`:t.reason||'Согласовано без замечаний',{cycleId:c?.id,cycleNumber:c?.number,versionId:c?.version_id,versionNumber:c?.version_number,taskId:t.id,decision:t.decision,commentId:remarks[0]?.id},30);
  }
  for(const c of data.comments){const t=data.tasks.find((t:Row)=>t.id===c.task_id);const cycle=data.cycles.find((cy:Row)=>cy.id===t?.cycle_id);const actor=c.author_snapshot??(t?.actor_id===c.author_id?{id:t.actor_id,name:t.actor_name,source:'DECISION'}:c.author);
    push(`comment:${c.id}`,'COMMENT_ADDED',c.created_at,actor,t?.role??'Согласующий','Добавлено замечание',c.text,{commentId:c.id,versionId:c.version_id,versionNumber:cycle?.version_number,cycleId:cycle?.id,cycleNumber:cycle?.number},40);
  }
  for(const ev of data.comment_events){const comment=data.comments.find((c:Row)=>c.id===ev.comment_id);const t=data.tasks.find((t:Row)=>t.id===comment?.task_id);const v=data.versions.find((v:Row)=>v.id===ev.version_id);const e=audit('COMMENT_EVENT',a=>a.details.commentId===ev.comment_id&&a.details.type===ev.type&&a.actor_id===ev.actor_id&&a.created_at===ev.created_at);
    const titles:Record<string,string>={REPORTED_FIXED:'Заявлено исправление замечания',VERIFIED:'Автор подтвердил устранение',REOPENED:'Замечание открыто повторно'};
    push(`comment-event:${ev.id}`,ev.type,ev.created_at,person(e,ev.actor),ev.type==='REPORTED_FIXED'?'RIRU_HEAD':t?.role??'Согласующий',titles[ev.type],ev.explanation,{commentId:ev.comment_id,versionId:ev.version_id,versionNumber:v?.number},45);
  }
  for(const r of data.releases){const c=data.cycles.find((c:Row)=>c.id===r.cycle_id);push(`release:${r.id}`,'APPROVED',r.published_at,null,'Маршрут согласования','Согласование завершено','Создана утверждённая публикация после четырёх положительных решений',{cycleId:r.cycle_id,cycleNumber:c?.number,versionId:r.version_id,versionNumber:c?.version_number,releaseId:r.id},60);}
  for(const e of data.audit){
    if(e.action==='REVISION_STARTED')push(`audit:${e.id}`,e.action,e.created_at,person(e),'РИРУ','Начат пересмотр утверждённого акта',e.details.reason??'',{},70);
    if(e.action==='RELEASE_REVOKED'){const r=data.releases.find((r:Row)=>r.id===e.details.releaseId);const c=data.cycles.find((c:Row)=>c.id===r?.cycle_id);push(`audit:${e.id}`,e.action,e.created_at,person(e),'PROCESS_ADMIN','Публикация отозвана',e.details.reason??'',{versionId:r?.version_id,versionNumber:c?.version_number,cycleId:c?.id,cycleNumber:c?.number},80);}
    if(e.action==='COLLECTION_CLOSED')push(`audit:${e.id}`,e.action,e.created_at,person(e),'PROCESS_ADMIN','Сбор замечаний закрыт администратором',e.details.reason??'',{},49);
  }
  return out.sort((a,b)=>new Date(a.at).getTime()-new Date(b.at).getTime()||a.order-b.order||a.id.localeCompare(b.id)).map(({order,...e})=>e);
}
export async function timeline(db:DB,id:string){
  const result=await db.query(`SELECT a.*,app.act_user_label(a.id,a.author_id) AS author,
   coalesce((SELECT jsonb_agg(to_jsonb(v)||jsonb_build_object('creator',app.act_user_label(a.id,v.created_by)) ORDER BY v.number) FROM app.versions v WHERE v.act_id=a.id),'[]') AS versions,
   coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('version_number',v.number) ORDER BY c.number) FROM app.cycles c JOIN app.versions v ON v.id=c.version_id WHERE c.act_id=a.id),'[]') AS cycles,
   coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('decision_id',d.id,'decision',d.decision,'actor_id',d.actor_id,'actor_name',d.actor_name,'reason',d.reason,'decided_at',d.created_at)) FROM app.tasks t LEFT JOIN app.decisions d ON d.task_id=t.id WHERE t.act_id=a.id),'[]') AS tasks,
   coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('author',app.act_user_label(a.id,c.author_id))) FROM app.comments c WHERE c.act_id=a.id),'[]') AS comments,
   coalesce((SELECT jsonb_agg(to_jsonb(e)||jsonb_build_object('actor',app.act_user_label(a.id,e.actor_id))) FROM app.comment_events e WHERE e.act_id=a.id),'[]') AS comment_events,
   coalesce((SELECT jsonb_agg(r) FROM app.releases r WHERE r.act_id=a.id),'[]') AS releases,
   coalesce((SELECT jsonb_agg(e ORDER BY e.created_at,e.id) FROM app.audit_events e WHERE e.act_id=a.id),'[]') AS audit
   FROM app.acts a WHERE a.id=$1`,[id]);
  const data=requireValue(result.rows[0]);return {actId:id,events:timelineEvents(data)};
}
