import test from 'node:test';
import assert from 'node:assert/strict';
import {registryFilters,registryItem} from '../apps/api/src/registry.js';
import {timelineEvents} from '../apps/api/src/timeline.js';
test('Registry filters reject unbounded/unknown inputs and inverted dates',()=>{
  assert.equal(registryFilters.parse({q:'  опора  ',mine:'true',limit:'20'}).q,'опора');assert.throws(()=>registryFilters.parse({from:'2026-11-02',to:'2026-11-01'}));assert.throws(()=>registryFilters.parse({limit:'1000'}));assert.throws(()=>registryFilters.parse({role:'SUE'}));
});
test('Flow retains parallel independent decisions and a visible return to RIRU',()=>{
  const row:any={id:'a',state:'RETURNED',display_status:'REWORK',stage:'RIRU',route_tasks:[{role:'RES_HEAD',status:'DONE',decision:'APPROVE'},{role:'SUE',status:'DONE',decision:'RETURN',commentCount:1},{role:'STP',status:'DONE',decision:'APPROVE'},{role:'GI',status:'CANCELLED'}],comment_count:1};
  const item=registryItem(row);assert.equal(item.route.riru.current,true);assert.equal(item.route.res.status,'completed');assert.deepEqual(item.route.parallel.map((s:any)=>s.status),['returned','completed','no_decision']);assert.equal(item.route.result.label,'Возврат');
});
test('Timeline has stable ordering and links instead of duplicated audit decision events',()=>{
  const data:any={id:'a',act_number:'A',contract_number:'C',created_at:'2026-11-01T10:00:00Z',author:{name:'Автор'},versions:[{id:'v',number:1,created_at:'2026-11-01T10:01:00Z',creator:{name:'Автор'}}],cycles:[{id:'c',number:1,version_id:'v',version_number:1,started_at:'2026-11-01T10:02:00Z',state:'RETURNED',closed_at:'2026-11-01T10:03:00Z'}],tasks:[{id:'t',cycle_id:'c',role:'RES_HEAD',decision:'RETURN',decision_id:'d',decided_at:'2026-11-01T10:03:00Z',actor_id:'u',actor_name:'Начальник',reason:'Ошибка'}],comments:[{id:'cm',task_id:'t',author_id:'u',version_id:'v',created_at:'2026-11-01T10:03:00Z',text:'Ошибка'}],comment_events:[],releases:[],audit:[{id:'audit-d',action:'DECISION',created_at:'2026-11-01T10:03:00Z',details:{taskId:'t'}}]};
  const events=timelineEvents(data);assert.deepEqual(events.map(e=>e.type),['CREATED','VERSION_CREATED','SUBMITTED','DECISION','COMMENT_ADDED','RETURNED']);assert.equal(events[4].commentId,'cm');assert.equal(events[3].actor.name,'Начальник');
});
