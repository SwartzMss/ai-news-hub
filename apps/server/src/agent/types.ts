export const AGENT_ERROR_CODES = [
  'cancelled', 'timeout', 'spawn_failed', 'process_exit', 'protocol_error', 'rpc_error',
  'auth_required', 'quota_exceeded', 'rate_limited', 'needs_approval', 'agent_failed',
  'interrupted', 'invalid_output', 'output_too_large', 'event_limit', 'cleanup_failed',
  'event_persistence_failed',
  'unexpected_tool',
] as const;
export class AgentError extends Error {
  readonly code: typeof AGENT_ERROR_CODES[number];
  constructor(code: string) {
    super('Agent execution failed');
    this.code = AGENT_ERROR_CODES.includes(code as AgentError['code']) ? code as AgentError['code'] : 'agent_failed';
  }
}
export type AgentEvent =
  | { type: 'process_spawned'; pid: number }
  | { type: 'initialized' }
  | { type: 'thread'; threadId: string }
  | { type: 'turn'; threadId: string; turnId: string }
  | { type: 'message'; text: string }
  | { type: 'approval_required' }
  | { type: 'rpc_failed'; method: string; rpcCode?: number }
  | { type: 'item_started'; itemType: 'commandExecution' | 'fileChange' | 'mcpToolCall' | 'webSearch' };
export interface AgentInput {
  runId: string; threadId?: string; input: string; cwd: string; model?: string;
  timeoutMs: number; signal: AbortSignal;
  outputSchema?: Record<string, unknown>; developerInstructions?: string; forbidTools?: boolean;
  webSearch?: boolean;
}
export interface AgentResult {
  status: 'completed' | 'failed' | 'interrupted'; threadId: string; turnId: string; output: string;
}
export interface AgentAdapter {
  execute(input: AgentInput, emit: (event: AgentEvent) => void): Promise<AgentResult>;
}
