import test from 'node:test';
import assert from 'node:assert/strict';
import { StdioAdapter } from '../dist/apps/server/src/agent/stdio-adapter.js';

const execute = (mode, extra = {}, callback = () => {}) => new StdioAdapter(process.execPath, ['tests/fixtures/app-server.mjs', mode]).execute({
  runId: 'fixture', cwd: process.cwd(), input: 'fixture request', timeoutMs: 2000,
  signal: new AbortController().signal, ...extra,
}, callback);
test('stdio starts a Thread, resumes its context and handles early completion', async () => {
  const first = await execute('early');
  const resumed = await execute('success', { threadId: first.threadId });
  assert.equal(resumed.threadId, first.threadId);
  assert.notEqual(resumed.turnId, first.turnId);
  assert.equal(first.status, 'completed');
});
for (const [mode, code] of Object.entries({
  failed: 'agent_failed', interrupted: 'interrupted', quota: 'quota_exceeded', rate: 'rate_limited',
  unauthorized: 'auth_required', unauthenticated: 'auth_required', approval: 'needs_approval',
  exit: 'process_exit', malformed: 'protocol_error', foreign: 'process_exit',
  'rpc-error': 'rpc_error', oversize: 'protocol_error', empty: 'invalid_output',
  'large-output': 'output_too_large', timeout: 'timeout',
})) {
  test(`stdio ${mode} fails closed`, async () => {
    await assert.rejects(execute(mode, { timeoutMs: mode === 'timeout' ? 80 : 2000 }), { code });
  });
}
test('resume refuses a response with another Thread ID', async () => {
  await assert.rejects(execute('resume-wrong', { threadId: 'expected' }), { code: 'protocol_error' });
});
test('abort stops pending stdio work', async () => {
  const controller = new AbortController();
  const pending = execute('timeout', { signal: controller.signal });
  setTimeout(() => controller.abort(), 30);
  await assert.rejects(pending, { code: 'cancelled' });
});
test('server secrets and tool arguments never enter persisted protocol events', async () => {
  const events = [];
  await assert.rejects(execute('approval', {}, (event) => events.push(event)), { code: 'needs_approval' });
  assert.ok(events.some((event) => event.type === 'approval_required'));
  assert.ok(!JSON.stringify(events).includes('SECRET_TOKEN'));
});
test('event persistence failure stops the child instead of returning success', async () => {
  await assert.rejects(execute('success', {}, () => { throw new Error('private database detail'); }), { code: 'event_persistence_failed' });
});
test('Codex child never inherits Backend control or publishing credentials', async () => {
  const previousAdmin = process.env.AI_NEWS_HUB_ADMIN_TOKEN;
  const previousGithub = process.env.GH_TOKEN;
  process.env.AI_NEWS_HUB_ADMIN_TOKEN = 'PRIVATE_BACKEND_TOKEN';
  process.env.GH_TOKEN = 'PRIVATE_PUBLISH_TOKEN';
  try { assert.equal((await execute('env-leak')).output, 'environment_isolated'); }
  finally {
    if (previousAdmin === undefined) delete process.env.AI_NEWS_HUB_ADMIN_TOKEN; else process.env.AI_NEWS_HUB_ADMIN_TOKEN = previousAdmin;
    if (previousGithub === undefined) delete process.env.GH_TOKEN; else process.env.GH_TOKEN = previousGithub;
  }
});
test('news execution fails when a tool starts instead of accepting a report', async () => {
  await assert.rejects(execute('tool', { forbidTools: true }), { code: 'unexpected_tool' });
});
