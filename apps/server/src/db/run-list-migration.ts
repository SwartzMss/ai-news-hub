export const runListMigration = {version:8,name:'run_results_listing_indexes',sql:`
  CREATE INDEX task_runs_by_created ON task_runs(created_at DESC,id DESC);
  CREATE INDEX reports_by_run_created ON reports(run_id,created_at DESC,id DESC);
  CREATE INDEX publications_by_report_updated ON publication_records(report_id,target,updated_at DESC,created_at DESC,id DESC);
`};
