import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportMarkdown } from '../dist/apps/server/src/news/report.js';

const candidates = [{ id: 'article-a', title: 'A genuine fixture release announcement', originalUrl: 'https://github.blog/a?utm_source=rss', canonicalUrl: 'https://github.blog/a', sourceName: 'GitHub Blog', publishedAt: '2026-11-02T10:00:00.000Z', eventAt: null, fetchedAt: '2026-11-03T00:00:00.000Z', excerpt: 'Source-provided fixture summary.' }];
const metadata = { reportId: 'report-a', runId: 'run-a', reportDate: '2026-11-03', collectedAt: '2026-11-03T00:00:00.000Z' };
const proposal = () => ({ title: 'Fixture daily report', items: [{ articleId: 'article-a', category: 'opensource', importance: 4, factSummary: '来源宣布发布更新。', analysis: '这可能有助于开发者。', evidenceQuote: 'A genuine fixture release announcement' }] });
const investmentDetails = () => ({kind:'investment',background:'公司披露新一季财报，较此前指引有所变化。',metrics:[{name:'季度收入',value:'12.4',unit:'亿美元',period:'2026 Q3',basis:'actual',evidenceRefs:['filing']}],supplyChain:[{segment:'服务器内存',direction:'需求增加',reason:'新产品配置提高单机用量',relationship:'potential'}],investmentLogic:'若订单兑现，收入和毛利率可能改善。',watchpoints:['下季订单量'],risks:['客户认证延迟'],evidence:[{id:'filing',name:'公司财报',url:'https://example.com/filing',supports:'季度收入实际值'}]});
const newsDetails = () => ({kind:'news',background:'该政策此前处于征求意见阶段，本次正式发布。',keyFacts:[{name:'生效范围',value:'全国',nature:'confirmed',evidenceRefs:['notice']}],timeline:[{time:'2026-11-03',precision:'date',event:'主管部门发布正式通知',evidenceRefs:['notice']}],positions:[{actor:'主管部门',statement:'将分阶段实施',form:'paraphrase',evidenceRefs:['notice']}],impacts:[{description:'企业需更新申报流程',status:'analysis'}],uncertainties:['实施细则尚未公布'],watchpoints:['查看后续实施细则'],evidence:[{id:'notice',name:'正式通知',url:'https://example.com/notice',supports:'政策发布时间与范围'}]});
const socialNewsDetails = () => ({
 kind:'news',
 background:'该话题在最近 24 小时内于多个社交平台出现讨论。',
 trendTags:['cross_platform','controversial','viral_video'],
 contentTags:['short_video','debate'],
 trendSignals:[
  {platform:'weibo',contentType:'hashtag',metric:'rank',value:'热榜第 3 位',observedAt:'2026-11-13T06:00:00+08:00',evidenceType:'direct',evidenceRefs:['weibo']},
  {platform:'douyin',contentType:'video',metric:'views',value:'热门视频，未披露完整播放量',observedAt:'2026-11-13T06:30:00+08:00',evidenceType:'reported',evidenceRefs:['douyin']},
 ],
 publicDiscussion:{
  summary:'公开讨论围绕责任归属和事件处理方式展开。',
  evidenceRefs:['discussion'],
  viewpoints:[{label:'支持观点',summary:'认为处理方式合理。',sentiment:'supportive',evidenceRefs:['discussion']}],
  controversies:[{topic:'责任归属',sides:['观点 A','观点 B'],evidenceRefs:['discussion']}],
  representativeComments:[{platform:'weibo',quote:'这是一条有公开来源的代表性评论。',evidenceRefs:['discussion']}],
 },
 contentSuitability:'recommended',
 contentReason:'事件有可核实事实、清晰争议和解释空间。',
 contentAngles:[{angle:'从争议焦点切入',suggestedTitle:'为什么这个话题引发讨论？',hook:'真正的分歧在哪里？',corePoints:['还原已确认事实','梳理不同观点'],evidenceRefs:['discussion']}],
 evidence:[
  {id:'weibo',name:'微博话题页',url:'https://example.com/weibo',supports:'微博热榜排名'},
  {id:'douyin',name:'抖音视频页',url:'https://example.com/douyin',supports:'视频传播情况'},
  {id:'discussion',name:'公开讨论页',url:'https://example.com/discussion',supports:'讨论观点和代表性评论'},
 ],
});
test('news details survive report construction and Markdown without changing investment details',()=>{
 const p=proposal();p.items[0].details=newsDetails();
 const report=buildReport(JSON.stringify(p),candidates,metadata);
 assert.deepEqual(report.items[0].details,p.items[0].details);
 assert.match(reportMarkdown(report),/主管部门发布正式通知/);
 const investment=proposal();investment.items[0].details=investmentDetails();
 assert.equal(buildReport(JSON.stringify(investment),candidates,metadata).items[0].details.kind,'investment');
});
test('social headline details retain evidence-backed signals, discussion tags and content angles',()=>{
 const p=proposal();p.items[0].category='social_event';p.items[0].details=socialNewsDetails();
 const report=buildReport(JSON.stringify(p),candidates,metadata);
 assert.deepEqual(report.items[0].details,p.items[0].details);
 const markdown=reportMarkdown(report);
 assert.match(markdown,/平台传播信号/);
 assert.match(markdown,/公众讨论/);
 assert.match(markdown,/内容创作评估/);
 assert.match(markdown,/微博/);
});
test('social trend tags must match platform and discussion evidence',()=>{
 for(const mutate of [
  d=>{d.trendSignals=d.trendSignals.slice(0,1);},
  d=>{d.publicDiscussion.controversies=[];},
  d=>{d.trendTags.push('sustained_discussion');},
  d=>{d.trendSignals[0].evidenceRefs=['missing'];},
  d=>{d.contentAngles[0].evidenceRefs=['missing'];},
  d=>{d.contentSuitability='not_recommended';},
 ]){
  const p=proposal();p.items[0].category='social_event';p.items[0].details=socialNewsDetails();mutate(p.items[0].details);
  assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata));
 }
});
test('news details reject missing evidence references, duplicate IDs and unsafe URLs',()=>{
 for(const mutate of [d=>{d.keyFacts[0].evidenceRefs=['missing'];},d=>{d.evidence.push({...d.evidence[0]});},d=>{d.evidence[0].url='http://localhost/notice';}]){
  const p=proposal();p.items[0].details=newsDetails();mutate(p.items[0].details);
  assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata));
 }
});
test('investment details survive report construction and appear in Markdown',()=>{
 const p=proposal();p.items[0].details=investmentDetails();
 const report=buildReport(JSON.stringify(p),candidates,metadata);
 assert.deepEqual(report.items[0].details,p.items[0].details);
 assert.match(reportMarkdown(report),/季度收入/);
});
test('investment details reject unlinked metrics and unsafe evidence URLs',()=>{
 for(const mutate of [d=>{d.metrics[0].evidenceRefs=['missing'];},d=>{d.evidence[0].url='http://localhost/filing';}]){
  const p=proposal();p.items[0].details=investmentDetails();mutate(p.items[0].details);
  assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata));
 }
});
test('investment details stay within the fixed-turn output budget',()=>{
 const p=proposal();p.items[0].details=investmentDetails();p.items[0].details.background='背景'.repeat(390);
 assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata));
});
test('authoritative URLs/times are added by Backend and analysis stays separate', () => {
  const report = buildReport(JSON.stringify(proposal()), candidates, metadata);
  assert.equal(report.items[0].source.eventAt, null);
  assert.equal(report.items[0].source.publishedAt, candidates[0].publishedAt);
  assert.equal(report.items[0].source.canonicalUrl, candidates[0].canonicalUrl);
  assert.equal(report.reviewStatus, 'pending');
  assert.equal(report.items[0].verification, 'source_only');
});
for (const [name, mutate] of [
  ['invented article', (p) => { p.items[0].articleId = 'invented'; }],
  ['invented URL', (p) => { p.items[0].sourceUrl = 'https://invented.example'; }],
  ['invented timestamp', (p) => { p.items[0].publishedAt = '2026-11-03T00:00:00Z'; }],
  ['invented engagement', (p) => { p.items[0].likes = 1000; }],
  ['duplicate article', (p) => { p.items.push({ ...p.items[0] }); }],
  ['untraceable quote', (p) => { p.items[0].evidenceQuote = 'This never appeared in the source'; }],
  ['missing summary', (p) => { delete p.items[0].factSummary; }],
]) {
  test(`${name} cannot pass report validation`, () => {
    const p = proposal(); mutate(p);
    assert.throws(() => buildReport(JSON.stringify(p), candidates, metadata));
  });
}
test('Markdown is generated safely and invalid JSON fails closed', () => {
  const p = proposal(); p.items[0].analysis = '<script>alert(1)</script>';
  const report = buildReport(JSON.stringify(p), candidates, metadata);
  assert.ok(!reportMarkdown(report).includes('<script>'));
  assert.throws(() => buildReport('```json\n{}\n```', candidates, metadata), { code: 'report_invalid_json' });
});
const projectDetails=()=>({kind:'project',overview:'帮助开发者在本地检索代码。',change:{summary:'发布新的索引功能。',version:'1.2',publishedAt:'2026-11-03',evidenceRefs:['release']},technical:[{description:'使用增量索引。',evidenceRefs:['release']}],evaluation:[{description:'适合先在小型仓库试用。',nature:'analysis'}],evidence:[{id:'release',name:'发布说明',url:'https://example.com/release',supports:'索引功能及版本'}]});
test('project details survive report construction and Markdown',()=>{
 const p=proposal();p.items[0].details=projectDetails();const report=buildReport(JSON.stringify(p),candidates,metadata);
 assert.deepEqual(report.items[0].details,p.items[0].details);assert.match(reportMarkdown(report),/增量索引/);
});
test('project details reject missing references and unsafe evidence',()=>{
 for(const change of [d=>d.technical[0].evidenceRefs=['missing'],d=>d.evidence[0].url='http://localhost/release',d=>d.evidence.push({...d.evidence[0]})]){
  const p=proposal();p.items[0].details=projectDetails();change(p.items[0].details);assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata));
 }
});


