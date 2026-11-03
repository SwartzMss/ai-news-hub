import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { buildServer } from '../dist/apps/server/src/app.js';
import { loadConfig } from '../dist/apps/server/src/config.js';
import { ControlledAdapter } from './fixtures/controlled-adapter.mjs';

const headers = { authorization: 'Bearer test_only_0123456789_abcdefghijklmnop' };
const topic = 'AI 模型与开源工具';
const initial = '搜索最近三天的 AI 新闻，优先原始公告。';
const proposal = () => ({ title: 'AI 日报', items: [{ url: 'https://example.com/ai-release?utm_source=test', category: 'ai', importance: 4,
  factSummary: '来源宣布一个 AI 模型。', analysis: null, evidenceQuote: 'Official AI model release announcement' }] });
function setup(page = '<html><head><title>Official AI model release announcement</title><meta property="article:published_time" content="2026-11-02T10:00:00Z"></head><body><p>Official AI model release announcement</p></body></html>') {
  const dir = mkdtempSync('/tmp/codex-research-');
  const adapter = new ControlledAdapter(), fetched = [];
  const app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_ADMIN_TOKEN: headers.authorization.slice(7), AI_NEWS_HUB_LOG_LEVEL: 'silent' }), {
    adapter, newsFetcher: async url => { fetched.push(String(url)); return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8' } }); },
  });
  const post = (url, payload) => app.inject({ method: 'POST', url: '/api' + url, headers, payload });
  const get = async url => (await app.inject({ url: '/api' + url, headers })).json();
  async function settle(id) { for (let i = 0; i < 100; i++) { const d = await get('/runs/' + id); if (!['queued','running'].includes(d.run.status)) return d; await delay(5); } throw Error('run did not settle'); }
  async function call(n) { for (let i = 0; i < 100 && adapter.calls.length < n; i++) await delay(5); assert.equal(adapter.calls.length, n); return adapter.calls[n - 1]; }
  return { app, adapter, fetched, post, get, settle, call, async close() { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
test('Codex owns collection: user topic → iterative prompts in one Thread → explicit verified pending report', async () => {
  const s = setup();
  try {
    const tasks = (await s.get('/tasks')).tasks;
    assert.ok(tasks.some(t => t.id === 'news-research')); assert.ok(!tasks.some(t => t.id === 'news-github' && t.status === 'active'));
    assert.equal((await s.app.inject({ url: '/api/news/sources', headers })).statusCode, 404);
    const payload = { idempotencyKey: 'start', topic, input: initial };
    const started = await s.post('/tasks/news-research/runs', payload); assert.equal(started.statusCode, 202);
    const id = started.json().run.id, first = await s.call(1);
    assert.ok(first.input.input.includes(topic)); assert.ok(first.input.input.includes(initial));
    assert.equal(first.input.webSearch, true); assert.equal(first.input.outputSchema, undefined); assert.equal(s.fetched.length, 0);
    s.adapter.succeed(0, '找到三条公告。可以继续缩小范围。'); await s.settle(id);
    const replay = await s.post('/tasks/news-research/runs', payload); assert.equal(replay.statusCode, 200);
    assert.equal((await s.post('/tasks/news-research/runs', { ...payload, topic: 'changed' })).statusCode, 409);
    const continued = await s.post('/runs/' + id + '/turns', { idempotencyKey: 'more', input: '只保留开源模型，进一步查证。' }); assert.equal(continued.statusCode, 202);
    const second = await s.call(2); assert.equal(second.input.threadId, (await s.get('/runs/' + id)).run.thread_id);
    assert.ok(second.input.input.includes('只保留开源模型')); s.adapter.succeed(1, '已进一步查证。'); await s.settle(id);
    assert.equal((await s.get('/news/runs/' + id)).newsRun.report_id, null); assert.equal(s.fetched.length, 0);
    const finalize = { idempotencyKey: 'final', input: '整理成中文日报。', finalize: true };
    assert.equal((await s.post('/runs/' + id + '/turns', finalize)).statusCode, 202);
    const third = await s.call(3); assert.ok(third.input.outputSchema); s.adapter.succeed(2, JSON.stringify(proposal()));
    const done = await s.settle(id); assert.equal(done.run.status, 'succeeded'); assert.equal(done.turns.length, 3);
    assert.equal(done.turns[0].input_text, initial); assert.equal(done.turns[2].mode, 'finalize');
    const news = (await s.get('/news/runs/' + id)).newsRun;
    const report = (await s.get('/news/reports/' + news.report_id)).report;
    assert.equal(report.status, 'validated'); assert.equal(report.document.reviewStatus, 'pending');
    const source = report.document.items[0].source;
    assert.equal(source.canonicalUrl, 'https://example.com/ai-release'); assert.equal(source.name, 'example.com');
    assert.equal(source.publishedAt, '2026-11-02T10:00:00.000Z'); assert.equal(source.eventAt, null);
    assert.equal(s.fetched.length, 1); assert.ok(!s.fetched[0].includes('/feed'));
    assert.equal((await s.post('/runs/' + id + '/turns', finalize)).statusCode, 200);
    assert.equal((await s.post('/runs/' + id + '/turns', { ...finalize, finalize: false })).statusCode, 409);
    assert.equal((await s.post('/runs/' + id + '/turns', { idempotencyKey: 'after', input: 'change it' })).statusCode, 409);
    assert.equal((await s.get('/news/reports')).reports.length, 1);
    const review = (await s.app.inject({ url: `/api/news/reports/${news.report_id}/publication`, headers })).json();
    assert.ok(review.contentHash || review.review?.contentHash);
  } finally { await s.close(); }
});
test('topic and prompt are required; failed finalization can be corrected in the same Thread without partial report', async () => {
  const s = setup();
  try {
    assert.equal((await s.post('/tasks/news-research/runs', { idempotencyKey: 'missing' })).statusCode, 400);
    const started = await s.post('/tasks/news-research/runs', { idempotencyKey: 'start', topic, input: initial });
    assert.equal(started.statusCode, 202); const id = started.json().run.id;
    await s.call(1); s.adapter.succeed(0, 'Search complete.'); await s.settle(id);
    await s.post('/runs/' + id + '/turns', { idempotencyKey: 'bad', input: '生成', finalize: true }); await s.call(2);
    const bad = proposal(); bad.items[0].evidenceQuote = 'Invented quote not in the page'; s.adapter.succeed(1, JSON.stringify(bad));
    const failed = await s.settle(id); assert.equal(failed.run.error_code, 'report_evidence_invalid');
    assert.equal((await s.get('/news/reports')).reports.length, 0); assert.equal((await s.get('/news/articles')).articles.length, 0);
    await s.post('/runs/' + id + '/turns', { idempotencyKey: 'retry', input: '使用原文准确引用后重新生成', finalize: true });
    await s.call(3); s.adapter.succeed(2, JSON.stringify(proposal())); assert.equal((await s.settle(id)).run.status, 'succeeded');
  } finally { await s.close(); }
});
