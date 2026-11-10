import test from 'node:test';
import assert from 'node:assert/strict';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
import {Ajv} from 'ajv';
import {RESEARCH_SCHEMA} from '../dist/apps/server/src/news/report-schema.js';
test('versioned prompt templates preserve all three topics and ordered rounds',()=>{
  const templates=promptTemplates();
  assert.equal(templates.length,3);
  assert.equal(new Set(templates.map(t=>t.id+'@'+t.version)).size,3);
  assert.equal(templates.find(t=>t.name==='每日热点观察').prompts.length,2);
  const opensource=templates.find(t=>t.id==='daily-opensource');
  assert.equal(opensource.version,1);
  assert.equal(opensource.prompts.length,2);
  assert.match(opensource.prompts[0],/候选|发现/);
  assert.match(opensource.prompts[1],/JSON Schema/);
  assert.match(opensource.prompts[1],/社区关注|社区热度/);
  for(const field of ['用途：','主要技术栈：','技术要点：','近期证据：'])
    assert.ok(opensource.prompts[1].includes(field),field);
  assert.match(opensource.prompts[1],/有依据|核实|证据/);
  assert.doesNotMatch(opensource.prompts.join('\n'),/【固定 (8|10) 条】/);
  for(const t of templates){assert.equal(t.version,1);assert.ok(t.prompts.every(p=>p.length>100));}
  const technology=templates.find(t=>t.id==='daily-technology');
  assert.equal(technology.prompts.length,2);
  const [discovery,analysis]=technology.prompts;
  const prompt=technology.prompts.join('\n');
  assert.match(discovery,/候选/);
  assert.match(discovery,/不生成最终日报/);
  assert.match(analysis,/JSON Schema/);
  assert.match(prompt,/24.{0,5}小时/);
  assert.match(prompt,/72.{0,5}小时/);
  assert.match(prompt,/AI.{0,3}大模型/);
  assert.match(prompt,/开源.{0,5}项目/);
  assert.equal(technology.name,"每日科技投资简报");
  assert.equal(technology.topic,"每日科技投资简报");
  assert.match(prompt,/投资判断/);
  assert.match(prompt,/股票市场/);
  assert.match(prompt,/影响逻辑/);
  assert.match(prompt,/候选/);
  assert.match(prompt,/JSON Schema/);
  assert.doesNotMatch(prompt,/【固定 (8|10) 条】/);
  assert.match(analysis,/最多 10 条/);
  assert.match(analysis,/少于 10 条|实际合格/);
  assert.match(prompt,/7 天/);
  assert.match(prompt,/半导体/);
  assert.match(prompt,/风险|反证/);
  assert.match(prompt,/details/);
  assert.match(prompt,/evidenceRefs/);
  assert.match(analysis,/每条入选的投资相关事件/);
  assert.match(analysis,/不得省略整个 details|不应成为省略整个 details/);
  assert.match(prompt,/actual|实际值/);
  assert.doesNotMatch(prompt,/单纯 AI 模型发布、普通开源项目更新不作为本话题重点/);
});
test('headlines v1 keeps two rounds and asks for source-backed news JSON',()=>{
  const template=promptTemplates().find(t=>t.id==='daily-headlines');
  assert.equal(template.version,1);
  assert.equal(template.prompts.length,2);
  const [discovery,final]=template.prompts;
  for(const field of ['事件发生时间','来源发布时间','北京时间','事件类型','数据时间','统计区间','原始来源','原文摘录'])assert.ok(discovery.includes(field),field);
  assert.match(discovery,/10.{0,3}15/);
  assert.match(discovery,/新进展|实质变化/);
  assert.match(final,/JSON Schema/);
  assert.match(final,/5.{0,3}8/);
  assert.match(final,/最多 10 条/);
  assert.match(final,/少于 5 条/);
  assert.match(final,/1.{0,3}5 分/);
  assert.match(final,/同一事件/);
  for(const field of ['factSummary','analysis','evidenceQuote','url','category','importance','details.kind','background','keyFacts','timeline','positions','impacts','uncertainties','watchpoints','evidenceRefs','evidence'])assert.ok(final.includes(field),field);
  assert.match(final,/confirmed.*statement.*reported.*estimate.*inference/s);
  assert.match(final,/observed.*analysis/s);
  assert.match(final,/date.*datetime.*approximate/s);
  assert.match(final,/2500/);
  assert.match(final,/每条入选事件都应填写 items\[\]\.details/);
  assert.match(final,/剔除候选/);
  assert.match(final,/不独立抓取|不独立核验/);
  assert.doesNotMatch(final,/【固定 (8|10) 条】/);
});
test('headlines news examples match the actual research schema, including omitted optional sections',()=>{
  const validate=new Ajv({strict:true}).compile(RESEARCH_SCHEMA);
  const base={title:'2026-11-10 北京时间最近 24 小时热点',items:[{url:'https://example.com/news',category:'industry',importance:4,factSummary:'主管部门发布新规，适用范围覆盖全国。',analysis:null,evidenceQuote:'主管部门公布了新的实施规则'}]};
  assert.equal(validate(base),true,JSON.stringify(validate.errors));
  for(const details of [
    {kind:'news',background:'此前处于征求意见阶段。',keyFacts:[{name:'适用范围',value:'全国',nature:'confirmed',evidenceRefs:['notice']}],timeline:[{time:'2026-11-10',precision:'date',event:'正式发布',evidenceRefs:['notice']}],evidence:[{id:'notice',name:'正式通知',url:'https://example.com/notice',supports:'发布时间与范围'}]},
    {kind:'news',background:'市场数据公布。',positions:[{actor:'主管部门',statement:'分阶段实施',form:'paraphrase',evidenceRefs:['notice']}],impacts:[{description:'实施效果待观察',status:'analysis'}],evidence:[{id:'notice',name:'正式通知',url:'https://example.com/notice',supports:'主管部门表态'}]},
  ])assert.equal(validate({...base,items:[{...base.items[0],details}]}),true,JSON.stringify(validate.errors));
});
