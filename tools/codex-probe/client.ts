import { codexEnvironment } from '../../packages/shared/src/agent-environment.js';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';

type RecordValue = Record<string, any>;
export class ProbeError extends Error {
  constructor(public readonly code: string) { super(code); }
}
export interface ProbeOptions {
  binary: string;
  args?: string[];
  cwd: string;
  model?: string;
  timeoutMs: number;
  signal?: AbortSignal;
  log?: (event: RecordValue) => void;
}
export interface ProbeResult {
  status: 'completed'; runId: string; threadId: string; turnId: string;
}
const MARKER = 'AI_NEWS_HUB_PROBE_OK';
const MAX_LINE = 1024 * 1024;

// This bounded diagnostic deliberately supports one Run and one active RPC.
// It remains separate from the durable Backend adapter.
export async function runProbe(options: ProbeOptions): Promise<ProbeResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1) throw new ProbeError('invalid_config');
  if (options.signal?.aborted) throw new ProbeError('cancelled');
  const runId = randomUUID();
  let threadId = '', turnId = '';
  const log = (event: string, extra: RecordValue = {}) => options.log?.({
    timestamp: new Date().toISOString(), event, runId, ...extra,
  });
  const child = spawn(options.binary, options.args ?? ['app-server', '--listen', 'stdio://'], {
    cwd: options.cwd, env: codexEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: true,
  });
  // Drain stderr, never forward it: it can contain private config or token material.
  child.stderr.resume();
  let closed = false;
  const childClosed = new Promise<void>((resolve) => child.once('close', () => { closed = true; resolve(); }));
  let abort = () => {};
  let timer: NodeJS.Timeout | undefined;
  log('spawned', { pid: child.pid });
  try {
    return await new Promise<ProbeResult>((resolve, reject) => {
      let done = false, seq = 0, pendingId = 0, phase = '';
      let buffer = '';
      const completions: RecordValue[] = [];
      const messages = new Map<string, { text: string; final: boolean }>();
      const fail = (code: string) => {
        if (done) return;
        done = true;
        log('failed', { code, threadId: threadId || undefined, turnId: turnId || undefined });
        reject(new ProbeError(code));
      };
      const send = (message: RecordValue) => {
        if (!done) child.stdin.write(JSON.stringify(message) + '\n');
      };
      const request = (method: string, params: RecordValue) => {
        phase = method; pendingId = ++seq;
        send({ id: pendingId, method, params });
      };
      const finish = () => {
        if (!turnId || done) return;
        const event = completions.find((p) => p.threadId === threadId && p.turn?.id === turnId);
        if (!event) return;
        const status = event.turn.status;
        if (status !== 'completed') {
          const info = event.turn.error?.codexErrorInfo;
          const http = typeof info === 'object' && info !== null ? info.httpConnectionFailed?.httpStatusCode : undefined;
          const code = info === 'usageLimitExceeded' ? 'quota_exceeded'
            : info === 'rateLimitExceeded' || http === 429 ? 'rate_limited'
            : info === 'unauthorized' || http === 401 || http === 403 ? 'auth_required'
            : status === 'interrupted' ? 'interrupted' : 'agent_failed';
          fail(code);
          return;
        }
        if (messages.get(`${threadId}/${turnId}`)?.text.trim() !== MARKER) { fail('invalid_output'); return; }
        done = true;
        log('completed', { threadId, turnId });
        resolve({ status: 'completed', runId, threadId, turnId });
      };
      const receive = (m: RecordValue) => {
        if (done) return;
        if (!m || typeof m !== 'object' || Array.isArray(m)) { fail('protocol_error'); return; }
        if (typeof m.method === 'string') {
          if (m.id !== undefined) {
            // Refuse every server-initiated action, including unknown future methods.
            send({ id: m.id, error: { code: -32601, message: 'Unattended probe does not authorize server requests' } });
            fail('needs_approval'); return;
          }
          const p = m.params;
          if (m.method === 'turn/completed') {
            if (!p?.turn?.id || !p.threadId || completions.length >= 32) { fail('protocol_error'); return; }
            completions.push(p); finish();
          } else if (m.method === 'item/completed' && p?.item?.type === 'agentMessage') {
            if (typeof p.item.text !== 'string' || messages.size >= 32) { fail('protocol_error'); return; }
            if (p.item.phase != null && typeof p.item.phase !== 'string') { fail('protocol_error'); return; }
            if (['commentary', 'partial_answer'].includes(p.item.phase)) return;
            const key = `${p.threadId}/${p.turnId}`;
            const final = p.item.phase === 'final_answer';
            if (!messages.get(key)?.final || final) messages.set(key, { text: p.item.text, final });
          }
          return;
        }
        if (m.id !== pendingId) { fail('protocol_error'); return; }
        if (m.error) {
          const text = typeof m.error.message === 'string' ? m.error.message : '';
          const hints = Object.entries({ auth: /auth|token|login|credential/i, timeout: /timed? ?out|timeout/i,
            connection: /connect|socket/i, permissions: /permission|denied/i,
          }).filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
          log('rpc_failed', { method: phase, rpcCode: typeof m.error.code === 'number' ? m.error.code : undefined, hints });
          fail('rpc_error'); return;
        }
        if (!m.result || typeof m.result !== 'object') { fail('protocol_error'); return; }
        const result = m.result;
        if (phase === 'initialize') {
          send({ method: 'initialized' }); log('initialized');
          request('account/read', { refreshToken: false });
        } else if (phase === 'account/read') {
          if (!result.account && result.requiresOpenaiAuth !== false) { fail('auth_required'); return; }
          log('account_available');
          request('thread/start', {
            cwd: options.cwd, model: options.model,
            sandbox: 'read-only', approvalPolicy: 'untrusted',
            developerInstructions: 'This is a connectivity probe. Do not invoke tools, delegate, or access files. Reply only with ' + MARKER,
          });
        } else if (phase === 'thread/start') {
          if (typeof result.thread?.id !== 'string' || !result.thread.id) { fail('protocol_error'); return; }
          threadId = result.thread.id;
          log('thread_started', { threadId });
          request('turn/start', { threadId, input: [{ type: 'text', text: 'Reply exactly ' + MARKER + '. Do not use tools.', text_elements: [] }] });
        } else if (phase === 'turn/start') {
          if (typeof result.turn?.id !== 'string' || !result.turn.id) { fail('protocol_error'); return; }
          turnId = result.turn.id; phase = 'waiting'; pendingId = -1;
          log('turn_started', { threadId, turnId }); finish();
        } else { fail('protocol_error'); }
      };
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk: string) => {
        if (done) return;
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf('\n')) !== -1) {
          if (newline > MAX_LINE) { fail('protocol_error'); return; }
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try { receive(JSON.parse(line)); } catch { fail('protocol_error'); }
          if (done) return;
        }
        if (Buffer.byteLength(buffer) > MAX_LINE) fail('protocol_error');
      });
      child.once('error', () => fail('spawn_failed'));
      child.stdin.on('error', () => fail('process_exit'));
      child.stdout.once('end', () => fail('process_exit'));
      child.once('exit', () => fail('process_exit'));
      abort = () => fail('cancelled');
      options.signal?.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => fail('timeout'), options.timeoutMs);
      request('initialize', { clientInfo: { name: 'ai_news_hub_probe', title: 'AI News Hub Probe', version: '0.1.0' } });
    });
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', abort);
    child.stdin.end();
    const killGroup = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try { process.kill(-child.pid, signal); }
      catch { if (!closed) child.kill(signal); }
    };
    killGroup('SIGTERM');
    if (!closed) {
      // A grandchild can retain the pipes after the immediate child exits.
      // Terminate the dedicated Linux process group, not just the leader.
      const killer = setTimeout(() => killGroup('SIGKILL'), 1500);
      let deadline: NodeJS.Timeout | undefined;
      const reaped = await Promise.race([
        childClosed.then(() => true),
        new Promise<boolean>((resolve) => { deadline = setTimeout(() => resolve(false), 2500); }),
      ]);
      clearTimeout(killer);
      clearTimeout(deadline);
      // Even after close, descendants without inherited pipes can still exist.
      killGroup('SIGKILL');
      if (!reaped) {
        child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
        log('failed', { code: 'cleanup_failed' });
        throw new ProbeError('cleanup_failed');
      }
    } else killGroup('SIGKILL');
    log('child_closed');
  }
}
