import test from 'node:test';
import assert from 'node:assert/strict';
import {emailSchema,localProfileSchema} from '../apps/api/src/local-auth.js';

const profile={name:'Учебный сотрудник',login:'synthetic.user',email:'user@example.test',expectedRevision:0,assignments:[{role:'TECH_ADMIN',resId:null}]};
test('Account email is trimmed, case-normalized and rejects malformed addresses',()=>{
  assert.equal(emailSchema.parse('  Employee@Example.Test  '),'employee@example.test');
  for(const value of ['','not-an-email','person @example.test','person@example.test\nother@example.test'])assert.equal(emailSchema.safeParse(value).success,false);
});
test('Profile edits retain scope validation and reject duplicate roles',()=>{
  assert.equal(localProfileSchema.safeParse(profile).success,true);
  assert.equal(localProfileSchema.safeParse({...profile,assignments:[{role:'RIRU_ENGINEER',resId:null}]}).success,false);
  assert.equal(localProfileSchema.safeParse({...profile,assignments:[profile.assignments[0],profile.assignments[0]]}).success,false);
});
test('Profile edits cannot set identity, deletion, passwords or bypass concurrency checks',()=>{
  for(const extra of [{issuer:'https://elsewhere.test'},{subject:'someone'},{active:true},{deleted_at:null},{password:'unexpected'}])assert.equal(localProfileSchema.safeParse({...profile,...extra}).success,false);
  assert.equal(localProfileSchema.safeParse({...profile,expectedRevision:-1}).success,false);
});