test('research-area ordering is stable and is preserved in the report summary',()=>{
 const rust={...candidates[0],id:'article-rust',title:'Rust tool release announcement',canonicalUrl:'https://github.blog/rust',originalUrl:'https://github.blog/rust'};
 const agent={...candidates[0],id:'article-agent',title:'Agent runtime release announcement',canonicalUrl:'https://github.blog/agent',originalUrl:'https://github.blog/agent'};
 const output={title:'Five-area open-source report',items:[
  {articleId:rust.id,researchArea:'rust',category:'opensource',importance:5,factSummary:'Rust 工具发布更新。',analysis:null,evidenceQuote:rust.title},
  {articleId:agent.id,researchArea:'agent',category:'ai',importance:3,factSummary:'Agent Runtime 发布更新。',analysis:null,evidenceQuote:agent.title},
 ]};
 const report=buildReport(JSON.stringify(output),[rust,agent],metadata);
 assert.deepEqual(report.items.map(item=>item.researchArea),['agent','rust']);
 const markdown=reportMarkdown(report);
 assert.ok(markdown.indexOf('【AI Agent 与自动化执行】')<markdown.indexOf('【Rust 生态与工程工具】'));
});

test('technology categories use a dedicated report validator without widening legacy categories',()=>{
 const p=proposal();
 p.items[0].category='ai_industry_chain';
 p.items[0].details=investmentDetails();
 assert.throws(()=>buildReport(JSON.stringify(p),candidates,metadata,'verified'),{code:'report_schema_invalid'});
 const report=buildReport(JSON.stringify(p),candidates,metadata,'verified','technology');
 assert.equal(report.items[0].category,'ai_industry_chain');
 assert.deepEqual(report.items[0].details,p.items[0].details);
});

test('technology report accepts codex-reported source provenance with a null fetch timestamp',()=>{
 const p=proposal();
 p.items[0].category='ai_industry_chain';
 p.items[0].details=investmentDetails();
 const candidate={id:'a'.repeat(64),title:p.items[0].factSummary,originalUrl:'https://example.com/filing',canonicalUrl:'https://example.com/filing',sourceName:'example.com',publishedAt:null,eventAt:null,fetchedAt:null,excerpt:'',sourceMode:'codex_reported'};
 p.items[0].articleId=candidate.id;
 const report=buildReport(JSON.stringify(p),[candidate],{...metadata,topic:{id:'t-'+'a'.repeat(24),name:'自定义科技主题'}},'codex_reported','technology');
 assert.equal(report.items[0].verification,'codex_reported');
 assert.equal(report.items[0].source.fetchedAt,null);
});
