import type { DatabaseSync } from 'node:sqlite';
import type { RunRecord } from '../../../../packages/shared/src/index.js';

export interface PreparedTask {
  input: string;
  outputSchema?: Record<string, unknown>;
  developerInstructions?: string;
  forbidTools?: boolean;
  webSearch?: boolean;
  metadata?: Record<string, string | number | boolean>;
  // Synchronous: called in the same transaction as the successful Run/Turn.
  save?: (db: DatabaseSync, output: string) => void;
  complete?: (output: string, signal: AbortSignal) => Promise<(db: DatabaseSync) => void>;
}
export interface TaskWorkflow {
  prepare(run: RunRecord, signal: AbortSignal, context: { input: string; mode: 'default' | 'research' | 'finalize' }): Promise<PreparedTask>;
}
