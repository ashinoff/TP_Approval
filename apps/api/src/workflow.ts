import {requireCompleteCard,cardSnapshotSql} from './card.js';
import { createHash, randomUUID } from 'node:crypto';
import { type DB, HttpError, requireValue } from './db.js';

export async function lockAct(db:DB,id:string) {
  return requireValue((await db.query('SELECT * FROM app.acts WHERE id=$1 FOR UPDATE',[id])).rows[0]);
}
export async function role(db:DB,wanted:string,area?:string) {
  if(!(await db.query('SELECT app.has_role($1,$2) AS yes',[wanted,area??null])).rows[0].yes) throw new HttpError(403,'ROLE_REQUIRED');
}
export async function audit(db:DB,actId:string,action:string,details:unknown={}) {
  await db.query('INSERT INTO app.audit_events(actor_id,act_id,action,details) VALUES(app.uid(),$1,$2,$3)',[actId,action,JSON.stringify(details)]);
  await db.query('INSERT INTO app.outbox(act_id,type) VALUES($1,$2)',[actId,action]);
}
export async function notify(db:DB,actId:string,userId:string,type:string) {
  await db.query('INSERT INTO app.notifications(act_id,recipient_id,type) VALUES($1,$2,$3)',[actId,userId,type]);
}
export async function assigned(db:DB,wanted:string,area:string,excluded:string[]) {
  // Do not assign a new task while an administrator revokes the selected role/account.
  await db.query('SELECT pg_advisory_xact_lock(817624)');
  const found=await db.query('SELECT id FROM app.candidates($1,$2) WHERE NOT(id=ANY($3::uuid[]))',[wanted,area,excluded]);
  const label:Record<string,string>={RIRU_ENGINEER:'Инженера РИРУ',RIRU_HEAD:'Начальника РИРУ',RES_HEAD:'Начальника РЭС',SUE:'СУЭ',STP:'СТП',GI:'ТЕХБЛОКА'};
  if(found.rowCount!==1){
   // Точная причина: нет сотрудника, несколько сотрудников или подходит только автор документа.
   const who=(await db.query('SELECT id,name,all_res FROM app.candidate_labels($1,$2) ORDER BY name',[wanted,area])).rows as {id:string;name:string;all_res:boolean}[];
   const res=(await db.query('SELECT name FROM app.res_units WHERE id=$1',[area])).rows[0]?.name??'этом РЭС';
   const role=label[wanted]??wanted;const plural:Record<string,string>={RIRU_ENGINEER:'инженеров РИРУ',RIRU_HEAD:'начальников РИРУ',RES_HEAD:'начальников РЭС',SUE:'сотрудников СУЭ',STP:'сотрудников СТП',GI:'сотрудников ТЕХБЛОКА'};const names=(list:typeof who)=>list.map(c=>c.name+(c.all_res?' (роль на все РЭС)':'')).join(', ');
   const free=who.filter(c=>!excluded.includes(c.id));
   const reason=!who.length?`В «${res}» нет активного ${role}. Назначьте роль в разделе «Пользователи».`
    :!free.length?`На роль ${role} в «${res}» подходит только ${names(who)} — это автор документа или уже участник согласования. Согласовывать свой документ нельзя: назначьте роль другому сотруднику.`
    :`В «${res}» несколько ${plural[wanted]??'сотрудников'}: ${names(free)}. Оставьте роль одному сотруднику или настройте замещение.`;
   throw new HttpError(409,'ASSIGNEE_CONFIGURATION',reason);
  }
  return found.rows[0].id as string;
}
export async function task(db:DB,actId:string,cycleId:string,wanted:string,assignee:string) {
  const policy=requireValue((await db.query('SELECT * FROM app.deadline_policies WHERE role=$1 ORDER BY created_at DESC,id DESC LIMIT 1',[wanted])).rows[0],409,'DEADLINE_POLICY_MISSING');
  // Explicit calendar, no weekday fallback. Day-based policy preserves Moscow wall time.
  const days=await db.query("SELECT day::text,working,revision,source FROM app.calendar_days WHERE day>=(now() AT TIME ZONE 'Europe/Moscow')::date ORDER BY day LIMIT 400");
  let count=0; let due:string|undefined; const snapshot=[];
  const today=(await db.query("SELECT (now() AT TIME ZONE 'Europe/Moscow')::date::text AS day")).rows[0].day;
  let expected=new Date(`${today}T00:00:00Z`);
  for(const day of days.rows) {
    if(day.day!==expected.toISOString().slice(0,10)) throw new HttpError(409,'CALENDAR_GAP');
    snapshot.push(day);
    if(day.day>today && day.working && ++count===policy.working_days) { due=day.day; break; }
    expected=new Date(expected.getTime()+86400000);
  }
  if(!due) throw new HttpError(409,'CALENDAR_MISSING','Загрузите полный производственный календарь');
  const result=await db.query("INSERT INTO app.tasks(act_id,cycle_id,role,assignee_id,policy_id,calendar_snapshot,due_at,assignment_id) VALUES($1,$2,$3,$4,$5,$6,($7::date + (now() AT TIME ZONE 'Europe/Moscow')::time) AT TIME ZONE 'Europe/Moscow',app.assignment_for($3,(SELECT res_id FROM app.acts WHERE id=$1),$4)) RETURNING *",[actId,cycleId,wanted,assignee,policy.id,JSON.stringify(snapshot),due]);
  await notify(db,actId,assignee,wanted==='RIRU_ENGINEER'?'RETURNED':'TASK_ASSIGNED');
  return result.rows[0];
}
export async function command(db:DB,path:string,key:string|undefined,body:unknown,fn:()=>Promise<unknown>) {
  if(!key||key.length>200) throw new HttpError(400,'IDEMPOTENCY_KEY_REQUIRED');
  const hash=createHash('sha256').update(JSON.stringify(body)).digest('hex');
  // Serialize same principal/key before reading its saved result.
  await db.query("SELECT pg_advisory_xact_lock(hashtextextended(app.uid()::text || $1 || $2,0))",[path,key]);
  const previous=(await db.query('SELECT * FROM app.idempotency WHERE user_id=app.uid() AND path=$1 AND key=$2',[path,key])).rows[0];
  if(previous) {if(previous.hash!==hash) throw new HttpError(409,'IDEMPOTENCY_CONFLICT'); return previous.result;}
  const result=await fn();
  await db.query('INSERT INTO app.idempotency(user_id,path,key,hash,result) VALUES(app.uid(),$1,$2,$3,$4)',[path,key,hash,JSON.stringify(result)]);
  return result;
}
export function revision(act:{revision:number},expected:number) {if(act.revision!==expected) throw new HttpError(412,'STALE_REVISION');}
async function move(db:DB,actId:string,cycleId:string,state:string,closed=false) {
  await db.query('UPDATE app.cycles SET state=$1,closed_at=CASE WHEN $4 THEN now() ELSE NULL END WHERE id=$2 AND act_id=$3',[state,cycleId,actId,closed]);
  await db.query('UPDATE app.acts SET state=$1,revision=revision+1 WHERE id=$2',[state,actId]);
}
async function returned(db:DB,act:Record<string,any>,cycleId:string) {
  await move(db,act.id,cycleId,'RETURNED',true);
  const author=await assigned(db,'RIRU_ENGINEER',act.res_id,[]);
  await task(db,act.id,cycleId,'RIRU_ENGINEER',author);
}
export async function submit(db:DB,actId:string,versionId:string,expected:number,checkId?:string) {
  const act=await lockAct(db,actId); revision(act,expected); await role(db,'RIRU_ENGINEER',act.res_id);
  if(!['DRAFT','RETURNED','REVISING'].includes(act.state)) throw new HttpError(409,'INVALID_STATE');
  const version=requireValue((await db.query('SELECT * FROM app.versions WHERE id=$1 AND act_id=$2',[versionId,actId])).rows[0]);
  if((await db.query('SELECT 1 FROM app.cycles WHERE version_id=$1',[versionId])).rowCount)throw new HttpError(409,'NEW_VERSION_REQUIRED');
  const latest=(await db.query('SELECT max(number) AS n FROM app.versions WHERE act_id=$1',[actId])).rows[0].n;
  if(version.number!==latest) throw new HttpError(409,'LATEST_VERSION_REQUIRED');
  await requireCompleteCard(db,act);
  const assignee=await assigned(db,'RIRU_HEAD',act.res_id,[act.author_id,version.created_by]);
  const n=(await db.query('SELECT coalesce(max(number),0)+1 AS n FROM app.cycles WHERE act_id=$1',[actId])).rows[0].n;
  // Карточка фиксируется вместе с циклом: согласуется и синхронизируется именно этот снимок.
  const cycle=(await db.query(`INSERT INTO app.cycles(act_id,version_id,number,state,card_snapshot) VALUES($1,$2,$3,'RIRU_REVIEW',${cardSnapshotSql}) RETURNING *`,[actId,versionId,n])).rows[0];
  await db.query("UPDATE app.tasks SET status='DONE',completed_at=now() WHERE act_id=$1 AND app.task_role(role,cycle_id)='RIRU_ENGINEER' AND status='OPEN'",[actId]);
  await task(db,actId,cycle.id,'RIRU_HEAD',assignee);
  await db.query("UPDATE app.acts SET state='RIRU_REVIEW',workflow_version=2,revision=revision+1 WHERE id=$1",[actId]);
  await audit(db,actId,'SUBMITTED',{cycleId:cycle.id,versionId,checkId}); return cycle;
}
export async function decide(db:DB,taskId:string,decision:string,reason:string,viewedVersionId?:string) {
  const initial=requireValue((await db.query('SELECT act_id FROM app.tasks WHERE id=$1',[taskId])).rows[0]);
  const act=await lockAct(db,initial.act_id);
  const t=requireValue((await db.query('SELECT t.*,app.task_role(t.role,t.cycle_id) AS role FROM app.tasks t WHERE id=$1 FOR UPDATE',[taskId])).rows[0]);
  const user=(await db.query('SELECT app.uid() AS id, app.my_profile() AS profile')).rows[0];
  const effective=(await db.query('SELECT app.task_user($1,$2) AS id',[t.assignment_id,t.assignee_id])).rows[0].id;
  if(effective!==user.id) throw new HttpError(403,'NOT_ASSIGNEE');
  await role(db,t.role,act.res_id);
  if(t.status!=='OPEN'||t.role==='RIRU_ENGINEER') throw new HttpError(409,'TASK_NOT_OPEN');
  const cycle=requireValue((await db.query('SELECT * FROM app.cycles WHERE id=$1 AND closed_at IS NULL FOR UPDATE',[t.cycle_id])).rows[0],409,'CYCLE_CLOSED');
  if(viewedVersionId&&viewedVersionId!==cycle.version_id)throw new HttpError(409,'VERSION_MISMATCH','Вы просматриваете другую версию. Откройте версию действующей задачи.');
  const v=(await db.query('SELECT * FROM app.versions WHERE id=$1',[cycle.version_id])).rows[0];
  if([act.author_id,v.created_by].includes(user.id)) throw new HttpError(403,'SELF_APPROVAL');
  const previous=await db.query('SELECT 1 FROM app.decisions d JOIN app.tasks t ON t.id=d.task_id WHERE t.act_id=$1 AND d.actor_id=app.uid() AND (t.role<>$2 OR t.cycle_id=$3)',[act.id,t.role,cycle.id]);
  if(previous.rowCount) throw new HttpError(403,'MULTIPLE_ROLE_APPROVAL');
  if(decision==='RETURN'&&!reason.trim()) throw new HttpError(422,'RETURN_REASON_REQUIRED');
  if(decision==='APPROVE') {
    if((await db.query('SELECT 1 FROM app.comments WHERE task_id=$1 AND anchor IS NOT NULL LIMIT 1',[taskId])).rowCount)throw new HttpError(409,'CURRENT_REMARKS_REQUIRE_RETURN','Есть замечания к текущей версии. Верните акт с замечаниями.');
    const unresolved=await db.query("SELECT 1 FROM app.comments c JOIN app.cycles old ON old.version_id=c.version_id WHERE c.act_id=$1 AND c.author_id=app.uid() AND old.number<$2 AND coalesce((SELECT e.type FROM app.comment_events e WHERE e.comment_id=c.id AND e.version_id=$3 ORDER BY e.created_at DESC,e.id DESC LIMIT 1),'OPEN')<>'VERIFIED' LIMIT 1",[act.id,cycle.number,cycle.version_id]);
    if(unresolved.rowCount) throw new HttpError(409,'COMMENT_VERIFICATION_REQUIRED');
  }
  await db.query('INSERT INTO app.decisions(task_id,actor_id,actor_name,decision,reason) VALUES($1,app.uid(),$2,$3,$4)',[taskId,user.profile.name,decision,reason]);
  // Причина возврата становится общим замечанием, только если своих замечаний к версии нет: иначе одно и то же пришлось бы исправлять дважды.
  const ownRemarks=decision==='RETURN'&&!!(await db.query('SELECT 1 FROM app.comments WHERE task_id=$1 LIMIT 1',[taskId])).rowCount;
  if(decision==='RETURN'&&!ownRemarks) await db.query('INSERT INTO app.comments(act_id,version_id,task_id,author_id,text) VALUES($1,$2,$3,app.uid(),$4)',[act.id,cycle.version_id,taskId,reason]);
  await db.query("UPDATE app.tasks SET status='DONE',completed_at=now() WHERE id=$1",[taskId]);
  if(t.role==='RIRU_HEAD') {
    if(decision==='RETURN')await returned(db,act,cycle.id);
    else {const who=await assigned(db,'RES_HEAD',act.res_id,[act.author_id,v.created_by,user.id]);await task(db,act.id,cycle.id,'RES_HEAD',who);await move(db,act.id,cycle.id,'RES_REVIEW');}
  } else if(t.role==='RES_HEAD') {
    if(decision==='RETURN') await returned(db,act,cycle.id);
    else {
      const actors=(await db.query('SELECT actor_id FROM app.decisions d JOIN app.tasks t ON t.id=d.task_id WHERE t.cycle_id=$1',[cycle.id])).rows.map(r=>r.actor_id);
      const excluded=[act.author_id,v.created_by,user.id,...actors];
      for(const central of ['SUE','STP','GI']) {const who=await assigned(db,central,act.res_id,excluded); excluded.push(who); await task(db,act.id,cycle.id,central,who);}
      await move(db,act.id,cycle.id,'CENTRAL_REVIEW');
    }
  } else {
    const results=await db.query("SELECT d.decision FROM app.tasks t JOIN app.decisions d ON d.task_id=t.id WHERE t.cycle_id=$1 AND t.role IN ('SUE','STP','GI')",[cycle.id]);
    const rejected=results.rows.some(r=>r.decision==='RETURN');
    if(results.rowCount===3) {
      if(rejected) await returned(db,act,cycle.id);
      else {
        await move(db,act.id,cycle.id,'APPROVED',true);
        await db.query("UPDATE app.releases SET status='SUPERSEDED' WHERE act_id=$1 AND status IN ('CURRENT','UNDER_REVISION')",[act.id]);
        await db.query("INSERT INTO app.releases(act_id,version_id,cycle_id,status) VALUES($1,$2,$3,'CURRENT')",[act.id,cycle.version_id,cycle.id]);
        await notify(db,act.id,act.author_id,'APPROVED');
      }
    } else await move(db,act.id,cycle.id,rejected?'CENTRAL_COLLECTING':'CENTRAL_REVIEW');
  }
  await audit(db,act.id,'DECISION',{taskId,decision});
  return (await db.query('SELECT * FROM app.acts WHERE id=$1',[act.id])).rows[0];
}
export async function closeCollection(db:DB,actId:string,reason:string) {
  const act=await lockAct(db,actId); await role(db,'PROCESS_ADMIN',act.res_id);
  const cycle=requireValue((await db.query("SELECT * FROM app.cycles WHERE act_id=$1 AND closed_at IS NULL AND state IN ('CENTRAL_REVIEW','CENTRAL_COLLECTING') FOR UPDATE",[actId])).rows[0],409,'NO_COLLECTION');
  const pending=await db.query("SELECT * FROM app.tasks WHERE cycle_id=$1 AND status='OPEN'",[cycle.id]);
  if(!pending.rowCount||pending.rows.some(t=>new Date(t.due_at)>new Date())) throw new HttpError(409,'COLLECTION_NOT_EXPIRED');
  await db.query("UPDATE app.tasks SET status='CANCELLED',completed_at=now() WHERE cycle_id=$1 AND status='OPEN'",[cycle.id]);
  await returned(db,act,cycle.id); await audit(db,actId,'COLLECTION_CLOSED',{reason,pendingTasks:pending.rows.map(t=>t.id)});
  return {state:'RETURNED'};
}
