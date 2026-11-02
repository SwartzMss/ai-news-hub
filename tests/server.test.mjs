import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildServer } from '../dist/apps/server/src/app.js';
import { loadConfig } from '../dist/apps/server/src/config.js';
import { DatabaseSync } from 'node:sqlite';

test('health checks SQLite, errors are consistent, and close releases the DB', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-api-'));
  const app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent' }));
  try {
    const health = await app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.deepEqual(health.json(), { status: 'ok', database: 'ok' });
    assert.equal(health.headers['cache-control'], 'no-store');
    const missing = await app.inject({ method: 'GET', url: '/not-found?token=private' });
    assert.equal(missing.statusCode, 404);
    assert.equal(missing.json().error.code, 'not_found');
    assert.ok(missing.json().error.requestId);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('unexpected handler errors do not expose private details', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-api-'));
  const app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent' }));
  app.get('/test-error', () => { throw new Error('PRIVATE_ERROR_TEXT'); });
  try {
    const response = await app.inject('/test-error');
    assert.equal(response.statusCode, 500);
    assert.equal(response.json().error.code, 'internal_error');
    assert.ok(!response.body.includes('PRIVATE_ERROR_TEXT'));
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('health is unavailable if the persisted schema cannot be read', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-api-'));
  const app = buildServer(loadConfig({ AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_LOG_LEVEL: 'silent' }));
  const secondConnection = new DatabaseSync(join(dir, 'news.db'));
  try {
    secondConnection.exec('DROP TABLE schema_migrations');
    const response = await app.inject('/health');
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'database_unavailable');
  } finally { secondConnection.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
