import assert from 'node:assert/strict';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import type pg from 'pg';
// Existing downstream regression scenarios start at the RES stage. Reach that
// precondition through the real first review, never by changing workflow in SQL.
export async function completeRiruReview(pending:PromiseLike<request.Response>,app:any,tokens:Record<string,string>,owner:pg.Pool){
 const response=await pending;
 // These older suites use minimal DOCX without TU fields. Only the isolated
 // owner fixture can mark them legacy; the runtime/API cannot disable the gate.
 if(response.status===200&&(response as unknown as {req:{path:string}}).req.path==='/api/v1/acts')await owner.query('UPDATE app.acts SET tu_check_required=false WHERE id=$1',[response.body.id]);
 if(response.status===200&&(response as unknown as {req:{path:string}}).req.path.endsWith('/submit')){
  const tasks=await request(app).get('/api/v1/tasks/mine').set('Authorization','Bearer '+tokens['riru-head']);assert.equal(tasks.status,200);
  const task=tasks.body.find((t:any)=>t.cycle_id===response.body.id&&t.role==='RIRU_HEAD');assert.ok(task,'First review must exist before downstream fixture');
  const decision=await request(app).post(`/api/v1/tasks/${task.id}/decision`).set('Authorization','Bearer '+tokens['riru-head']).set('Idempotency-Key',randomUUID()).send({decision:'APPROVE',versionId:response.body.version_id});assert.equal(decision.status,200,JSON.stringify(decision.body));
 }
 return response;
}
