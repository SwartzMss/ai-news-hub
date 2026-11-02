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
