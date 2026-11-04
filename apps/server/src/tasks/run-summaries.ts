import type { DatabaseSync } from 'node:sqlite';
import type { RunListQuery, RunListResponse, RunSummary, RunRecord } from '../../../../packages/shared/src/index.js';

// Scalar lookups select exactly one child row per Run: pagination never multiplies
// a Run when it has several Turns, reports or publication attempts.
const joined = `SELECT r.id, r.created_at, t.name task_name, t.deleted_at task_deleted,
  turn.sequence turn_sequence,turn.mode turn_mode,turn.status turn_status,turn.error_code turn_error,
  report.id report_id,report.status report_status,report.title report_title,
  publication.status publication_status,publication.error_code publication_error,publication.commit_sha,
  CASE
    WHEN r.status IN ('queued','running','waiting_approval') OR publication.status='publishing' THEN 'running'
    WHEN publication.status='failed' OR (r.status='succeeded' AND r.error_code IS NOT NULL AND report.id IS NOT NULL) THEN 'publish_failed'
    WHEN publication.status='succeeded' OR report.status='published' THEN 'published'
    WHEN r.status IN ('failed','cancelled','interrupted') THEN 'failed'
    WHEN report.status IN ('validated','approved') THEN 'pending_review'
    ELSE 'completed'
  END state
 FROM task_runs r JOIN tasks t ON t.id=r.task_id
 LEFT JOIN run_turns turn ON turn.id=(SELECT id FROM run_turns WHERE run_id=r.id ORDER BY sequence DESC,id DESC LIMIT 1)
 LEFT JOIN reports report ON report.id=(SELECT id FROM reports WHERE run_id=r.id ORDER BY created_at DESC,id DESC LIMIT 1)
 LEFT JOIN publication_records publication ON publication.id=(SELECT id FROM publication_records WHERE report_id=report.id AND target='github' ORDER BY updated_at DESC,created_at DESC,id DESC LIMIT 1)
 WHERE (? IS NULL OR r.task_id=?)`;
export function listRunSummaries(db:DatabaseSync, query:RunListQuery, readRun:(id:string)=>RunRecord):RunListResponse {
  const {limit=20,offset=0,state='all',taskId}=query;
  const cte=`WITH summaries AS (${joined})`;
  const filter=" WHERE (?='all' OR state=?)";
  const values=[taskId??null,taskId??null,state,state];
  const total=Number(db.prepare(`${cte} SELECT count(*) total FROM summaries${filter}`).get(...values)?.total??0);
  const rows=db.prepare(`${cte} SELECT * FROM summaries${filter} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`).all(...values,limit,offset);
  return {total,limit,offset,runs:rows.map(row=>({
    run:readRun(String(row.id)),task_name:String(row.task_name),task_deleted:row.task_deleted!==null,
    state:row.state as RunSummary['state'],
    latest_turn:row.turn_sequence===null?null:{sequence:Number(row.turn_sequence),mode:row.turn_mode as NonNullable<RunSummary['latest_turn']>['mode'],status:row.turn_status as NonNullable<RunSummary['latest_turn']>['status'],error_code:row.turn_error as string|null},
    report:row.report_id===null?null:{id:String(row.report_id),status:String(row.report_status),title:String(row.report_title)},
    publication:row.publication_status===null?null:{status:String(row.publication_status),error_code:row.publication_error as string|null,commit_sha:row.commit_sha as string|null},
  }))};
}
