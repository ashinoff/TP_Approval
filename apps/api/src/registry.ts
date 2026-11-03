import {z} from 'zod';
import {type DB,requireValue} from './db.js';
type Row=Record<string,any>;
const boolean=z.enum(['true','false']).transform(v=>v==='true').optional();
export const registryFilters=z.object({q:z.string().trim().max(200).default(''),resId:z.string().uuid().optional(),
  status:z.enum(['DRAFT','IN_REVIEW','COLLECTING','REVISING','REWORK','APPROVED','OVERDUE','REVOKED']).optional(),
  view:z.enum(['queue','work','preparation','approved','upload','progress','corrections']).optional(),dateField:z.enum(['created','contract']).default('created'),
  stage:z.enum(['RIRU','RIRU_HEAD','RES_HEAD','PARALLEL','SUE','STP','GI','COMPLETED']).optional(),
  from:z.iso.date().optional(),to:z.iso.date().optional(),comments:z.enum(['with','without']).optional(),
  overdue:boolean,mine:boolean,action:boolean,page:z.coerce.number().int().min(1).max(100000).default(1),limit:z.coerce.number().int().min(1).max(100).default(25)
}).strict().refine(v=>!v.from||!v.to||v.from<=v.to,{message:'Начало периода не может быть позже окончания',path:['from']});

const source=`SELECT a.*,statement_timestamp() AS as_of,r.name AS res_name,app.act_user_label(a.id,a.author_id) AS author,
 c.id AS cycle_id,c.number AS cycle_number,c.state AS cycle_state,c.closed_at AS cycle_closed_at,c.version_id AS cycle_version_id,
 v.id AS version_id,v.number AS version_number,v.file_id AS download_file_id,v.snapshot,
 rel.status AS publication_status,pub.publication AS active_publication,app.has_role('RIRU_ENGINEER',a.res_id) AS can_prepare,
 coalesce(tr.tasks,'[]'::jsonb) AS route_tasks,tr.due_at,coalesce(tr.overdue,false) AS overdue,
 (SELECT count(*)::int FROM app.comments cm WHERE cm.act_id=a.id) AS comment_count,
 mt.id AS my_task_id,mt.role AS my_task_role,coalesce(mt.eligible,false) AS can_decide,
 coalesce(mt.eligible,false) AND NOT EXISTS(SELECT 1 FROM app.comments cm WHERE cm.task_id=mt.id AND cm.anchor IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM app.comments cm JOIN app.cycles old ON old.version_id=cm.version_id
   WHERE cm.act_id=a.id AND cm.author_id=app.uid() AND old.number<c.number AND
   coalesce((SELECT ev.type FROM app.comment_events ev WHERE ev.comment_id=cm.id AND ev.version_id=c.version_id ORDER BY ev.created_at DESC,ev.id DESC LIMIT 1),'OPEN')<>'VERIFIED') AS can_approve
 FROM app.acts a JOIN app.res_units r ON r.id=a.res_id
 LEFT JOIN LATERAL(SELECT * FROM app.cycles cy WHERE cy.act_id=a.id ORDER BY cy.number DESC LIMIT 1)c ON true
 LEFT JOIN app.versions cv ON cv.id=c.version_id
 LEFT JOIN LATERAL(SELECT * FROM app.versions ve WHERE ve.act_id=a.id ORDER BY ve.number DESC LIMIT 1)v ON true
 LEFT JOIN app.releases rel ON rel.cycle_id=c.id
 LEFT JOIN LATERAL(SELECT jsonb_build_object('id',p.id,'status',p.status,'versionId',p.version_id,'versionNumber',pv.number,'fileId',pv.file_id,'cycleId',p.cycle_id) AS publication
 FROM app.releases p JOIN app.versions pv ON pv.id=p.version_id WHERE p.act_id=a.id AND p.status IN ('CURRENT','UNDER_REVISION') ORDER BY p.published_at DESC LIMIT 1)pub ON true
 LEFT JOIN LATERAL(SELECT jsonb_agg(jsonb_build_object('id',t.id,'role',app.task_role(t.role,t.cycle_id),'status',t.status,'decision',d.decision,
   'receivedAt',t.received_at,'dueAt',t.due_at,'decidedAt',d.created_at,'person',CASE WHEN d.id IS NOT NULL THEN jsonb_build_object('id',d.actor_id,'name',d.actor_name) ELSE app.matrix_task_identity(t.id)->'effective' END,
   'substitution',app.matrix_task_identity(t.id)->'substitution','commentCount',(SELECT count(*) FROM app.comments cm WHERE cm.task_id=t.id))) AS tasks,
   min(t.due_at) FILTER(WHERE t.status='OPEN') AS due_at,bool_or(t.status='OPEN' AND t.due_at<statement_timestamp()) AS overdue
   FROM app.tasks t LEFT JOIN app.decisions d ON d.task_id=t.id WHERE t.cycle_id=c.id)tr ON true
 LEFT JOIN LATERAL(SELECT t.id,app.task_role(t.role,t.cycle_id) AS role,
   app.task_role(t.role,t.cycle_id)<>'RIRU_ENGINEER' AND a.author_id<>app.uid() AND cv.created_by<>app.uid() AND
   NOT EXISTS(SELECT 1 FROM app.decisions dd JOIN app.tasks tt ON tt.id=dd.task_id WHERE tt.act_id=a.id AND dd.actor_id=app.uid() AND (tt.role<>t.role OR tt.cycle_id=t.cycle_id)) AS eligible
   FROM app.tasks t WHERE t.act_id=a.id AND t.status='OPEN' AND app.task_user(t.assignment_id,t.assignee_id)=app.uid() AND app.has_role(app.task_role(t.role,t.cycle_id),a.res_id)
   ORDER BY t.received_at,t.id LIMIT 1)mt ON true`;
