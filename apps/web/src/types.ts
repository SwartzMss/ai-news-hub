export interface Topic {
  id: string;
  name: string;
}
export interface TopicSummary extends Topic {
  latest: Report;
  reportCount: number;
}
export interface InvestmentDetails {
  kind: "investment";
  background: string;
  metrics?: {name:string;value:string;unit:string;period:string;comparison?:string;basis:"actual"|"guidance"|"consensus"|"estimate"|"inference";evidenceRefs:string[]}[];
  supplyChain?: {segment:string;direction:string;reason:string;relationship:"confirmed"|"potential";evidenceRefs?:string[]}[];
  investmentLogic?: string;
  watchpoints?: string[];
  risks?: string[];
  valuation?: string;
  evidence?: {id:string;name:string;url:string;supports:string}[];
}
export interface NewsDetails {
  kind: "news";
  background: string;
  keyFacts?: {name:string;value:string;unit?:string;period?:string;nature:"confirmed"|"statement"|"reported"|"estimate"|"inference";evidenceRefs:string[]}[];
  timeline?: {time:string;precision:"date"|"datetime"|"approximate";event:string;evidenceRefs:string[]}[];
  positions?: {actor:string;statement:string;form:"quote"|"paraphrase";evidenceRefs:string[]}[];
  impacts?: {description:string;status:"observed"|"analysis";evidenceRefs?:string[]}[];
  uncertainties?: string[];
  watchpoints?: string[];
  evidence?: {id:string;name:string;url:string;supports:string}[];
}
export interface Story {
  topic: Topic;
  id: string;
  key: string;
  category: string;
  importance: number;
  fact_summary: string;
  analysis: string | null;
  details?: InvestmentDetails | NewsDetails;
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
  newsletterEnabled?: boolean;
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
