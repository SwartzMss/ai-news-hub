import test from 'node:test';
import assert from 'node:assert/strict';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
import {Ajv} from 'ajv';
import {HEADLINES_RESEARCH_SCHEMA,RESEARCH_SCHEMA} from '../dist/apps/server/src/news/report-schema.js';
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
  for(const field of ['researchArea','factSummary','analysis','evidenceQuote','details','evidenceRefs'])
    assert.ok(opensource.prompts[1].includes(field),field);
  for(const area of ['agent','rust','multimedia','performance_security','decentralized'])
    assert.ok(opensource.prompts.join(' ').includes(area),area);
  assert.match(opensource.prompts[1],/方向各自精选 0～2 个/);
  assert.match(opensource.prompts[1],/不设全局目标数量/);
  assert.match(opensource.prompts[1],/title.*北京时间/);
  assert.ok(opensource.prompts.join('').length < 3000, 'open-source prompt should stay concise');
  assert.match(opensource.prompts[1],/有依据|核实|证据/);
  assert.doesNotMatch(opensource.prompts.join('\n'),/【固定 (8|10) 条】/);
  for(const t of templates){assert.equal(t.version,1);assert.ok(t.prompts.every(p=>p.length>100));}
  const technology=templates.find(t=>t.id==='daily-technology');
  assert.equal(technology.version,1);
  assert.equal(technology.prompts.length,2);
  const [discovery,analysis]=technology.prompts;
  const prompt=technology.prompts.join('\\n');
  assert.equal(technology.name,"每日科技投资简报");
  assert.equal(technology.topic,"每日科技投资简报");
  assert.match(discovery,/只研究三个方向/);
  assert.match(discovery,/AI 产业链/);
  assert.match(discovery,/光模块与光通信/);
  assert.match(discovery,/半导体/);
  assert.match(discovery,/Nasdaq/);
  assert.match(discovery,/NYSE/);
  assert.match(discovery,/8～12 条候选/);
  assert.match(discovery,/不生成最终日报/);
  assert.match(analysis,/5～8 条/);
  assert.match(analysis,/最多 10 条/);
  assert.match(analysis,/不设方向配额/);
  assert.match(analysis,/NASDAQ、NYSE、SSE、SZSE、HKEX、OTHER/);
  assert.match(analysis,/ai_industry_chain、optical_communications、semiconductor/);
  assert.match(analysis,/订单、出货、ASP、产能、毛利率、收入、现金流/);
  assert.match(analysis,/事件变化 → 产业环节 → 公司 → 经营指标 → 盈利\/现金流 → 估值与市场预期/);
  assert.match(analysis,/每条必须提供 details/);
  assert.match(analysis,/evidenceRefs/);
  assert.match(analysis,/2500 字节/);
  assert.match(prompt,/24 小时/);
  assert.match(prompt,/72 小时/);
  assert.match(prompt,/7 天/);
  assert.match(prompt,/风险与反证/);
  assert.doesNotMatch(prompt,/机器人、汽车、能源、通信等有实质科技投资增量的领域/);
  assert.doesNotMatch(prompt,/覆盖 AI\/大模型\/Agent\/开源项目、半导体与算力/);
  assert.doesNotMatch(prompt,/股票市场、科技股与估值，以及/);
});
test('headlines v1 focuses on social platform trends and evidence-backed editorial tags',()=>{
  const template=promptTemplates().find(t=>t.id==='daily-headlines');
  assert.equal(template.version,1);
  assert.equal(template.prompts.length,2);
  const [discovery,final]=template.prompts;
  for(const platform of ['微博','抖音','B站','小红书','知乎','X','Reddit'])assert.ok(discovery.includes(platform),platform);
  assert.match(discovery,/最近 24 小时/);
  assert.match(discovery,/10–15/);
  assert.match(discovery,/不输出最终 JSON/);
  assert.match(discovery,/平台不可访问时如实说明/);
  assert.match(discovery,/普通政策发布/);
  assert.match(final,/5–8 条/);
  assert.match(final,/最多 10 条/);
  assert.match(final,/importance 为 1–5/);
  assert.match(final,/不要只按热度排序/);
  for(const field of ['trendTags','contentTags','trendSignals','publicDiscussion','contentSuitability','contentReason','contentAngles','evidenceRefs','evidence'])assert.ok(final.includes(field),field);
  for(const category of ['social_event','entertainment','tech_digital','sports','film_animation','gaming','finance_consumption','internet_culture','lifestyle_emotion','international_topic','other'])assert.ok(final.includes(category),category);
  for(const tag of ['cross_platform','single_platform','controversial','viral_video','sustained_discussion','short_video','story_reversal','emotional_resonance','not_suitable'])assert.ok(final.includes(tag),tag);
  assert.match(final,/至少有一条可追溯的平台传播信号/);
  assert.match(final,/不得生成示例评论/);
  assert.match(final,/6000 字节/);
  assert.doesNotMatch(final,/全球经济与金融市场.*加密货币与数字资产/s);
  assert.doesNotMatch(final,/国际热点.*单独设配额/);
});
test('headlines strict schema requires category, news details, trend evidence and content assessment',()=>{
  const validate=new Ajv({strict:true}).compile(HEADLINES_RESEARCH_SCHEMA);
  const base={title:'2026-11-13 北京时间最近 24 小时网络热点',items:[{
    url:'https://example.com/event',category:'social_event',importance:4,
    factSummary:'某话题在微博和抖音出现跨平台讨论。',
    analysis:null,evidenceQuote:'A verifiable public platform discussion',
    details:{
      kind:'news',background:'该话题在最近 24 小时出现新的讨论。',
      trendTags:['cross_platform','controversial','viral_video'],
      contentTags:['short_video','debate'],
      trendSignals:[
        {platform:'weibo',contentType:'hashtag',metric:'rank',value:'热榜第 3 位',observedAt:'2026-11-13T06:00:00+08:00',evidenceType:'direct',evidenceRefs:['weibo']},
        {platform:'douyin',contentType:'video',metric:'views',value:'公开页面显示热门视频，未披露完整数据',observedAt:'2026-11-13T06:30:00+08:00',evidenceType:'reported',evidenceRefs:['douyin']},
      ],
      contentSuitability:'recommended',contentReason:'有清晰的观点冲突和可解释的背景。',
      contentAngles:[{angle:'争议背后的不同观点',suggestedTitle:'为什么这个话题引发讨论？',hook:'真正的分歧在哪里？',corePoints:['先还原事实'],evidenceRefs:['weibo']}],
      publicDiscussion:{summary:'公开讨论中存在不同观点。',evidenceRefs:['discussion'],viewpoints:[{label:'观点 A',summary:'支持这一做法。',sentiment:'supportive',evidenceRefs:['discussion']}],controversies:[{topic:'责任归属',sides:['观点 A','观点 B'],evidenceRefs:['discussion']}],representativeComments:[{platform:'weibo',quote:'这是一条可核实的公开评论。',evidenceRefs:['discussion']}]},
      evidence:[
        {id:'weibo',name:'微博话题页',url:'https://example.com/weibo',supports:'微博热榜排名'},
        {id:'douyin',name:'抖音视频页',url:'https://example.com/douyin',supports:'抖音视频讨论'},
        {id:'discussion',name:'公开讨论页',url:'https://example.com/discussion',supports:'公开观点和评论'},
      ],
    },
  }]};
  assert.equal(validate(base),true,JSON.stringify(validate.errors));
  const missingDetails=structuredClone(base);delete missingDetails.items[0].details;
  assert.equal(validate(missingDetails),false);
  const wrongCategory=structuredClone(base);wrongCategory.items[0].category='industry';
  assert.equal(validate(wrongCategory),false);
  const noSignal=structuredClone(base);noSignal.items[0].details.trendSignals=[];
  assert.equal(validate(noSignal),false);
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
