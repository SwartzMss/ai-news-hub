import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
const mode = process.argv[2] || 'success';
if (mode === 'ignore-term') {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
}
if (mode === 'descendant') {
  spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setTimeout(()=>process.exit(),3000)'], { stdio: ['ignore', process.stdout, process.stderr] });
}
if (mode === 'silent-descendant') {
  spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); setTimeout(()=>require("node:fs").writeFileSync(process.argv[1],"survived"),300); setTimeout(()=>process.exit(),600)', process.argv[3]], { stdio: 'ignore' });
}
let initialized = false;
let threadId = `thread-${process.pid}`;
const turnId = `turn-${process.pid}`;
const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialized') { initialized = true; return; }
  if (!m.method) return;
  if (['timeout', 'ignore-term', 'descendant', 'silent-descendant'].includes(mode)) return;
  if (mode === 'exit') process.exit(7);
  if (mode === 'malformed') { process.stdout.write('broken json\n'); return; }
  if (m.method === 'initialize') {
    send({ id: m.id, result: { userAgent: 'fixture' } });
  } else if (m.method === 'account/read') {
    if (!initialized) process.exit(8);
    send({ id: m.id, result: { account: mode === 'unauthenticated' || mode === 'custom-provider' ? null : { type: 'chatgpt' }, requiresOpenaiAuth: mode !== 'custom-provider' } });
  } else if (m.method === 'thread/start' || m.method === 'thread/resume') {
    if (m.params.sandbox !== 'read-only' || m.params.approvalPolicy !== 'untrusted') process.exit(9);
    if (m.method === 'thread/resume') threadId = mode === 'resume-wrong' ? 'wrong-thread' : m.params.threadId;
    send({ id: m.id, result: { thread: { id: threadId } } });
  } else if (m.method === 'turn/start') {
    if (mode === 'tool') send({ method: 'item/started', params: { threadId, item: { id: 'tool-1', type: 'commandExecution' } } });
    if (mode === 'rpc-error') {
      send({ id: m.id, error: { code: -32000, message: 'SECRET_TOKEN' } }); return;
    }
    if (mode === 'approval') {
      send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'SECRET_TOKEN' } }); return;
    }
    if (mode === 'oversize') { process.stdout.write('x'.repeat(1024 * 1024 + 1)); return; }
    const errorInfo = { quota: 'usageLimitExceeded', rate: 'rateLimitExceeded', unauthorized: 'unauthorized', 'http-auth': { httpConnectionFailed: { httpStatusCode: 401 } }, 'http-rate': { httpConnectionFailed: { httpStatusCode: 429 } } }[mode];
    const turn = { id: turnId, status: mode === 'failed' || errorInfo ? 'failed' : mode === 'interrupted' ? 'interrupted' : 'completed', error: errorInfo ? { codexErrorInfo: errorInfo, message: 'SECRET_TOKEN' } : null };
    const notify = () => {
      send({ method: 'item/completed', params: { threadId, turnId, item: { type: 'agentMessage', id: 'item-1', text: mode === 'env-leak' ? process.env.AI_NEWS_HUB_ADMIN_TOKEN || process.env.GH_TOKEN || 'environment_isolated' : mode === 'empty' ? '' : mode === 'large-output' ? 'x'.repeat(70000) : mode === 'wrong-output' ? 'unexpected' : 'AI_NEWS_HUB_PROBE_OK' } } });
      send({ method: 'turn/completed', params: { threadId: mode === 'foreign' ? 'other-thread' : threadId, turn } });
    };
    if (mode === 'early') notify();
    send({ id: m.id, result: { turn: { id: turnId, status: 'inProgress' } } });
    if (mode !== 'early') notify();
    if (mode === 'foreign') setTimeout(() => process.exit(0), 20);
  }
});
