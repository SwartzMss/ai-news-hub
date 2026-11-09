import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReport, reportMarkdown } from '../dist/apps/server/src/news/report.js';

const candidates = [{ id: 'article-a', title: 'A genuine fixture release announcement', originalUrl: 'https://github.blog/a?utm_source=rss', canonicalUrl: 'https://github.blog/a', sourceName: 'GitHub Blog', publishedAt: '2026-11-02T10:00:00.000Z', eventAt: null, fetchedAt: '2026-11-03T00:00:00.000Z', excerpt: 'Source-provided fixture summary.' }];
const metadata = { reportId: 'report-a', runId: 'run-a', reportDate: '2026-11-03', collectedAt: '2026-11-03T00:00:00.000Z' };
const proposal = () => ({ title: 'Fixture daily report', items: [{ articleId: 'article-a', category: 'opensource', importance: 4, factSummary: '来源宣布发布更新。', analysis: '这可能有助于开发者。', evidenceQuote: 'A genuine fixture release announcement' }] });
const investmentDetails = () => ({kind:'investment',background:'公司披露新一季财报，较此前指引有所变化。',metrics:[{name:'季度收入',value:'12.4',unit:'亿美元',period:'2026 Q3',basis:'actual',evidenceRefs:['filing']}],supplyChain:[{segment:'服务器内存',direction:'需求增加',reason:'新产品配置提高单机用量',relationship:'potential'}],investmentLogic:'若订单兑现，收入和毛利率可能改善。',watchpoints:['下季订单量'],risks:['客户认证延迟'],evidence:[{id:'filing',name:'公司财报',url:'https://example.com/filing',supports:'季度收入实际值'}]});
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