const decorated=`SELECT s.*,
 CASE WHEN s.state='DRAFT' THEN 'DRAFT' WHEN s.state='REVISING' THEN 'REVISING'
 WHEN s.cycle_state='APPROVED' AND s.publication_status='REVOKED' THEN 'REVOKED'
 WHEN s.state='CENTRAL_COLLECTING' THEN 'COLLECTING' WHEN s.state='RETURNED' THEN 'REWORK'
 WHEN s.state='APPROVED' THEN 'APPROVED' ELSE 'IN_REVIEW' END AS display_status,
 CASE WHEN s.state IN ('DRAFT','RETURNED','REVISING') THEN 'RIRU' WHEN s.state='RIRU_REVIEW' THEN 'RIRU_HEAD' WHEN s.state='RES_REVIEW' THEN 'RES_HEAD'
 WHEN s.state IN ('CENTRAL_REVIEW','CENTRAL_COLLECTING') THEN 'PARALLEL' ELSE 'COMPLETED' END AS stage
 FROM (${source}) s`;

export function registryItem(r:Row){
  const task=(role:string)=>r.route_tasks.find((t:Row)=>t.role===role);
  const stage=(role:string,label:string):Row=>{
    const t=task(role);const reset=r.state==='REVISING';
    const status=reset||!t?'not_started':t.decision==='APPROVE'?'completed':t.decision==='RETURN'?'returned':t.status==='OPEN'?'active':'no_decision';
    return {role,label,status,current:status==='active',person:reset?null:t?.person??null,substitution:!reset&&(t?.substitution??false),
      receivedAt:reset?null:t?.receivedAt??null,decidedAt:reset?null:t?.decidedAt??null,dueAt:reset?null:t?.dueAt??null,
      commentCount:reset?0:Number(t?.commentCount??0),overdue:!reset&&t?.status==='OPEN'&&new Date(t.dueAt)<new Date(r.as_of??Date.now())};
  };
  const rework=task('RIRU_ENGINEER');const preparing=r.stage==='RIRU';
  const route={riru:{role:'RIRU',label:'РИРУ',status:r.state==='RETURNED'?'returned':preparing?'active':'completed',current:preparing,
    person:rework?.person??r.author,commentCount:0,dueAt:rework?.status==='OPEN'?rework.dueAt:null,overdue:!!rework&&rework.status==='OPEN'&&r.overdue,
    detail:r.state==='RETURNED'?'Устранение замечаний':r.state==='REVISING'?'Пересмотр':'Подготовка акта'},
    head:(r.workflow_version===2?stage('RIRU_HEAD','Начальник РИРУ'):null),res:stage('RES_HEAD','Начальник РЭС'),parallel:['SUE','STP','GI'].map((s,i)=>stage(s,['СУЭ','СТП','ТЕХБЛОК'][i])),
    result:{role:'RESULT',label:r.display_status==='REVOKED'?'Отозвано':r.state==='RETURNED'?'Возврат':r.display_status==='APPROVED'?'Согласовано':r.state==='CENTRAL_COLLECTING'?'Замечания':'Итог',
      status:r.display_status==='REVOKED'?'no_decision':r.state==='RETURNED'||r.state==='CENTRAL_COLLECTING'?'returned':r.display_status==='APPROVED'?'completed':'not_started',current:false,commentCount:0}};
  return {id:r.id,act_type:r.act_type,contract_id:r.contract_id,act_number:r.act_number,contract_number:r.contract_number,contract_date:r.contract_date,applicant:r.applicant,address:r.address,res_id:r.res_id,res_name:r.res_name,
    created_at:r.created_at,state:r.state,status:r.display_status,stage:r.stage,revision:r.revision,version:r.version_number??null,cycle:r.cycle_number??null,
    commentCount:r.comment_count,due_at:r.due_at,overdue:r.overdue,route,
    requiresAction:!!r.my_task_id,publicationStatus:r.publication_status,approvedPublication:r.active_publication??null,canPrepare:!!r.can_prepare,
    actions:{taskId:r.my_task_id??null,taskRole:r.my_task_role??null,approve:r.can_approve,return:r.can_decide,downloadFileId:r.download_file_id??null,print:false,
      approveReason:r.can_decide&&!r.can_approve?'Сначала подтвердите устранение своих замечаний':'Нет доступной задачи согласования',returnReason:'Нет доступной задачи согласования'}};
}
export async function registry(db:DB,input:unknown){
  const f=registryFilters.parse(input);const like=f.q?`%${f.q.replace(/[\\%_]/g,'\\$&')}%`:null;
  const section=`CASE $13::text WHEN 'queue' THEN my_task_id IS NOT NULL AND my_task_role<>'RIRU_ENGINEER'
    WHEN 'upload' THEN can_prepare AND state='DRAFT'
    WHEN 'progress' THEN can_prepare AND state IN ('RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING')
    WHEN 'corrections' THEN can_prepare AND (state IN ('RETURNED','REVISING') OR display_status='REVOKED')
    WHEN 'approved' THEN active_publication IS NOT NULL
    WHEN 'work' THEN state<>'APPROVED' OR active_publication IS NULL
    WHEN 'preparation' THEN can_prepare AND (state<>'APPROVED' OR active_publication IS NULL) ELSE true END`;
  const dateFrom=f.dateField==='contract'?'contract_date >= $5::date':"created_at>=($5::date::timestamp AT TIME ZONE 'Europe/Moscow')";
  const dateTo=f.dateField==='contract'?'contract_date <= $6::date':"created_at<(($6::date+1)::timestamp AT TIME ZONE 'Europe/Moscow')";
  const conditions=`(${section}) AND ($1::text IS NULL OR act_number ILIKE $1 OR contract_number ILIKE $1 OR applicant ILIKE $1 OR address ILIKE $1 OR snapshot->'technicalData' IS NOT NULL AND (snapshot->'technicalData')::text ILIKE $1 OR EXISTS(SELECT 1 FROM app.comments cm WHERE cm.act_id=d.id AND cm.text ILIKE $1))
    AND ($2::uuid IS NULL OR res_id=$2) AND ($3::text IS NULL OR CASE WHEN $13='approved' AND $3='APPROVED' THEN active_publication IS NOT NULL
      WHEN $13='approved' AND $3='REVISING' THEN active_publication->>'status'='UNDER_REVISION' ELSE display_status=$3 OR $3='OVERDUE' AND overdue END)
    AND ($4::text IS NULL OR stage=$4 OR $4 IN ('SUE','STP','GI') AND EXISTS(SELECT 1 FROM jsonb_array_elements(route_tasks) rt WHERE rt->>'role'=$4 AND rt->>'status'='OPEN'))
    AND ($5::date IS NULL OR ${dateFrom}) AND ($6::date IS NULL OR ${dateTo})
    AND ($7::text IS NULL OR $7='with' AND comment_count>0 OR $7='without' AND comment_count=0)
    AND ($8::boolean IS NULL OR overdue=$8) AND (NOT $9::boolean OR author_id=app.uid()) AND (NOT $10::boolean OR my_task_id IS NOT NULL)`;
  const params=[like,f.resId??null,f.status??null,f.stage??null,f.from??null,f.to??null,f.comments??null,f.overdue??null,f.mine??false,f.action??false,f.limit,(f.page-1)*f.limit,f.view??null];
  const result=await db.query(`WITH records AS (${decorated}),filtered AS (SELECT * FROM records d WHERE ${conditions})
    SELECT (SELECT count(*)::int FROM filtered) AS total,
    coalesce((SELECT jsonb_agg(to_jsonb(page) ORDER BY page.created_at DESC,page.id) FROM (SELECT * FROM filtered ORDER BY created_at DESC,id LIMIT $11 OFFSET $12) page),'[]'::jsonb) AS items,
    (SELECT jsonb_build_object('total',count(*),'inReview',count(*) FILTER(WHERE display_status IN ('IN_REVIEW','COLLECTING','REVISING')),'rework',count(*) FILTER(WHERE display_status='REWORK'),
      'overdue',count(*) FILTER(WHERE overdue),'approved',count(*) FILTER(WHERE active_publication IS NOT NULL)) FROM filtered) AS summary`,params);
  const data=result.rows[0];return {items:data.items.map(registryItem),total:data.total,page:f.page,limit:f.limit,summary:data.summary};
}
export async function registryAct(db:DB,id:string){const result=await db.query(`SELECT * FROM (${decorated}) d WHERE id=$1`,[id]);return registryItem(requireValue(result.rows[0]));}
export async function registryCounts(db:DB){return (await db.query(`WITH d AS (${decorated}) SELECT count(*) FILTER(WHERE my_task_id IS NOT NULL AND my_task_role<>'RIRU_ENGINEER')::int AS queue,
 count(*) FILTER(WHERE active_publication IS NOT NULL)::int AS approved,count(*) FILTER(WHERE state<>'APPROVED' OR active_publication IS NULL)::int AS work,
 count(*) FILTER(WHERE can_prepare AND (state<>'APPROVED' OR active_publication IS NULL))::int AS preparation,
 count(*) FILTER(WHERE can_prepare AND state='DRAFT')::int AS upload,
 count(*) FILTER(WHERE can_prepare AND state IN ('RIRU_REVIEW','RES_REVIEW','CENTRAL_REVIEW','CENTRAL_COLLECTING'))::int AS progress,
 count(*) FILTER(WHERE can_prepare AND (state IN ('RETURNED','REVISING') OR display_status='REVOKED'))::int AS corrections FROM d`)).rows[0];}
