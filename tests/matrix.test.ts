import test from 'node:test';
import assert from 'node:assert/strict';
import {deriveMatrix} from '../apps/api/src/matrix.js';
const base=()=>({id:'act',state:'DRAFT',res_name:'Учебный РЭС',as_of:'2026-10-31T12:00:00Z',cycles:[],versions:[],tasks:[],comments:[],releases:[]});
test('Matrix: draft has four unstarted rows, not fictional assignees/decisions',()=>{
  const matrix=deriveMatrix(base());assert.equal(matrix.rows.length,4);assert.equal(matrix.cycle,null);
  for(const row of matrix.rows){assert.equal(row.status,'NOT_STARTED');assert.equal(row.person,null);assert.equal(row.decidedAt,null);assert.equal(row.elapsedSeconds,null);}
});
test('Matrix: expired pending task is overdue; completed duration freezes at decision',()=>{
  const data:any={...base(),state:'RES_REVIEW',cycles:[{id:'c',number:1,version_id:'v',state:'RES_REVIEW',closed_at:null}],versions:[{id:'v',number:1}],tasks:[{id:'t',cycle_id:'c',role:'RES_HEAD',status:'OPEN',received_at:'2026-10-31T09:00:00Z',due_at:'2026-10-31T10:00:00Z'}]};
  const pending=deriveMatrix(data);assert.equal(pending.overall,'OVERDUE');assert.equal(pending.rows[0].elapsedSeconds,10800);assert.equal(pending.rows[0].overdue,true);assert.equal(pending.rows[0].decidedAt,null);
  data.tasks[0]={...data.tasks[0],status:'DONE',decision:'APPROVE',decided_at:'2026-10-31T11:00:00Z',actor_name:'Учебный согласующий'};
  const completed=deriveMatrix(data);assert.equal(completed.rows[0].elapsedSeconds,7200);assert.equal(completed.rows[0].overdue,false);assert.equal(completed.rows[0].wasOverdue,true);
});
test('Matrix: cancelled missing decision stays absent and revoked publication overrides approval',()=>{
  const data:any={...base(),cycles:[{id:'c',number:1,version_id:'v',state:'APPROVED',closed_at:'2026-10-31T11:00:00Z'}],versions:[{id:'v',number:1}],tasks:[{id:'t',cycle_id:'c',role:'SUE',status:'CANCELLED',received_at:'2026-10-31T09:00:00Z',completed_at:'2026-10-31T11:00:00Z',due_at:'2026-10-31T10:00:00Z'}],releases:[{cycle_id:'c',status:'REVOKED'}]};
  const matrix=deriveMatrix(data);assert.equal(matrix.overall,'REVOKED');assert.equal(matrix.rows[1].status,'NO_DECISION');assert.equal(matrix.rows[1].decidedAt,null);assert.equal(matrix.rows[1].elapsedSeconds,7200);
  assert.throws(()=>deriveMatrix(data,'foreign-cycle'),/CYCLE_NOT_FOUND/);
});
