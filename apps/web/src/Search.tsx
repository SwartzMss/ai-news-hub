import type { PublicData } from "./types";
import { Shell } from "./Shell";

export function SearchPage({ data }: { data: PublicData }) {
  return (
    <Shell data={data} active="search" page="search">
      <main id="content" className="search-page">
        <header className="search-heading">
          <p className="section-kicker">站内搜索</p>
          <h1>搜索文章</h1>
          <p>搜索最近 30 个北京时间自然日内发布的内容，覆盖全部话题。</p>
        </header>
        <form className="site-search-form" action="/search/" method="get" role="search" data-site-search-form>
          <label htmlFor="site-search-input">关键词</label>
          <div className="site-search-control">
            <input id="site-search-input" data-search-input type="search" name="q" maxLength={100} placeholder="搜索标题、摘要、话题或分类" autoComplete="off" />
            <button type="submit">搜索</button>
          </div>
          <p className="search-hint">支持标题、摘要、话题、分类和研究方向；多个关键词以空格分隔。</p>
        </form>
        <p className="search-status" data-search-status role="status" aria-live="polite">输入关键词开始搜索。</p>
        <ol className="search-results" data-search-results aria-label="搜索结果" />
        <noscript><p className="search-noscript">搜索功能需要启用 JavaScript。</p></noscript>
      </main>
    </Shell>
  );
}
