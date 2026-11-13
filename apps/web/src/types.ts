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
export type SocialPlatform = "weibo"|"douyin"|"bilibili"|"xiaohongshu"|"zhihu"|"x"|"reddit"|"other";
export type TrendTag = "cross_platform"|"single_platform"|"controversial"|"viral_video"|"sustained_discussion";
export type ContentTag = "short_video"|"debate"|"story_reversal"|"explainer"|"emotional_resonance"|"entertainment"|"not_suitable";
export interface NewsDetails {
  kind: "news";
  background: string;
  keyFacts?: {name:string;value:string;unit?:string;period?:string;nature:"confirmed"|"statement"|"reported"|"estimate"|"inference";evidenceRefs:string[]}[];
  timeline?: {time:string;precision:"date"|"datetime"|"approximate";event:string;evidenceRefs:string[]}[];
  positions?: {actor:string;statement:string;form:"quote"|"paraphrase";evidenceRefs:string[]}[];
  impacts?: {description:string;status:"observed"|"analysis";evidenceRefs?:string[]}[];
  uncertainties?: string[];
  watchpoints?: string[];
  trendTags?: TrendTag[];
  contentTags?: ContentTag[];
  trendSignals?: {platform:SocialPlatform;contentType:"hashtag"|"post"|"video"|"thread"|"topic_page"|"other";metric:"rank"|"views"|"likes"|"comments"|"shares"|"posts"|"discussion"|"other";value:string;observedAt:string;evidenceType:"direct"|"reported";evidenceRefs:string[]}[];
  publicDiscussion?: {
    summary:string;
    evidenceRefs:string[];
    viewpoints?:{label:string;summary:string;sentiment:"supportive"|"critical"|"concerned"|"mixed"|"humorous"|"neutral";evidenceRefs:string[]}[];
    controversies?:{topic:string;sides:string[];evidenceRefs:string[]}[];
    representativeComments?:{platform:SocialPlatform;quote:string;evidenceRefs:string[]}[];
  };
  contentSuitability?:"recommended"|"not_recommended";
  contentReason?:string;
  contentAngles?:{angle:string;suggestedTitle:string;hook:string;corePoints:string[];evidenceRefs:string[]}[];
  evidence?: {id:string;name:string;url:string;supports:string}[];
}
export interface ProjectDetails {
  kind:'project'; overview:string;
  change?:{summary:string;version?:string;type?:'release'|'feature'|'technical'|'community';publishedAt?:string;evidenceRefs:string[]};
  technical?:{description:string;evidenceRefs:string[]}[];
  useCases?:{description:string;evidenceRefs:string[]}[];
  license?:{code:string;scope?:string;evidenceRefs:string[]};
  evaluation?:{description:string;nature:'fact'|'analysis';evidenceRefs?:string[]}[];
  evidence:{id:string;name:string;url:string;supports:string}[];
}
export type ResearchArea = 'agent' | 'rust' | 'multimedia' | 'performance_security' | 'decentralized';
export interface Story {
  topic: Topic;
  id: string;
  key: string;
  category: string;
  research_area?: ResearchArea;
  importance: number;
  fact_summary: string;
  analysis: string | null;
  details?: InvestmentDetails | NewsDetails | ProjectDetails;
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
  schema_version: 1 | 2 | 3 | 4;
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
