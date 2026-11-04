import test from 'node:test';
import assert from 'node:assert/strict';
import {setupStandalone} from '../scripts/setup-standalone.js';

test('Standalone setup still rejects an owner runtime login and an empty DB password before connecting',async()=>{
  const env={AUTH_MODE:'local',MIGRATION_DATABASE_URL:'postgres://postgres:synthetic-owner@127.0.0.1:1/synthetic'};
  await assert.rejects(setupStandalone({...env,DATABASE_URL:'postgres://admin:synthetic-runtime@127.0.0.1:1/synthetic'}),/укажите пользователя tp_runtime/);
  await assert.rejects(setupStandalone({...env,DATABASE_URL:'postgres://tp_runtime@127.0.0.1:1/synthetic'}),/укажите пароль пользователя tp_runtime/);
});
