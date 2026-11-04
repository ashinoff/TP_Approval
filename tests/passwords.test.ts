import test from 'node:test';
import assert from 'node:assert/strict';
import {hashPassword,checkPassword} from '../apps/api/src/passwords.js';

test('Local passwords: random salts, verification and malformed hashes',async()=>{
  const password='Synthetic-password-2026';
  const a=await hashPassword(password),b=await hashPassword(password);
  assert.notEqual(a,b);assert.equal(a.includes(password),false);
  assert.equal(await checkPassword(password,a),true);
  assert.equal(await checkPassword(password+'x',a),false);
  assert.equal(await checkPassword(password,'scrypt-v1:malformed'),false);
});
