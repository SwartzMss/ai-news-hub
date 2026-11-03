export interface RssEntry {
  title: string; originalUrl: string; canonicalUrl: string; entryKey: string;
  publishedAt: string | null; excerpt: string;
}
export interface ArticleCandidate {
  id: string; title: string; originalUrl: string; canonicalUrl: string; sourceName: string;
  publishedAt: string | null; eventAt: string | null; fetchedAt: string; excerpt: string;
}
export interface Collection {
  articles: ArticleCandidate[]; cached: boolean; collectedAt: string;
}
