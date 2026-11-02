import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { AppError } from '../errors.js';

function processStart(pid: number): string {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
  // comm may contain spaces or parentheses; field 22 starts after the final ')'.
  return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19];
}

// A transactional same-host lease prevents two Backends from recovering each
// other's live Runs. PID + boot + start time distinguish stale/reused PIDs.
export function acquireBackendLock(db: DatabaseSync): () => void {
  const boot = readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
  const start = processStart(process.pid);
  const owner = randomUUID();
  db.exec('BEGIN IMMEDIATE');
  try {
    const previous = db.prepare('SELECT * FROM backend_owner WHERE singleton=1').get();
    if (previous && previous.boot_id === boot) {
      let alive = true;
      try { alive = processStart(Number(previous.pid)) === previous.process_start; }
      catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT') alive = false;
      }
      if (alive) throw new AppError('backend_already_running');
    }
    db.prepare(`INSERT OR REPLACE INTO backend_owner (singleton,owner_id,pid,process_start,boot_id)
      VALUES (1,?,?,?,?)`).run(owner, process.pid, start, boot);
    db.exec('COMMIT');
  } catch (error) { db.exec('ROLLBACK'); throw error; }
  return () => { db.prepare('DELETE FROM backend_owner WHERE singleton=1 AND owner_id=?').run(owner); };
}
