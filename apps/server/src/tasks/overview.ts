import type { DatabaseSync } from "node:sqlite";
import type {
  OverviewDay,
  OverviewResponse,
  RunRecord,
} from "../../../../packages/shared/src/index.js";
import { listRunSummaries, runSummarySelect } from "./run-summaries.js";

const DAY = 86400000;
const SHANGHAI_OFFSET = 8 * 3600000;
export function buildOverview(
  db: DatabaseSync,
  at: Date,
  readRun: (id: string) => RunRecord,
): OverviewResponse {
  const today = new Date(at.getTime() + SHANGHAI_OFFSET)
    .toISOString()
    .slice(0, 10);
  const daily: OverviewDay[] = Array.from({ length: 7 }, (_, i) => ({
    date: new Date(Date.parse(today + "T00:00:00Z") - (6 - i) * DAY)
      .toISOString()
      .slice(0, 10),
    total: 0,
    succeeded: 0,
    failed: 0,
    stopped: 0,
    active: 0,
  }));
  const tasks = { total: 0, manual: 0, scheduled: 0, paused: 0 };
  for (const row of db
    .prepare(
      `SELECT status,json_extract(configuration_json,'$.schedule.kind') kind,count(*) n
    FROM tasks WHERE configuration_json IS NOT NULL AND deleted_at IS NULL GROUP BY status,kind`,
    )
    .all()) {
    const n = Number(row.n);
    tasks.total += n;
    if (row.kind === "manual") tasks.manual += n;
    else if (row.status === "active") tasks.scheduled += n;
    else tasks.paused += n;
  }
  const start = new Date(
    Date.parse(daily[0].date + "T00:00:00Z") - SHANGHAI_OFFSET,
  ).toISOString();
  const end = new Date(
    Date.parse(today + "T00:00:00Z") + DAY - SHANGHAI_OFFSET,
  ).toISOString();
  for (const row of db
    .prepare(
      `SELECT date(created_at,'+8 hours') day,count(*) total,
    sum(status='succeeded') succeeded,sum(status='failed') failed,
    sum(status IN ('cancelled','interrupted')) stopped,
    sum(status IN ('queued','running','waiting_approval')) active
    FROM task_runs WHERE configuration_json IS NOT NULL AND created_at>=? AND created_at<? GROUP BY day`,
    )
    .all(start, end)) {
    const day = daily.find((d) => d.date === row.day);
    if (day)
      for (const key of [
        "total",
        "succeeded",
        "failed",
        "stopped",
        "active",
      ] as const)
        day[key] = Number(row[key]);
  }
  // Reuse the same latest-report/publication state rules as the result list.
  const row = db
    .prepare(
      `WITH summaries AS (${runSummarySelect} WHERE r.configuration_json IS NOT NULL)
    SELECT coalesce(sum(state='running' AND run_status!='queued'),0) running,
      coalesce(sum(run_status='queued'),0) queued,
      coalesce(sum(state='pending_review' AND report_status='validated'),0) pendingReview,
      coalesce(sum(state='pending_review' AND report_status='approved'),0) pendingPublish,
      coalesce(sum(state='publish_failed'),0) publishFailed
    FROM summaries`,
    )
    .get()!;
  return {
    timezone: "Asia/Shanghai",
    generatedAt: at.toISOString(),
    tasks,
    todayRuns: daily[6].total,
    running: Number(row.running),
    queued: Number(row.queued),
    pendingReview: Number(row.pendingReview),
    pendingPublish: Number(row.pendingPublish),
    publishFailed: Number(row.publishFailed),
    recentFailures: daily.reduce((n, d) => n + d.failed + d.stopped, 0),
    daily,
    recentRuns: listRunSummaries(db, { limit: 5 }, readRun, true).runs,
  };
}
