export interface HealthResponse {
  status: 'ok';
  database: 'ok';
}

export interface ErrorResponse {
  error: { code: string; message: string; requestId: string };
}

export type TaskStatus = 'active' | 'paused';
export type RunStatus = 'queued' | 'running' | 'waiting_approval' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
export type ContentKind = 'fact' | 'opinion' | 'unverified';

export interface TaskRecord {
  id: string; name: string; channel: string; prompt: string; status: TaskStatus;
}
export interface RunRecord {
  id: string; task_id: string; idempotency_key: string; status: RunStatus;
  thread_id: string | null; turn_id: string | null;
  started_at: string | null; finished_at: string | null;
  error_code: string | null; created_at: string; updated_at: string;
}
export interface TurnRecord {
  mode: 'default' | 'research' | 'finalize';
  id: string; run_id: string; sequence: number; idempotency_key: string;
  input_text: string; thread_id: string | null; server_turn_id: string | null;
  status: RunStatus; output_text: string | null; error_code: string | null;
  started_at: string | null; finished_at: string | null; created_at: string;
}
export interface RunEvent {
  id: number; run_id: string; turn_record_id: string | null;
  kind: string; data: Record<string, unknown>; created_at: string;
}
