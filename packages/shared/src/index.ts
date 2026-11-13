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

export interface TaskSchedule {
  kind: 'manual' | 'once' | 'interval' | 'daily' | 'weekly';
  at?: string; minutes?: number; time?: string; weekday?: number;
}
export interface TaskConfiguration {
  /** Stable identity of the selected versioned prompt template; independent of the editable topic label. */
  templateId?: string; templateVersion?: number;
  topic: string; prompts: string[]; autoPublish: boolean; schedule: TaskSchedule; timezone: string;
}
export interface TaskRecord {
  configuration?: TaskConfiguration; next_run_at?: string | null; deleted_at?: string | null;
  id: string; name: string; channel: string; prompt: string; status: TaskStatus;
}
export interface RunRecord {
  configuration?: TaskConfiguration; publishing?: boolean;
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

export type RunListState = 'all' | 'running' | 'pending_review' | 'publish_failed' | 'failed' | 'published';
export interface RunListQuery { taskId?: string; state?: RunListState; limit?: number; offset?: number }
export interface RunSummary {
  run: RunRecord; task_name: string; task_deleted: boolean;
  state: Exclude<RunListState,'all'> | 'completed';
  latest_turn: Pick<TurnRecord,'sequence'|'mode'|'status'|'error_code'> | null;
  report: {id:string;status:string;title:string} | null;
  publication: {status:string;error_code:string|null;commit_sha:string|null} | null;
}
export interface RunListResponse { runs:RunSummary[]; total:number;limit:number;offset:number }

/** Counts cover configured tasks and their run snapshots, including deleted task history. */
export interface OverviewDay {
  date: string; total: number; succeeded: number; failed: number; stopped: number; active: number;
}
export interface OverviewResponse {
  timezone: 'Asia/Shanghai'; generatedAt: string;
  tasks: {total:number; manual:number; scheduled:number; paused:number};
  todayRuns:number; running:number; queued:number;
  pendingReview:number; pendingPublish:number; publishFailed:number; recentFailures:number;
  daily:OverviewDay[]; recentRuns:RunSummary[];
}
