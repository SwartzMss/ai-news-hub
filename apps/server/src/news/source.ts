export interface FeedSource {
  id: string; name: string; feedUrl: string; articleHosts: readonly string[]; minIntervalMs: number;
}
export const GITHUB_SOURCE: FeedSource = {
  id: 'github-blog', name: 'GitHub Blog', feedUrl: 'https://github.blog/feed/',
  articleHosts: ['github.blog'], minIntervalMs: 300000,
};
export const NEWS_TASK_ID = 'news-github';
export const NEWS_CHANNEL = 'opensource';
