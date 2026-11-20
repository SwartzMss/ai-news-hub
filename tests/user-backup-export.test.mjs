import test from 'node:test';
import assert from 'node:assert/strict';
import { startExport, pollExport, storeExport } from '../deploy/user-backup/export.mjs';

const config = { accountId: 'a'.repeat(32), databaseId: '33333333-3333-4333-8333-333333333333', token: 'private-api-token' };

test('scheduled D1 export polls its bookmark and saves a private SQL dump', async () => {
  const requests = [];
  const fetcher = async (url, init) => {
    requests.push({ url, init });
    if (url === 'https://example.r2.cloudflarestorage.com/dump.sql?sig=x') return new Response('CREATE TABLE users(id TEXT);');
    const body = JSON.parse(init.body);
    if (!body.current_bookmark) return Response.json({ success: true, result: { at_bookmark: 'bookmark-1' } });
    return Response.json({ success: true, result: { status: 'complete', at_bookmark: 'bookmark-1', result: {
      filename: 'export.sql', signed_url: 'https://example.r2.cloudflarestorage.com/dump.sql?sig=x' } } });
  };
  const bookmark = await startExport(config, fetcher);
  assert.equal(bookmark, 'bookmark-1');
  const result = await pollExport(config, bookmark, fetcher);
  assert.equal(result.ready, true);
  const writes = [];
  const bucket = { put: async (key, body) => { writes.push({ key, body: await new Response(body).text() }); return { key }; } };
  await storeExport(result, bucket, 'backups/2026-11-20/dump.sql', fetcher);
  assert.equal(writes[0].body, 'CREATE TABLE users(id TEXT);');
  assert.equal(writes[0].key, 'backups/2026-11-20/dump.sql');
  assert.equal(requests[0].init.headers.Authorization, 'Bearer private-api-token');
  assert.equal(requests[1].init.headers.Authorization, 'Bearer private-api-token');
});

test('backup export rejects malformed API responses and non-HTTPS downloads', async () => {
  await assert.rejects(startExport(config, async () => Response.json({ success: true, result: {} })), /backup_export_failed/);
  await assert.rejects(pollExport(config, 'bookmark-1', async () => Response.json({ success: true, result: {
    status: 'complete', result: { signed_url: 'http://unsafe.example/dump' } } })), /backup_export_failed/);
  assert.deepEqual(await pollExport(config, 'bookmark-1', async () => Response.json({ success: true, result: { status: 'pending' } })), { ready: false });
});
