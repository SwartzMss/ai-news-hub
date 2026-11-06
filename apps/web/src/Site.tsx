import type { PublicData, Page, Story, Report } from "./types";

const categories: Record<string, string> = {
  ai: "AI 与大模型",
  opensource: "开源项目",
  developer_tools: "开发工具",
  security: "安全动态",
  industry: "公司与产业",
  other: "综合资讯",
};
const reportPath = (r: Report) =>
  `/archive/${r.report_date}/opensource/v${String(r.version).padStart(6, "0")}/`;
const dateLabel = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "UTC",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value + "T00:00:00Z"));
const timeLabel = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
// Presentation only: keep the archived wording and original quote unchanged.
function lead(story: Story) {
  const index = story.fact_summary.search(/[。；\n]/u);
  return index > 0
    ? {
        title: story.fact_summary.slice(0, index),
        rest: story.fact_summary.slice(index + 1).trim(),
      }
    : { title: story.fact_summary, rest: "" };
}
function counts(items: Story[]) {
  return Object.entries(
    items.reduce<Record<string, number>>((result, item) => {
      result[item.category] = (result[item.category] ?? 0) + 1;
      return result;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
}
function Source({ story }: { story: Story }) {
  return (
    <details className="source-details">
      <summary>来源与引文</summary>
      <blockquote>{story.evidence_quote}</blockquote>
      <a
        href={story.source.canonical_url}
        target="_blank"
        rel="noopener noreferrer"
      >
        {story.source.name} · 查看原文 ↗
      </a>
      {(story.source.published_at ||
        story.source.event_at ||
        story.source.fetched_at) && (
        <dl>
          {story.source.published_at && (
            <>
              <dt>来源发布时间</dt>
              <dd>
                <time dateTime={story.source.published_at}>
                  {timeLabel(story.source.published_at)}
                </time>
              </dd>
            </>
          )}
          {story.source.event_at && (
            <>
              <dt>事件时间</dt>
              <dd>
                <time dateTime={story.source.event_at}>
                  {timeLabel(story.source.event_at)}
                </time>
              </dd>
            </>
          )}
          {story.source.fetched_at && (
            <>
              <dt>抓取时间</dt>
              <dd>
                <time dateTime={story.source.fetched_at}>
                  {timeLabel(story.source.fetched_at)}
                </time>
              </dd>
            </>
          )}
        </dl>
      )}
      {story.verification === "codex_reported" && (
        <p className="source-attribution">来源由 Codex 提供</p>
      )}
    </details>
  );
}
function Row({
  story,
  index,
  level = 2,
}: {
  story: Story;
  index: number;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2",
    text = lead(story);
  return (
    <article className="news-row">
      <span className="news-number" aria-hidden="true">
        {String(index + 1).padStart(2, "0")}
      </span>
      <div className="news-content">
        <div className="news-meta">
          <span className="category-label">
            {categories[story.category] ?? story.category}
          </span>
          <span>{story.source.name}</span>
        </div>
        <Heading>
          <a href={`/news/${story.key}/`}>{text.title}</a>
        </Heading>
        {text.rest && <p className="news-summary">{text.rest}</p>}
        <div className="news-footer">
          <a href={`/news/${story.key}/`}>查看详情</a>
          <a
            href={story.source.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
          >
            原文 ↗
          </a>
        </div>
      </div>
    </article>
  );
}
function Empty() {
  return (
    <div className="empty">
      <h2>还没有已发布的日报</h2>
    </div>
  );
}
function EditionLinks({
  reports,
  versioned = false,
}: {
  reports: Report[];
  versioned?: boolean;
}) {
  return (
    <ol className="edition-links">
      {reports.map((r) => (
        <li key={r.report_id}>
          <a href={versioned ? reportPath(r) : `/archive/${r.report_date}/`}>
            <time dateTime={r.report_date}>{dateLabel(r.report_date)}</time>
            <strong>{r.title}</strong>
            <span>{r.items.length} 条</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
export function Site({ data, page }: { data: PublicData; page: Page }) {
  const latest = data.latest[0],
    latestDate = latest?.report_date;
  const story = data.articles.find((item) => item.key === page.key);
  const daily = data.latest.find((r) => r.report_date === page.date);
  const selected =
    page.kind === "report"
      ? data.reports.find(
          (r) => r.report_date === page.date && r.version === page.version,
        )
      : daily;
  const selectedStories = selected?.items.map((item) => ({
    ...item,
    key: data.articles.find((s) => s.id === item.id)!.key,
    report_date: selected.report_date,
    report_version: selected.version,
    first_approved_at: selected.approved_at,
  }));
  const latestStories =
    latest?.items.map((item) => ({
      ...item,
      key: data.articles.find((s) => s.id === item.id)!.key,
      report_date: latest.report_date,
      report_version: latest.version,
      first_approved_at: latest.approved_at,
    })) ?? [];
  const owner = story
    ? data.reports.find(
        (r) =>
          r.report_date === story.report_date &&
          r.version === story.report_version,
      )
    : undefined;
  const nav =
    page.kind === "home" ||
    ((page.kind === "article" || page.kind === "date") &&
      (story?.report_date ?? selected?.report_date) === latestDate)
      ? "latest"
      : page.kind === "channel"
        ? "all"
        : "archive";
  const months = [
    ...new Set(data.latest.map((r) => r.report_date.slice(0, 7))),
  ];
  const versions = selected
    ? data.reports.filter((r) => r.report_date === selected.report_date)
    : [];
  const categoryCounts = counts(
    page.kind === "home" ? latestStories : data.current,
  );
  const aside = selectedStories?.length ? (
    <aside className="reading-aside">
      <nav aria-label="本期目录">
        <h2>本期目录</h2>
        <ol>
          {selectedStories.map((item, i) => (
            <li key={item.id}>
              <a href={`#story-${item.key}`}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                {lead(item).title}
              </a>
            </li>
          ))}
        </ol>
      </nav>
    </aside>
  ) : page.kind === "home" && data.latest.length > 1 ? (
    <aside className="reading-aside">
      <h2>往期简报</h2>
      <EditionLinks reports={data.latest.slice(1, 6)} />
      <a className="aside-more" href="/archive/">
        全部往期 →
      </a>
    </aside>
  ) : page.kind === "article" && owner ? (
    <aside className="reading-aside">
      <h2>所属简报</h2>
      <EditionLinks
        reports={[owner]}
        versioned={
          owner.version !==
          data.latest.find((r) => r.report_date === owner.report_date)?.version
        }
      />
      <a
        className="aside-more"
        href={
          owner.version ===
          data.latest.find((r) => r.report_date === owner.report_date)?.version
            ? `/archive/${owner.report_date}/`
            : reportPath(owner)
        }
      >
        阅读整期 →
      </a>
    </aside>
  ) : null;
  return (
    <div className="site-shell">
      <a className="skip-link" href="#content">
        跳到正文
      </a>
      <header className="masthead">
        <a className="brand" href="/" aria-label="AI News Hub 首页">
          <span className="brand-mark" aria-hidden="true">
            N<span />
          </span>
          <span>AI News Hub</span>
        </a>
        <nav className="site-nav" aria-label="主导航">
          <a href="/" aria-current={nav === "latest" ? "page" : undefined}>
            最新简报
          </a>
          <a
            href="/channel/opensource/"
            aria-current={nav === "all" ? "page" : undefined}
          >
            全部资讯
          </a>
          <a
            href="/archive/"
            aria-current={nav === "archive" ? "page" : undefined}
          >
            往期归档
          </a>
        </nav>
        <div className="header-actions">
          <a href="/rss/all.xml">RSS 订阅</a>
          <button
            id="theme-toggle"
            aria-label="切换明暗主题"
            aria-pressed="false"
            type="button"
          >
            ◐
          </button>
        </div>
      </header>
      {data.demo && <p className="demo-banner">演示 / 测试站点</p>}
      <div className={`reading-layout${aside ? " has-aside" : ""}`}>
        <main id="content">
          {page.kind === "home" &&
            (latest ? (
              <>
                <header className="issue-header latest-header">
                  <div className="issue-topline">
                    <span className="issue-label">最新一期</span>
                    <time dateTime={latest.report_date}>
                      {dateLabel(latest.report_date)}
                    </time>
                  </div>
                  <h1>{latest.title}</h1>
                  <div className="issue-meta">
                    <span>{latest.items.length} 条资讯</span>
                    <a href={`/archive/${latest.report_date}/`}>阅读整期</a>
                    <a href="/archive/">查看往期</a>
                  </div>
                </header>
                <nav className="category-links" aria-label="本期分类">
                  {categoryCounts.map(([key, n]) => (
                    <a key={key} href={`/channel/opensource/#category-${key}`}>
                      {categories[key] ?? key}
                      <span>{n}</span>
                    </a>
                  ))}
                </nav>
                <div className="news-list">
                  {latestStories.map((item, i) => (
                    <Row key={item.id} story={item} index={i} />
                  ))}
                </div>
              </>
            ) : (
              <>
                <h1>最新简报</h1>
                <Empty />
              </>
            ))}
          {page.kind === "archive" && (
            <>
              <header className="page-heading">
                <p className="section-kicker">按日期归档</p>
                <h1>往期简报</h1>
                <span>{data.latest.length} 期</span>
              </header>
              {!data.latest.length ? (
                <Empty />
              ) : (
                months.map((month) => (
                  <section className="archive-month" key={month}>
                    <h2>{month.replace("-", " 年 ")} 月</h2>
                    <ol>
                      {data.latest
                        .filter((r) => r.report_date.startsWith(month))
                        .map((r) => (
                          <li className="archive-edition" key={r.report_id}>
                            <a href={`/archive/${r.report_date}/`}>
                              <div className="archive-date">
                                <strong>{r.report_date.slice(8)}</strong>
                                <span>
                                  {new Intl.DateTimeFormat("zh-CN", {
                                    timeZone: "UTC",
                                    weekday: "long",
                                  }).format(
                                    new Date(r.report_date + "T00:00:00Z"),
                                  )}
                                </span>
                              </div>
                              <div className="archive-edition-content">
                                <div className="archive-labels">
                                  {r.report_date === latestDate && (
                                    <span className="issue-label">
                                      最新一期
                                    </span>
                                  )}
                                  <span>{r.items.length} 条资讯</span>
                                </div>
                                <h3>{r.title}</h3>
                                <div className="archive-categories">
                                  {counts(r.items).map(([key, n]) => (
                                    <span key={key}>
                                      {categories[key] ?? key} {n}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <span className="edition-open" aria-hidden="true">
                                →
                              </span>
                            </a>
                          </li>
                        ))}
                    </ol>
                  </section>
                ))
              )}
            </>
          )}
          {page.kind === "channel" && (
            <>
              <header className="page-heading">
                <p className="section-kicker">分类浏览</p>
                <h1>全部资讯</h1>
                <span>{data.current.length} 条</span>
              </header>
              <nav className="category-links" aria-label="资讯分类">
                {categoryCounts.map(([key, n]) => (
                  <a key={key} href={`#category-${key}`}>
                    {categories[key] ?? key}
                    <span>{n}</span>
                  </a>
                ))}
              </nav>
              {!data.current.length ? (
                <Empty />
              ) : (
                categoryCounts.map(([key, n]) => (
                  <section
                    className="category-section"
                    id={`category-${key}`}
                    key={key}
                  >
                    <h2>
                      {categories[key] ?? key}
                      <span>{n}</span>
                    </h2>
                    {data.current
                      .filter((item) => item.category === key)
                      .map((item, i) => (
                        <Row key={item.key} story={item} index={i} level={3} />
                      ))}
                  </section>
                ))
              )}
            </>
          )}
          {["date", "report"].includes(page.kind) && selected && (
            <>
              <nav className="breadcrumb" aria-label="面包屑">
                <a href="/archive/">往期归档</a>
                <span>/</span>
                <time dateTime={selected.report_date}>
                  {dateLabel(selected.report_date)}
                </time>
              </nav>
              <header className="issue-header">
                <div className="issue-topline">
                  <span className="issue-label">
                    {page.kind === "report"
                      ? `第 ${selected.version} 版存档`
                      : selected.report_date === latestDate
                        ? "最新一期"
                        : "往期简报"}
                  </span>
                  <span>{selected.items.length} 条资讯</span>
                </div>
                <h1>{selected.title}</h1>
                {page.kind === "report" && (
                  <a href={`/archive/${selected.report_date}/`}>
                    查看本日最新版 →
                  </a>
                )}
              </header>
              {versions.length > 1 && (
                <details className="revision-list">
                  <summary>修订记录 · {versions.length} 个版本</summary>
                  <nav aria-label="修订版本">
                    {versions.map((r) => (
                      <a
                        aria-current={
                          page.kind === "report" &&
                          r.version === selected.version
                            ? "page"
                            : undefined
                        }
                        key={r.version}
                        href={reportPath(r)}
                      >
                        第 {r.version} 版
                      </a>
                    ))}
                  </nav>
                </details>
              )}
              <div className="issue-stories">
                {selectedStories?.map((item, i) => (
                  <article
                    className="issue-story"
                    id={`story-${item.key}`}
                    key={item.id}
                  >
                    <div className="story-heading">
                      <span className="news-number" aria-hidden="true">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <div>
                        <div className="news-meta">
                          <span className="category-label">
                            {categories[item.category] ?? item.category}
                          </span>
                          <a
                            href={item.source.canonical_url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {item.source.name} ↗
                          </a>
                        </div>
                        <h2>{lead(item).title}</h2>
                      </div>
                    </div>
                    {lead(item).rest && (
                      <p className="story-facts">{lead(item).rest}</p>
                    )}
                    {item.analysis && (
                      <div className="story-analysis">
                        <h3>分析与推断</h3>
                        <p>{item.analysis}</p>
                      </div>
                    )}
                    <Source story={item} />
                  </article>
                ))}
              </div>
            </>
          )}
          {page.kind === "article" && story && (
            <>
              <nav className="breadcrumb" aria-label="面包屑">
                <a href="/archive/">往期归档</a>
                <span>/</span>
                <a
                  href={
                    owner ? reportPath(owner) : `/archive/${story.report_date}/`
                  }
                >
                  {dateLabel(story.report_date)}
                </a>
              </nav>
              <header className="article-header">
                <div className="news-meta">
                  <span className="category-label">
                    {categories[story.category] ?? story.category}
                  </span>
                  <time dateTime={story.report_date}>
                    {dateLabel(story.report_date)}
                  </time>
                </div>
                <h1>{lead(story).title}</h1>
                <a
                  className="original-link"
                  href={story.source.canonical_url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {story.source.name} · 查看原文 ↗
                </a>
              </header>
              <section className="article-body" aria-label="来源事实摘要">
                {lead(story).rest && <p>{lead(story).rest}</p>}
                {story.analysis && (
                  <section className="story-analysis">
                    <h2>分析与推断</h2>
                    <p>{story.analysis}</p>
                  </section>
                )}
                <Source story={story} />
              </section>
            </>
          )}
          {page.kind === "404" && (
            <div className="empty">
              <h1>页面不存在</h1>
              <a href="/">返回最新简报</a>
            </div>
          )}
        </main>
        {aside}
      </div>
      <footer>
        <a href="/">AI News Hub</a>
        <nav aria-label="页脚导航">
          <a href="/archive/">往期归档</a>
          <a href="/rss/all.xml">RSS</a>
        </nav>
      </footer>
    </div>
  );
}
