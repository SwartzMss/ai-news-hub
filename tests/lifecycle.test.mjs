import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';

async function freePort() {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise((resolve, reject) => socket.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startBackend(env) {
  const child = spawn(process.execPath, ['dist/apps/server/src/main.js'], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const exited = once(child, 'exit');
  let output = '', stderr = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  const ready = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server_ready timeout')), 8000);
    const inspect = () => {
      if (output.includes('"event":"server_ready"')) { clearTimeout(timer); resolve(); }
    };
    child.stdout.on('data', inspect);
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Backend exited before ready: ${stderr}`)); });
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
  });
  try { await ready; }
  catch (error) { child.kill('SIGKILL'); await exited; throw error; }
  return {
    child, exited, output: () => output,
    async stop() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const killer = setTimeout(() => child.kill('SIGKILL'), 5000);
      child.kill('SIGTERM');
      const [code, signal] = await exited;
      clearTimeout(killer);
      assert.equal(signal, null); assert.equal(code, 0);
    },
  };
}

test('non-root Backend serves only loopback, health script works, restart keeps SQLite', { timeout: 20000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-lifecycle-'));
  const port = await freePort();
  const env = { ...process.env, AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_HOST: '127.0.0.1', AI_NEWS_HUB_PORT: String(port), AI_NEWS_HUB_LOG_LEVEL: 'info' };
  let server;
  try {
    server = await startBackend(env);
    assert.match(server.output(), /http:\/\/127\.0\.0\.1:/);
    const url = `http://127.0.0.1:${port}`;
    const response = await fetch(url + '/health', { signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', database: 'ok' });
    const health = await promisify(execFile)(process.execPath, ['dist/scripts/health.js'], { env, timeout: 5000 });
    assert.equal(JSON.parse(health.stdout).status, 'ok');
    await fetch(url + '/missing?token=PRIVATE_QUERY', { headers: { authorization: 'Bearer PRIVATE_HEADER' } });
    await server.stop();
    assert.ok(!server.output().includes('PRIVATE_QUERY'));
    assert.ok(!server.output().includes('PRIVATE_HEADER'));
    const db = new DatabaseSync(join(dir, 'news.db'));
    db.exec("INSERT INTO tasks (id, name, channel, prompt) VALUES ('persisted', 'test', 'ai', 'test')"); db.close();
    server = await startBackend(env);
    await server.stop();
    const reopened = new DatabaseSync(join(dir, 'news.db'));
    assert.equal(reopened.prepare("SELECT name FROM tasks WHERE id='persisted'").get().name, 'test'); reopened.close();
  } finally { await server?.stop(); rmSync(dir, { recursive: true, force: true }); }
});

test('invalid public-bind configuration fails before creating a database', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'news-invalid-'));
  try {
    await assert.rejects(promisify(execFile)(process.execPath, ['dist/apps/server/src/main.js'], {
      env: { ...process.env, AI_NEWS_HUB_DATA_DIR: dir, AI_NEWS_HUB_HOST: '0.0.0.0' }, timeout: 5000,
    }), (error) => error.code === 1 && error.stderr.includes('invalid_config'));
    assert.equal(existsSync(join(dir, 'news.db')), false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
