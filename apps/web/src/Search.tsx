import type { PublicData } from "./types";
import { Shell } from "./Shell";

export function SearchPage({ data }: { data: PublicData }) {
  return (
    <Shell data={data} active="search" page="search">
      <main id="content" className="search-page">
        <form className="site-search-form" action="/search/" method="get" role="search" data-site-search-form>
          <div className="site-search-control">
            <input
              id="site-search-input"
              data-search-input
              type="search"
              name="q"
              maxLength={100}
              placeholder="输入关键词搜索文章"
              aria-label="搜索文章"
              autoComplete="off"
            />
            <button type="submit">搜索</button>
          </div>
        </form>
        <p className="search-status" data-search-status role="status" aria-live="polite" />
        <ol className="search-results" data-search-results aria-label="搜索结果" />
        <noscript><p className="search-noscript">搜索功能需要启用 JavaScript。</p></noscript>
      </main>
    </Shell>
  );
}
