export interface Story {
  id: string;
  key: string;
  category: string;
  importance: number;
  fact_summary: string;
  analysis: string | null;
  evidence_quote: string;
  verification: "source_only" | "codex_reported";
  source: {
    name: string;
    original_url: string;
    canonical_url: string;
    published_at: string | null;
    event_at: string | null;
    fetched_at: string | null;
  };
  report_date: string;
  report_version: number;
  first_approved_at: string;
}
export interface Report {
  schema_version: 1;
  report_id: string;
  report_date: string;
  channel: string;
  version: number;
  title: string;
  approved_at: string;
  items: Story[];
}
export interface PublicData {
  reports: Report[];
  latest: Report[];
  articles: Story[];
  current: Story[];
  demo: boolean;
}
export interface Page {
  kind: "home" | "channel" | "article" | "archive" | "date" | "report" | "404";
  path: string;
  date?: string;
  version?: number;
  key?: string;
}
