import { InlineText } from "./InlineText";
import type { PublicData, Page } from "./types";
import {
  categories,
  dateLabel,
  lead,
  counts,
  Source,
  Empty,
  EditionLinks,
} from "./ReadingParts";
import { issuePath, topicArchivePath } from "./paths";
import { Shell } from "./Shell";
import { TopicHome, TopicDirectory, LatestBrief } from "./TopicHome";
export function Site({ data, page }: { data: PublicData; page: Page }) {
  if (page.kind === "home") return <TopicHome data={data} />;
  if (page.kind === "channel" || page.kind === "archive")
    return <TopicDirectory data={data} archive={page.kind === "archive"} />;
  const fullData = data;
  const topic = fullData.topics.find((t) => t.id === page.topicId);
  data = {
    ...data,
    reports: data.reports.filter((r) => r.topic.id === page.topicId),
    latest: data.latest.filter((r) => r.topic.id === page.topicId),
    articles: data.articles.filter((r) => r.topic.id === page.topicId),
    current: data.current.filter((r) => r.topic.id === page.topicId),
  };
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
    key: item.key,
    report_date: selected.report_date,
    report_version: selected.version,
    first_approved_at: selected.approved_at,
  }));
  const owner = story
    ? data.reports.find(
        (r) =>
          r.report_date === story.report_date &&
          r.version === story.report_version,
      )
    : undefined;
  const nav =
    page.kind === "topic" ||
    ((page.kind === "article" || page.kind === "date") &&
      (story?.report_date ?? selected?.report_date) === latestDate)
      ? "latest"
      : "archive";
  const months = [
    ...new Set(data.latest.map((r) => r.report_date.slice(0, 7))),
  ];
  const versions = selected
    ? data.reports.filter((r) => r.report_date === selected.report_date)
    : [];
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
            ? issuePath(owner)
            : issuePath(owner, true)
        }
      >
        阅读整期 →
      </a>
    </aside>
  ) : null;
  return (
    <Shell
      data={fullData}
      topic={topic}
      active={nav === "latest" ? "topics" : "archive"}
      page="reader"
    >
      <div className={`reading-layout${aside ? " has-aside" : ""}`}>
        <main id="content">
          {page.kind === "topic" &&
            (topic ? <LatestBrief topic={topic} /> : <Empty />)}
          {page.kind === "topicArchive" && (
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
                            <a href={issuePath(r)}>
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
          {["date", "report"].includes(page.kind) && selected && (
            <>
              <nav className="breadcrumb" aria-label="面包屑">
                <a href={topicArchivePath(page.topicId ?? "legacy")}>
                  往期归档
                </a>
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
                  <a href={issuePath(selected)}>查看本日最新版 →</a>
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
                        href={issuePath(r, true)}
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
                      <p className="story-facts">
                        <InlineText text={lead(item).rest} />
                      </p>
                    )}
                    {item.analysis && (
                      <div className="story-analysis">
                        <h3>分析与推断</h3>
                        <p>
                          <InlineText text={item.analysis} />
                        </p>
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
                <a href={topicArchivePath(page.topicId ?? "legacy")}>
                  往期归档
                </a>
                <span>/</span>
                <a
                  href={
                    owner
                      ? issuePath(owner, true)
                      : `${topicArchivePath(story.topic.id)}${story.report_date}/`
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
                {lead(story).rest && (
                  <p>
                    <InlineText text={lead(story).rest} />
                  </p>
                )}
                {story.analysis && (
                  <section className="story-analysis">
                    <h2>分析与推断</h2>
                    <p>
                      <InlineText text={story.analysis} />
                    </p>
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
    </Shell>
  );
}
