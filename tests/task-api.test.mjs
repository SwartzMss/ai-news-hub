import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { buildServer } from '../dist/apps/server/src/app.js';
import { loadConfig } from '../dist/apps/server/src/config.js';
import { ControlledAdapter } from './fixtures/controlled-adapter.mjs';

const token = 'test_only_0123456789_abcdefghijklmnop';
const headers = { authorization: `Bearer ${token}` };
test('management is disabled without a token and rejects unauthenticated requests', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-auth-'));
  let app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent' }));
  try {
    assert.equal((await app.inject('/api/tasks')).statusCode, 503);
    await app.close();
    app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent', AI_NEWS_HUB_ADMIN_TOKEN: token }));
    const response = await app.inject('/api/tasks');
    assert.equal(response.statusCode, 401);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.equal(response.headers['www-authenticate'], 'Bearer');
    assert.equal((await app.inject({ url: '/api/tasks', headers })).statusCode, 200);
    assert.equal((await app.inject({ url: '/api/tasks', headers: { authorization: 'Bearer wrong_token_0123456789_abcdefghijklmnop' } })).statusCode, 401);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('API starts, polls, continues, paginates and preserves history on restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-api-'));
  const config = loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent', AI_NEWS_HUB_ADMIN_TOKEN: token });
  const adapter = new ControlledAdapter();
  let app = buildServer(config, { adapter });
  try {
    const start = await app.inject({ method: 'POST', url: '/api/tasks/sample-connectivity/runs', headers, payload: { idempotencyKey: 'api-start' } });
    assert.equal(start.statusCode, 202);
    const runId = start.json().run.id;
    await delay(10); adapter.succeed(0); await delay(10);
    const detail = await app.inject({ url: `/api/runs/${runId}`, headers });
    assert.equal(detail.json().run.status, 'succeeded');
    const duplicate = await app.inject({ method: 'POST', url: '/api/tasks/sample-connectivity/runs', headers, payload: { idempotencyKey: 'api-start' } });
    assert.equal(duplicate.statusCode, 200); assert.equal(duplicate.json().run.id, runId);
    const continuation = await app.inject({ method: 'POST', url: `/api/runs/${runId}/turns`, headers, payload: { idempotencyKey: 'api-followup', input: 'next' } });
    assert.equal(continuation.statusCode, 202);
    await delay(10); assert.equal(adapter.calls[1].input.threadId, 'thread-0'); adapter.succeed(1); await delay(10);
    const events = (await app.inject({ url: `/api/runs/${runId}/events?limit=1`, headers })).json().events;
    assert.equal(events.length, 1);
    const next = (await app.inject({ url: `/api/runs/${runId}/events?after=${events[0].id}`, headers })).json().events;
    assert.ok(next.every((e) => e.id > events[0].id));
    assert.equal((await app.inject({ url: `/api/runs/${runId}/events?limit=1000`, headers })).statusCode, 400);
    await app.close(); app = buildServer(config, { adapter });
    const history = (await app.inject({ url: `/api/runs/${runId}`, headers })).json();
    assert.equal(history.run.status, 'succeeded'); assert.equal(history.turns.length, 2);
    assert.equal((await app.inject({ url: '/api/runs/unknown', headers })).statusCode, 404);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
test('second Backend cannot recover the live owner\'s active Run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'task-owner-'));
  const config = loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent' });
  const app = buildServer(config);
  try { assert.throws(() => buildServer(config), { code: 'backend_already_running' }); }
  finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
