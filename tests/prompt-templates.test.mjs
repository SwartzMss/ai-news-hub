import test from 'node:test';
import assert from 'node:assert/strict';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
test('prompt templates expose the latest version of each topic',()=>{
  const templates=promptTemplates();
  assert.equal(templates.length,3);
  assert.equal(new Set(templates.map(t=>t.id+'@'+t.version)).size,3);
  assert.equal(templates.find(t=>t.name==='每日热点观察').prompts.length,2);
  const opensource=templates.find(t=>t.id==='daily-opensource');
  assert.equal(opensource.version,2);
  assert.equal(opensource.prompts.length,2);
  assert.match(opensource.prompts.join('\n'),/GitHub Trending/);
  assert.match(opensource.prompts.join('\n'),/GitHub Releases/);
  assert.match(opensource.prompts.join('\n'),/Hugging Face/);
  assert.match(opensource.prompts.join('\n'),/新创建|新发布/);
  assert.match(opensource.prompts.join('\n'),/上手优先级/);
  for(const t of templates)assert.ok(t.prompts.every(p=>p.length>100));
});
