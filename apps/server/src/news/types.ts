export interface ArticleCandidate {
  id: string; title: string; originalUrl: string; canonicalUrl: string; sourceName: string;
  publishedAt: string | null; eventAt: string | null; fetchedAt: string; excerpt: string;
}
