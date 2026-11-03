import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { buildServer } from '../dist/apps/server/src/app.js';
import { loadConfig } from '../dist/apps/server/src/config.js';
import { ControlledAdapter } from './fixtures/controlled-adapter.mjs';

const token = 'test_only_0123456789_abcdefghijklmnop';
const headers = { authorization: `Bearer ${token}` };
const feed = '<rss version="2.0"><channel><item><title>Fixture release announcement</title><link>https://github.blog/fixture</link><guid>fixture-1</guid><pubDate>Mon, 02 Nov 2026 10:00:00 GMT</pubDate><description>Publisher-provided short fixture summary.</description></item></channel></rss>';
function setup(fetcher = async () => new Response(feed), now) {
  const dir = mkdtempSync(join(tmpdir(), 'news-pipeline-'));
  const adapter = new ControlledAdapter();
  const app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_ADMIN_TOKEN: token, AI_NEWS_HUB_LOG_LEVEL: 'silent' }), { adapter, newsFetcher: fetcher, now });
  return { dir, app, adapter, async close() { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function start(s, key) {
  const previousCalls = s.adapter.calls.length;
  const response = await s.app.inject({ method: 'POST', url: '/api/tasks/news-github/runs', headers, payload: { idempotencyKey: key } });
  assert.equal(response.statusCode, 202);
  const runId = response.json().run.id;
  for (let i = 0; i < 30; i++) {
    if (s.adapter.calls.length > previousCalls || (await detail(s, runId)).run.status === 'failed') break;
    await delay(5);
  }
  return runId;
}
async function detail(s, id) { return (await s.app.inject({ url: `/api/runs/${id}`, headers })).json(); }
function proposal(call) {
  const candidate = JSON.parse(call.input.input.split('UNTRUSTED_CANDIDATES=')[1])[0];
  return { title: 'Fixture sourced report', items: [{ articleId: candidate.articleId, category: 'opensource', importance: 4,
    factSummary: '来源宣布一次更新。', analysis: '这可能有助于开发者。', evidenceQuote: candidate.title }] };
}
test('RSS → task engine → strict report → SQLite remains pending review and queries are protected', async () => {
  let fetches = 0;
  const s = setup(async () => { fetches++; return new Response(feed); });
  try {
    assert.equal((await s.app.inject('/api/news/reports')).statusCode, 401);
    const runId = await start(s, 'news-1');
    const call = s.adapter.calls[0];
    assert.ok(call.input.outputSchema); assert.equal(call.input.forbidTools, true);
    s.adapter.succeed(0, JSON.stringify(proposal(call))); await delay(10);
    assert.equal((await detail(s, runId)).run.status, 'succeeded');
    const news = (await s.app.inject({ url: `/api/news/runs/${runId}`, headers })).json().newsRun;
    assert.ok(news.report_id);
    const report = (await s.app.inject({ url: `/api/news/reports/${news.report_id}`, headers })).json().report;
    assert.equal(report.status, 'validated'); assert.equal(report.document.reviewStatus, 'pending');
    assert.equal(report.document.items[0].source.eventAt, null);
    assert.equal(report.document.items[0].source.canonicalUrl, 'https://github.blog/fixture');
    const duplicate = await s.app.inject({ method: 'POST', url: '/api/tasks/news-github/runs', headers, payload: { idempotencyKey: 'news-1' } });
    assert.equal(duplicate.statusCode, 200); assert.equal(fetches, 1); assert.equal(s.adapter.calls.length, 1);
    const continuation = await s.app.inject({ method: 'POST', url: `/api/runs/${runId}/turns`, headers, payload: { idempotencyKey: 'unsupported', input: 'change sources' } });
    assert.equal(continuation.statusCode, 409);
    const db = new DatabaseSync(join(s.dir, 'news.db'));
    try {
      assert.equal(db.prepare('SELECT count(*) n FROM articles').get().n, 1);
      assert.equal(db.prepare('SELECT count(*) n FROM report_articles').get().n, 1);
      assert.equal(db.prepare('SELECT count(*) n FROM publication_records').get().n, 0);
    } finally { db.close(); }
  } finally { await s.close(); }
});
test('invalid AI output fails Run and atomically leaves no report or successful association', async () => {
  const s = setup();
  try {
    const runId = await start(s, 'invalid-json');
    s.adapter.succeed(0, 'not JSON'); await delay(10);
    const result = await detail(s, runId);
    assert.equal(result.run.status, 'failed'); assert.equal(result.run.error_code, 'report_invalid_json');
    const reports = (await s.app.inject({ url: '/api/news/reports', headers })).json().reports;
    assert.equal(reports.length, 0);
    assert.equal((await s.app.inject({ url: `/api/news/runs/${runId}`, headers })).json().newsRun.report_id, null);
  } finally { await s.close(); }
});
test('RSS failure never starts Codex or produces a report', async () => {
  const s = setup(async () => new Response('unavailable', { status: 503 }));
  try {
    const runId = await start(s, 'feed-failure'); await delay(10);
    assert.equal((await detail(s, runId)).run.error_code, 'feed_http_503');
    assert.equal(s.adapter.calls.length, 0);
    assert.equal((await s.app.inject({ url: '/api/news/reports', headers })).json().reports.length, 0);
  } finally { await s.close(); }
});

test('report association failure rolls back the report and successful Run together', async () => {
  const s = setup();
  try {
    const runId = await start(s, 'storage-failure');
    const db = new DatabaseSync(join(s.dir, 'news.db'));
    try {
      db.exec("CREATE TRIGGER fail_association BEFORE INSERT ON report_articles BEGIN SELECT RAISE(ABORT, 'fixture'); END");
      s.adapter.succeed(0, JSON.stringify(proposal(s.adapter.calls[0]))); await delay(10);
      assert.equal((await detail(s, runId)).run.status, 'failed');
      assert.equal(db.prepare('SELECT count(*) n FROM reports').get().n, 0);
      assert.equal(db.prepare('SELECT count(*) n FROM report_articles').get().n, 0);
      assert.equal(db.prepare('SELECT report_id FROM news_runs WHERE run_id=?').get(runId).report_id, null);
    } finally { db.close(); }
  } finally { await s.close(); }
});

test('publisher correction affects new reports while old report and candidate snapshots stay intact', async () => {
  let time = Date.parse('2026-11-03T00:00:00Z');
  let current = feed;
  const s = setup(async () => new Response(current), () => new Date(time));
  const getNews = async (runId) => (await s.app.inject({ url: `/api/news/runs/${runId}`, headers })).json().newsRun;
  const getReport = async (id) => (await s.app.inject({ url: `/api/news/reports/${id}`, headers })).json().report;
  try {
    const first = await start(s, 'original');
    s.adapter.succeed(0, JSON.stringify(proposal(s.adapter.calls[0]))); await delay(10);
    const originalNews = await getNews(first);
    const originalReport = await getReport(originalNews.report_id);
    time += 300001;
    current = feed.replace('Fixture release announcement', 'Fixture corrected announcement');
    const second = await start(s, 'corrected');
    const secondProposal = proposal(s.adapter.calls[1]);
    assert.equal(secondProposal.items[0].evidenceQuote, 'Fixture corrected announcement');
    s.adapter.succeed(1, JSON.stringify(secondProposal)); await delay(10);
    assert.equal((await detail(s, second)).run.status, 'succeeded');
    const correctedReport = await getReport((await getNews(second)).report_id);
    assert.equal(correctedReport.version, 2);
    assert.equal(correctedReport.document.items[0].evidenceQuote, 'Fixture corrected announcement');
    assert.deepEqual(await getNews(first), originalNews);
    assert.deepEqual(await getReport(originalNews.report_id), originalReport);
  } finally { await s.close(); }
});
