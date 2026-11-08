import test from 'node:test';
import assert from 'node:assert/strict';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
test('versioned prompt templates preserve all three topics and ordered rounds',()=>{
  const templates=promptTemplates();
  assert.equal(templates.length,3);
  assert.equal(new Set(templates.map(t=>t.id+'@'+t.version)).size,3);
  assert.equal(templates.find(t=>t.name==='每日热点观察').prompts.length,2);
  for(const t of templates){assert.equal(t.version,1);assert.ok(t.prompts.every(p=>p.length>100));}
  const technology=templates.find(t=>t.id==='daily-technology');
  assert.equal(technology.prompts.length,1);
  const prompt=technology.prompts[0];
  assert.ok(prompt.length<2500,'technology prompt stays focused enough for one research turn');
  assert.match(prompt,/24.{0,5}小时/);
  assert.match(prompt,/72.{0,5}小时/);
  assert.match(prompt,/AI.{0,3}大模型/);
  assert.match(prompt,/开源.{0,5}项目/);
  assert.doesNotMatch(prompt,/股票市场重大事件|投资判断线索/);
  assert.match(prompt,/候选/);
  assert.match(prompt,/JSON Schema/);
  assert.match(prompt,/【固定 8 条】/);
  assert.match(prompt,/7 天/);
  assert.match(prompt,/半导体/);
  assert.match(prompt,/不收录.{0,60}新能源/);
  assert.match(prompt,/不收录.{0,100}消费电子/);
  assert.doesNotMatch(prompt,/单纯 AI 模型发布、普通开源项目更新不作为本话题重点/);
});
