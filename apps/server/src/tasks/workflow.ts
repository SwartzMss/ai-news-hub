import type { DatabaseSync } from 'node:sqlite';
import type { RunRecord } from '../../../../packages/shared/src/index.js';

export interface PreparedTask {
  input: string;
  outputSchema?: Record<string, unknown>;
  developerInstructions?: string;
  forbidTools?: boolean;
  metadata?: Record<string, string | number | boolean>;
  // Synchronous: called in the same transaction as the successful Run/Turn.
  save?: (db: DatabaseSync, output: string) => void;
}
export interface TaskWorkflow {
  prepare(run: RunRecord, signal: AbortSignal): Promise<PreparedTask>;
}
