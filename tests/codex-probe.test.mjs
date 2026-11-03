import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runProbe } from '../dist/tools/codex-probe/client.js';

const logs = [];
const probe = (mode, extra = {}) => runProbe({
  binary: process.execPath,
  args: ['tests/fixtures/app-server.mjs', mode],
  cwd: process.cwd(), timeoutMs: 2000,
  log: (event) => logs.push(event), ...extra,
});

test('handshake, successful terminal state and independent Run threads', async () => {
  const a = await probe('success');
  const b = await probe('success');
  assert.equal(a.status, 'completed');
  assert.notEqual(a.threadId, b.threadId);
  assert.notEqual(a.runId, b.runId);
});
test('completion preceding turn/start response is retained', async () => {
  assert.equal((await probe('early')).status, 'completed');
});
for (const [mode, code] of Object.entries({
  failed: 'agent_failed', quota: 'quota_exceeded', interrupted: 'interrupted',
  rate: 'rate_limited', unauthorized: 'auth_required', 'http-auth': 'auth_required', 'http-rate': 'rate_limited',
  unauthenticated: 'auth_required', approval: 'needs_approval',
  exit: 'process_exit', malformed: 'protocol_error', foreign: 'process_exit',
  'wrong-output': 'invalid_output', 'rpc-error': 'rpc_error',
  oversize: 'protocol_error', timeout: 'timeout',
})) {
  test(`${mode} cannot produce success`, async () => {
    await assert.rejects(probe(mode, { timeoutMs: mode === 'timeout' ? 80 : 2000 }), { code });
  });
}
test('missing executable is diagnosed', async () => {
  await assert.rejects(probe('success', { binary: '/does-not-exist' }), { code: 'spawn_failed' });
});
test('abort terminates the pending child', async () => {
  const controller = new AbortController();
  const pending = probe('timeout', { signal: controller.signal });
  setTimeout(() => controller.abort(), 50);
  await assert.rejects(pending, { code: 'cancelled' });
});
test('custom providers without OpenAI authentication can complete the protocol', async () => {
  assert.equal((await probe('custom-provider')).status, 'completed');
});
test('SIGTERM-resistant child is killed and reaped after timeout', async () => {
  let pid;
  await assert.rejects(probe('ignore-term', {
    timeoutMs: 150, log: (event) => { if (event.event === 'spawned') pid = event.pid; },
  }), { code: 'timeout' });
  assert.ok(pid);
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
});
test('a descendant retaining pipes cannot extend cleanup indefinitely', async () => {
  const started = Date.now();
  await assert.rejects(probe('descendant', { timeoutMs: 150 }), { code: 'timeout' });
  assert.ok(Date.now() - started < 2500, 'descendant must be terminated with the process group');
});
test('descendants with closed pipes are also terminated', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'codex-probe-test-'));
  const marker = join(dir, 'survived');
  try {
    await assert.rejects(probe('silent-descendant', {
      timeoutMs: 150, args: ['tests/fixtures/app-server.mjs', 'silent-descendant', marker],
    }), { code: 'timeout' });
    await delay(650);
    assert.equal(existsSync(marker), false, 'descendant survived after the probe returned');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('logs do not contain raw server data', () => {
  assert.ok(!JSON.stringify(logs).includes('SECRET_TOKEN'));
});
test('probe uses final answer even when commentary follows it',async()=>{
 assert.equal((await probe('probe-phase-final')).status,'completed');
});
test('probe rejects marker appearing only in commentary',async()=>{
 await assert.rejects(probe('probe-phase-progress-only'),{code:'invalid_output'});
});
test('probe child does not inherit management or publishing credentials',async()=>{
 const keys=['AI_NEWS_HUB_ADMIN_TOKEN','AI_NEWS_HUB_GITHUB_TOKEN','GH_TOKEN'];
 const old=keys.map(key=>process.env[key]);keys.forEach(key=>{process.env[key]='PRIVATE_TEST_CREDENTIAL';});
 try{assert.equal((await probe('probe-env-leak')).status,'completed');}
 finally{keys.forEach((key,i)=>{if(old[i]===undefined)delete process.env[key];else process.env[key]=old[i];});}
});
test('standalone probe installation includes its shared environment module',async()=>{
 const {mkdirSync,copyFileSync,writeFileSync}=await import('node:fs');
 const {pathToFileURL}=await import('node:url');
 const root=mkdtempSync(join(tmpdir(),'probe-install-'));
 try{
  const probeDir=join(root,'dist/tools/codex-probe');const sharedDir=join(root,'dist/packages/shared/src');
  mkdirSync(probeDir,{recursive:true});mkdirSync(sharedDir,{recursive:true});
  writeFileSync(join(root,'package.json'),'{"type":"module"}');
  for(const name of ['cli.js','client.js'])copyFileSync(join(process.cwd(),'dist/tools/codex-probe',name),join(probeDir,name));
  copyFileSync(join(process.cwd(),'dist/packages/shared/src/agent-environment.js'),join(sharedDir,'agent-environment.js'));
  const installed=await import(pathToFileURL(join(probeDir,'client.js')).href);
  const result=await installed.runProbe({binary:process.execPath,args:[join(process.cwd(),'tests/fixtures/app-server.mjs'),'success'],cwd:root,timeoutMs:2000});
  assert.equal(result.status,'completed');
 }finally{rmSync(root,{recursive:true,force:true});}
});
