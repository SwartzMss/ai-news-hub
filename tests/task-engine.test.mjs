import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as delay } from 'node:timers/promises';
import { migrate } from '../dist/apps/server/src/db/migrations.js';
import { TaskEngine } from '../dist/apps/server/src/tasks/engine.js';
import { AgentError } from '../dist/apps/server/src/agent/types.js';
import { ControlledAdapter } from './fixtures/controlled-adapter.mjs';

const tick = () => delay(10);
function setup(extra = {}) {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys=ON'); migrate(db);
  const adapter = new ControlledAdapter();
  const engine = new TaskEngine(db, { adapter, concurrency: 1, maxQueue: 2, timeoutMs: 5000, cwd: '/tmp', ...extra });
  return { db, engine, adapter, async close() { await engine.close(); db.close(); } };
}
test('start is idempotent, task is exclusive, continuation resumes only its Thread', async () => {
  const s = setup();
  try {
    const first = s.engine.start('sample-connectivity', 'request-1');
    assert.equal(s.engine.start('sample-connectivity', 'request-1').run.id, first.run.id);
    assert.throws(() => s.engine.start('sample-connectivity', 'different-key'), { code: 'task_busy' });
    await tick(); s.adapter.succeed(0); await tick();
    assert.equal(s.engine.detail(first.run.id).run.status, 'succeeded');
    s.engine.continueRun(first.run.id, 'continue-1', 'follow up'); await tick();
    assert.equal(s.adapter.calls[1].input.threadId, 'thread-0');
    s.adapter.succeed(1); await tick();
    assert.equal(s.engine.detail(first.run.id).turns.length, 2);
    assert.equal(s.engine.continueRun(first.run.id, 'continue-1', 'follow up').reused, true);
    const second = s.engine.start('sample-connectivity', 'request-2'); await tick();
    assert.equal(s.adapter.calls[2].input.threadId, undefined);
    s.adapter.succeed(2); await tick();
    assert.notEqual(s.engine.detail(first.run.id).run.thread_id, s.engine.detail(second.run.id).run.thread_id);
    assert.ok(s.engine.events(first.run.id, 0, 100).length >= 6);
  } finally { await s.close(); }
});
test('bounded queue and global concurrency allow cancellation before spawn', async () => {
  const s = setup({ maxQueue: 1 });
  try {
    s.db.exec("INSERT INTO tasks(id,name,channel,prompt) VALUES ('other','other','test','test'),('third','third','test','test')");
    const a = s.engine.start('sample-connectivity', 'a'); await tick();
    const b = s.engine.start('other', 'b');
    assert.throws(() => s.engine.start('third', 'c'), { code: 'queue_full' });
    assert.equal(s.adapter.calls.length, 1);
    s.engine.cancel(b.run.id); s.engine.cancel(a.run.id); await tick();
    assert.equal(s.engine.detail(a.run.id).run.status, 'cancelled');
    assert.equal(s.engine.detail(b.run.id).run.status, 'cancelled');
    assert.equal(s.adapter.calls.length, 1);
  } finally { await s.close(); }
});
for (const code of ['process_exit', 'auth_required', 'quota_exceeded', 'needs_approval', 'protocol_error']) {
  test(`adapter ${code} cannot be succeeded`, async () => {
    const s = setup();
    try {
      const { run } = s.engine.start('sample-connectivity', code); await tick();
      s.adapter.calls[0].reject(new AgentError(code)); await tick();
      assert.equal(s.engine.detail(run.id).run.status, 'failed');
      assert.equal(s.engine.detail(run.id).run.error_code, code);
    } finally { await s.close(); }
  });
}
test('engine watchdog interrupts a Turn and records timeout', async () => {
  const s = setup({ timeoutMs: 30 });
  try {
    const { run } = s.engine.start('sample-connectivity', 'timeout'); await delay(60);
    assert.equal(s.engine.detail(run.id).run.status, 'failed');
    assert.equal(s.engine.detail(run.id).run.error_code, 'timeout');
  } finally { await s.close(); }
});
test('recovery preserves history and interrupts unfinished Run and Turn', async () => {
  const s = setup();
  try {
    const { run } = s.engine.start('sample-connectivity', 'old'); await tick();
    await s.engine.close();
    s.db.exec("UPDATE task_runs SET status='running', finished_at=NULL; UPDATE run_turns SET status='running', finished_at=NULL");
    const recovered = new TaskEngine(s.db, { adapter: s.adapter, concurrency: 1, maxQueue: 2, timeoutMs: 5000, cwd: '/tmp' });
    try {
      assert.equal(recovered.detail(run.id).run.status, 'interrupted');
      assert.equal(recovered.detail(run.id).run.error_code, 'backend_restarted');
      assert.equal(recovered.detail(run.id).turns[0].status, 'interrupted');
      assert.equal(s.adapter.calls.length, 1);
    } finally { await recovered.close(); }
  } finally { await s.close(); }
});
test('unconfirmed process cleanup halts queue and refuses further execution', async () => {
  const s = setup();
  try {
    s.db.exec("INSERT INTO tasks(id,name,channel,prompt) VALUES ('other','other','test','test')");
    const { run } = s.engine.start('sample-connectivity', 'cleanup');
    s.engine.start('other', 'queued'); await tick();
    s.adapter.calls[0].reject(new AgentError('cleanup_failed')); await tick();
    assert.equal(s.engine.detail(run.id).run.error_code, 'cleanup_failed');
    assert.equal(s.engine.healthy(), false);
    assert.equal(s.adapter.calls.length, 1);
    assert.throws(() => s.engine.start('sample-connectivity', 'again'), { code: 'engine_unavailable' });
  } finally { await s.close(); }
});
test('watchdog timeout cannot mask failed process cleanup', async () => {
  const adapter = { execute(input) { return new Promise((_resolve, reject) => {
    input.signal.addEventListener('abort', () => reject(new AgentError('cleanup_failed')), { once: true });
  }); } };
  const s = setup({ adapter, timeoutMs: 30 });
  try {
    const { run } = s.engine.start('sample-connectivity', 'timeout-cleanup'); await delay(60);
    assert.equal(s.engine.detail(run.id).run.error_code, 'cleanup_failed');
    assert.equal(s.engine.healthy(), false);
  } finally { await s.close(); }
});
test('late completion after cancellation cannot overwrite its terminal state', async () => {
  const s = setup();
  try {
    const { run } = s.engine.start('sample-connectivity', 'late'); await tick();
    s.engine.cancel(run.id); s.adapter.succeed(0); await tick();
    assert.equal(s.engine.detail(run.id).run.status, 'cancelled');
    assert.equal(s.engine.detail(run.id).turns[0].output_text, null);
  } finally { await s.close(); }
});
test('completion with no authoritative Thread or Turn cannot succeed', async () => {
  const s = setup();
  try {
    const { run } = s.engine.start('sample-connectivity', 'missing-ids'); await tick();
    s.adapter.calls[0].resolve({ status: 'completed', threadId: null, turnId: null, output: 'fake completion' }); await tick();
    assert.equal(s.engine.detail(run.id).run.error_code, 'protocol_error');
  } finally { await s.close(); }
});
