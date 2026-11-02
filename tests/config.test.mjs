import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../dist/apps/server/src/config.js';

test('defaults keep the API on loopback and SQLite outside the repository', () => {
  const config = loadConfig({});
  assert.equal(config.host, '127.0.0.1');
  assert.equal(config.port, 3000);
  assert.equal(config.dataDir, '/var/lib/ai-news-hub');
});
for (const env of [
  { AI_NEWS_HUB_HOST: '0.0.0.0' }, { AI_NEWS_HUB_HOST: 'localhost' },
  { AI_NEWS_HUB_PORT: '0' }, { AI_NEWS_HUB_PORT: '3000junk' },
  { AI_NEWS_HUB_PORT: '65536' }, { AI_NEWS_HUB_PORT: '' },
  { AI_NEWS_HUB_DATA_DIR: './data' }, { AI_NEWS_HUB_LOG_LEVEL: 'garbage' },
  { AI_NEWS_HUB_ADMIN_TOKEN: 'short' }, { AI_NEWS_HUB_CONCURRENCY: '0' },
  { AI_NEWS_HUB_RUN_TIMEOUT_MS: 'infinite' }, { AI_NEWS_HUB_MAX_QUEUE: '100000' },
]) {
  test(`reject invalid configuration ${JSON.stringify(env)}`, () => {
    assert.throws(() => loadConfig(env), { code: 'invalid_config' });
  });
}
test('explicit IPv6 loopback and absolute data directory are allowed', () => {
  const config = loadConfig({ AI_NEWS_HUB_HOST: '::1', AI_NEWS_HUB_DATA_DIR: '/tmp/news-hub-test' });
  assert.equal(config.host, '::1');
});
