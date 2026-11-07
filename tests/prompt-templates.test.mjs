import test from 'node:test';
import assert from 'node:assert/strict';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
test('versioned prompt templates preserve all three topics and ordered rounds',()=>{
  const templates=promptTemplates();
  assert.equal(templates.length,3);
  assert.equal(new Set(templates.map(t=>t.id+'@'+t.version)).size,3);
  assert.equal(templates.find(t=>t.name==='每日热点观察').prompts.length,2);
  for(const t of templates){assert.equal(t.version,1);assert.ok(t.prompts.every(p=>p.length>100));}
});
