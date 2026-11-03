import { spawn } from 'node:child_process';
import { AgentError, type AgentAdapter, type AgentEvent, type AgentInput, type AgentResult } from './types.js';
import { codexEnvironment } from './environment.js';

interface WireTurn { id?: string; status?: string; error?: { codexErrorInfo?: string | { httpConnectionFailed?: { httpStatusCode?: number } } } }
interface WireMessage {
  id?: string | number; method?: string;
  error?: { code?: number };
  result?: { account?: object | null; requiresOpenaiAuth?: boolean; thread?: { id?: string }; turn?: WireTurn };
  params?: { threadId?: string; turnId?: string; turn?: WireTurn; item?: { id?: string; type?: string; text?: string; phase?: string | null } };
}
const idValid = (id: unknown): id is string => typeof id === 'string' && id.length > 0 && id.length <= 256;

export class StdioAdapter implements AgentAdapter {
  constructor(private binary = 'codex', private args = ['app-server', '--listen', 'stdio://']) {}

  async execute(input: AgentInput, onEvent: (event: AgentEvent) => void): Promise<AgentResult> {
    if (input.signal.aborted) throw new AgentError('cancelled');
    const child = spawn(this.binary, this.args, { cwd: input.cwd, env: codexEnvironment(), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
    child.stderr.resume(); // Never persist raw stderr, RPC errors or tool arguments.
    let closed = false;
    const childClosed = new Promise<void>((resolve) => child.once('close', () => { closed = true; resolve(); }));
    let timer: NodeJS.Timeout | undefined;
    let abort = () => {};
    let result: AgentResult | undefined;
    let failure: unknown;
    try {
      result = await new Promise<AgentResult>((resolve, reject) => {
        let done = false, sequence = 0, pending = 0, phase = '';
        let buffer = '', threadId = '', turnId = '';
        const terminal: NonNullable<WireMessage['params']>[] = [];
        const messages = new Map<string, { threadId: string; turnId: string; text: string; phase?: string | null }>();
        const fail = (code: string) => { if (!done) { done = true; reject(new AgentError(code)); } };
        const emit = (event: AgentEvent) => {
          try { onEvent(event); }
          catch (error) { fail(error instanceof AgentError ? error.code : 'event_persistence_failed'); }
        };
        const send = (message: object) => { if (!done) child.stdin.write(JSON.stringify(message) + '\n'); };
        const request = (method: string, params: object) => {
          phase = method; pending = ++sequence; send({ id: pending, method, params });
        };
        const finish = () => {
          if (!turnId || done) return;
          const event = terminal.find((p) => p.threadId === threadId && p.turn?.id === turnId);
          if (!event?.turn) return;
          if (event.turn.status !== 'completed') {
            const info = event.turn.error?.codexErrorInfo;
            const http = typeof info === 'object' && info !== null ? info.httpConnectionFailed?.httpStatusCode : undefined;
            fail(info === 'usageLimitExceeded' ? 'quota_exceeded'
              : info === 'rateLimitExceeded' || http === 429 ? 'rate_limited'
              : info === 'unauthorized' || http === 401 || http === 403 ? 'auth_required'
              : event.turn.status === 'interrupted' ? 'interrupted' : 'agent_failed');
            return;
          }
          const matching = [...messages.values()].filter((m) => m.threadId === threadId && m.turnId === turnId);
          const progress = (message: { phase?: string | null }) => ['commentary', 'partial_answer'].includes(message.phase ?? '');
          // Explicit progress belongs in the Run log, never in a structured result.
          for (const message of matching.filter(progress)) emit({ type: 'message', text: message.text });
          if (done) return;
          const finals = matching.filter((m) => m.phase === 'final_answer');
          // Older and future protocol versions may omit phase or introduce new values.
          const output = (finals.length ? finals : matching.filter((m) => !progress(m))).map((m) => m.text).join('\n');
          if (!output.trim()) { fail('invalid_output'); return; }
          if (Buffer.byteLength(output) > 64 * 1024) { fail('output_too_large'); return; }
          emit({ type: 'message', text: output });
          if (done) return;
          done = true; resolve({ status: 'completed', threadId, turnId, output });
        };
        const receive = (m: WireMessage) => {
          if (done) return;
          if (!m || typeof m !== 'object' || Array.isArray(m)) { fail('protocol_error'); return; }
          if (typeof m.method === 'string') {
            if (m.id !== undefined) {
              send({ id: m.id, error: { code: -32601, message: 'Server requests are not authorized for unattended Runs' } });
              emit({ type: 'approval_required' }); fail('needs_approval'); return;
            }
            const p = m.params;
            if (m.method === 'item/started' && input.forbidTools && p?.item?.type
              && !['userMessage', 'agentMessage', 'reasoning', 'plan', 'contextCompaction'].includes(p.item.type)) {
              fail('unexpected_tool'); return;
            }
            if (m.method === 'turn/completed') {
              if (!idValid(p?.threadId) || !idValid(p?.turn?.id) || terminal.length >= 32) { fail('protocol_error'); return; }
              terminal.push(p!); finish();
            } else if (m.method === 'item/completed' && p?.item?.type === 'agentMessage') {
              if (!idValid(p.threadId) || !idValid(p.turnId) || !idValid(p.item.id) || typeof p.item.text !== 'string' || (p.item.phase != null && typeof p.item.phase !== 'string') || messages.size >= 32) { fail('protocol_error'); return; }
              if (Buffer.byteLength(p.item.text) > 64 * 1024) { fail('output_too_large'); return; }
              // Keep early notifications until turn/start gives the authoritative ID.
              messages.set(`${p.threadId}/${p.turnId}/${p.item.id}`, { threadId: p.threadId, turnId: p.turnId, text: p.item.text, phase: p.item.phase });
            } else if (m.method === 'item/started' && p?.item && ['commandExecution', 'fileChange', 'mcpToolCall'].includes(p.item.type ?? '')) {
              emit({ type: 'item_started', itemType: p.item.type as 'commandExecution' | 'fileChange' | 'mcpToolCall' });
            }
            return;
          }
          if (m.id !== pending) { fail('protocol_error'); return; }
          if (m.error) {
            emit({ type: 'rpc_failed', method: phase, rpcCode: typeof m.error.code === 'number' ? m.error.code : undefined });
            fail('rpc_error'); return;
          }
          const r = m.result;
          if (!r || typeof r !== 'object' || Array.isArray(r)) { fail('protocol_error'); return; }
          if (phase === 'initialize') {
            send({ method: 'initialized' }); emit({ type: 'initialized' });
            request('account/read', { refreshToken: false });
          } else if (phase === 'account/read') {
            if (!r.account && r.requiresOpenaiAuth !== false) { fail('auth_required'); return; }
            request(input.threadId ? 'thread/resume' : 'thread/start', {
              ...(input.threadId ? { threadId: input.threadId } : {}),
              cwd: input.cwd, sandbox: 'read-only', approvalPolicy: 'untrusted', model: input.model,
              developerInstructions: input.developerInstructions,
            });
          } else if (phase === 'thread/start' || phase === 'thread/resume') {
            if (!idValid(r.thread?.id) || (input.threadId && r.thread.id !== input.threadId)) { fail('protocol_error'); return; }
            threadId = r.thread.id; emit({ type: 'thread', threadId });
            request('turn/start', { threadId, input: [{ type: 'text', text: input.input, text_elements: [] }], outputSchema: input.outputSchema });
          } else if (phase === 'turn/start') {
            if (!idValid(r.turn?.id)) { fail('protocol_error'); return; }
            turnId = r.turn.id; pending = -1; phase = 'waiting';
            emit({ type: 'turn', threadId, turnId });
            finish();
          } else fail('protocol_error');
        };
        child.stdout.setEncoding('utf8');
        child.stdout.on('data', (chunk: string) => {
          if (done) return;
          buffer += chunk;
          let newline: number;
          while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
            if (Buffer.byteLength(line) > 1024 * 1024) { fail('protocol_error'); return; }
            try { receive(JSON.parse(line) as WireMessage); } catch { fail('protocol_error'); }
            if (done) return;
          }
          if (Buffer.byteLength(buffer) > 1024 * 1024) fail('protocol_error');
        });
        child.once('error', () => fail('spawn_failed'));
        child.stdin.on('error', () => fail('process_exit'));
        child.stdout.once('end', () => fail('process_exit'));
        child.once('exit', () => fail('process_exit'));
        abort = () => {
          if (threadId && turnId) send({ id: ++sequence, method: 'turn/interrupt', params: { threadId, turnId } });
          fail('cancelled');
        };
        input.signal.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => fail('timeout'), input.timeoutMs);
        if (child.pid) emit({ type: 'process_spawned', pid: child.pid });
        request('initialize', { clientInfo: { name: 'ai_news_hub', title: 'AI News Hub', version: '0.1.0' } });
      });
    } catch (error) { failure = error; }
    finally {
      clearTimeout(timer); input.signal.removeEventListener('abort', abort);
      child.stdin.end();
      const killGroup = (signal: NodeJS.Signals) => {
        if (!child.pid) return;
        try { process.kill(-child.pid, signal); } catch { if (!closed) child.kill(signal); }
      };
      killGroup('SIGTERM');
      if (!closed) {
        const killer = setTimeout(() => killGroup('SIGKILL'), 1500);
        let deadline: NodeJS.Timeout | undefined;
        const reaped = await Promise.race([childClosed.then(() => true), new Promise<boolean>((resolve) => {
          deadline = setTimeout(() => resolve(false), 2500);
        })]);
        clearTimeout(killer); clearTimeout(deadline); killGroup('SIGKILL');
        if (!reaped) {
          child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.unref();
          failure = new AgentError('cleanup_failed');
        }
      } else killGroup('SIGKILL');
    }
    if (failure) throw failure;
    return result!;
  }
}
