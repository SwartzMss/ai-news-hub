export interface Topic {
  id: string;
  name: string;
}
export interface TopicSummary extends Topic {
  latest: Report;
  reportCount: number;
}
export interface Story {
  topic: Topic;
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
  schema_version: 1 | 2;
  topic: Topic;
  report_id: string;
  report_date: string;
  channel: string;
  version: number;
  title: string;
  approved_at: string;
  collected_at: string;
  items: Story[];
}
export interface PublicData {
  topics: TopicSummary[];
  reports: Report[];
  latest: Report[];
  articles: Story[];
  current: Story[];
  demo: boolean;
}
export interface Page {
  kind:
    | "home"
    | "topic"
    | "channel"
    | "article"
    | "archive"
    | "topicArchive"
    | "date"
    | "report"
    | "404";
  path: string;
  topicId?: string;
  canonicalPath?: string;
  date?: string;
  version?: number;
  key?: string;
}
