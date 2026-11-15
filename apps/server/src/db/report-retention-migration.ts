export const reportRetentionMigration = {
  version: 15,
  name: "report_date_retention_index",
  sql: 'CREATE INDEX reports_by_date ON reports(report_date,id);',
};
