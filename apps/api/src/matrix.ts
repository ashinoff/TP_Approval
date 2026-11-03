import {type DB,HttpError,requireValue} from './db.js';

type RecordRow=Record<string,any>;
export const matrixRoles=['RES_HEAD','SUE','STP','GI'] as const;
export type MatrixStatus='NOT_STARTED'|'PENDING'|'APPROVED'|'RETURNED'|'NO_DECISION';
export function deriveMatrix(raw:RecordRow,selectedCycleId?:string){
  const cycles:RecordRow[]=raw.cycles;const cycle=selectedCycleId?cycles.find(c=>c.id===selectedCycleId):cycles.at(-1);
  if(selectedCycleId&&!cycle)throw new HttpError(404,'CYCLE_NOT_FOUND');
  const asOf=new Date(raw.as_of).getTime();
  const roles:readonly string[]=(cycle?.workflow_version??raw.workflow_version)===2?['RIRU_HEAD',...matrixRoles]:matrixRoles;
  const rows=roles.map(role=>{
    const task:RecordRow|undefined=cycle?raw.tasks.find((t:RecordRow)=>t.cycle_id===cycle.id&&t.role===role):undefined;
    const comments:RecordRow[]=task?raw.comments.filter((c:RecordRow)=>c.task_id===task.id):[];
    const status:MatrixStatus=!task?'NOT_STARTED':task.decision==='APPROVE'?'APPROVED':task.decision==='RETURN'?'RETURNED':task.status==='OPEN'&&!cycle?.closed_at?'PENDING':'NO_DECISION';
    const end=task?.decided_at??task?.completed_at??cycle?.closed_at??null;
    const endMs=end?new Date(end).getTime():asOf;
    const overdue=!!task&&endMs>new Date(task.due_at).getTime();
    return {role,department:role==='RIRU_HEAD'?`Начальник РИРУ · ${raw.res_name}`:role==='RES_HEAD'?`Начальник РЭС · ${raw.res_name}`:({SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОК'} as Record<string,string>)[role],taskId:task?.id??null,
      person:task?(task.decision?{id:task.actor_id,name:task.actor_name,source:'DECISION'}:task.identity?.effective??null):null,
      assignment:task?.identity?.assignment??null,substitution:task?.identity?.substitution??false,
      status,receivedAt:task?.received_at??null,dueAt:task?.due_at??null,
      policy:task?{id:task.policy_id,workingDays:task.working_days,preliminary:task.preliminary}:null,
      decidedAt:task?.decided_at??null,completedAt:task?.completed_at??null,
      elapsedSeconds:task?Math.max(0,Math.floor((endMs-new Date(task.received_at).getTime())/1000)):null,
      durationRunning:status==='PENDING',overdue:status==='PENDING'&&overdue,wasOverdue:status!=='PENDING'&&overdue,
      commentCount:comments.length,comments};
  });
  const release=cycle?raw.releases.find((r:RecordRow)=>r.cycle_id===cycle.id):undefined;
  const overdue=rows.some(r=>r.overdue)||raw.tasks.some((t:RecordRow)=>t.cycle_id===cycle?.id&&(t.role==='RIRU_ENGINEER'||cycle?.workflow_version!==2&&t.role==='RIRU_HEAD')&&t.status==='OPEN'&&asOf>new Date(t.due_at).getTime());const requiresRework=cycle?.state==='RETURNED'||rows.some(r=>r.status==='RETURNED');
  const overall=release?.status==='REVOKED'?'REVOKED':cycle?.state==='APPROVED'?'APPROVED':cycle?.state==='CENTRAL_COLLECTING'?'COLLECTING':cycle?.state==='RETURNED'?'REQUIRES_REWORK':!cycle?'DRAFT':'IN_REVIEW';
  const version=cycle?raw.versions.find((v:RecordRow)=>v.id===cycle.version_id):raw.versions.at(-1);
  return {actId:raw.id,resName:raw.res_name,asOf:raw.as_of,actState:raw.state,
    cycle:cycle?{id:cycle.id,number:cycle.number,state:cycle.state,startedAt:cycle.started_at,closedAt:cycle.closed_at}:null,
    version:version?{id:version.id,number:version.number}:null,
    latestVersionNumber:raw.versions.at(-1)?.number??null,
    cycles:cycles.map(c=>({id:c.id,number:c.number,versionNumber:c.version_number,state:c.state,closedAt:c.closed_at})),
    overall,overdue,requiresRework,publicationStatus:release?.status??null,rows};
}

export async function approvalMatrix(db:DB,actId:string,cycleId?:string){
  // One PostgreSQL statement means one consistent snapshot even during concurrent decisions.
  const result=await db.query(`SELECT a.id,a.state,a.workflow_version,r.name AS res_name,statement_timestamp() AS as_of,
    coalesce((SELECT jsonb_agg(v ORDER BY v.number) FROM app.versions v WHERE v.act_id=a.id),'[]') AS versions,
    coalesce((SELECT jsonb_agg(to_jsonb(c)||jsonb_build_object('version_number',v.number) ORDER BY c.number) FROM app.cycles c JOIN app.versions v ON v.id=c.version_id WHERE c.act_id=a.id),'[]') AS cycles,
    coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('working_days',p.working_days,'preliminary',p.preliminary,
      'identity',app.matrix_task_identity(t.id),'decision',d.decision,'actor_id',d.actor_id,'actor_name',d.actor_name,'decided_at',d.created_at))
      FROM app.tasks t JOIN app.deadline_policies p ON p.id=t.policy_id LEFT JOIN app.decisions d ON d.task_id=t.id
      WHERE t.act_id=a.id),'[]') AS tasks,
    coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'task_id',c.task_id,'versionId',c.version_id,
      'authorId',c.author_id,'text',c.text,'createdAt',c.created_at) ORDER BY c.created_at,c.id) FROM app.comments c WHERE c.act_id=a.id),'[]') AS comments,
    coalesce((SELECT jsonb_agg(rel) FROM app.releases rel WHERE rel.act_id=a.id),'[]') AS releases
    FROM app.acts a JOIN app.res_units r ON r.id=a.res_id WHERE a.id=$1`,[actId]);
  return deriveMatrix(requireValue(result.rows[0]),cycleId);
}