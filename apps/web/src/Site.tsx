import { InlineText } from "./InlineText";
import type { PublicData, Page, Story } from "./types";
import {
  categories,
  dateLabel,
  lead,
  Source,
  Empty,
  groupResearchAreas,
  hasResearchAreas,
  projectEntryLabel,
} from "./ReadingParts";
import { issuePath, topicPath } from "./paths";
import { Shell } from "./Shell";
import { TopicHome, TopicDirectory, LatestBrief } from "./TopicHome";
import { StructuredProjectAside, StructuredProjectDetail } from "./StructuredProjectDetail";
import { InvestmentAside, InvestmentDetail } from "./InvestmentDetail";
import { NewsAside, NewsDetail } from "./NewsDetail";
import { SearchPage } from "./Search";
export function Site({ data, page }: { data: PublicData; page: Page }) {
  if (page.kind === "home") return <TopicHome data={data} />;
  if (page.kind === "search") return <SearchPage data={data} />;
  if (page.kind === "channel") return <TopicDirectory data={data} />;
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
  const selectedHasResearchAreas = !!selectedStories && hasResearchAreas(selectedStories);
  const selectedResearchGroups = selectedStories ? groupResearchAreas(selectedStories) : [];
  const renderIssueStory = (item: Story, index: number) => (
    <article className="issue-story" id={`story-${item.key}`} key={item.id}>
      <div className="story-heading">
        <span className="news-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <div className="news-meta">
            {item.research_area ? (
              projectEntryLabel(item) && <span className="project-entry-label">{projectEntryLabel(item)}</span>
            ) : (
              <span className="category-label">{categories[item.category] ?? item.category}</span>
            )}
            <a href={item.source.canonical_url} target="_blank" rel="noopener noreferrer">{item.source.name} ↗</a>
          </div>
          <h2>{lead(item).title}</h2>
        </div>
      </div>
      {lead(item).rest && <p className="story-facts"><InlineText text={lead(item).rest} /></p>}
      {item.analysis && <div className="story-analysis"><h3>分析与推断</h3><p><InlineText text={item.analysis} /></p></div>}
      <Source story={item} />
    </article>
  );
  const investment = story?.details.kind === "investment" ? story.details : null;
  const news = story?.details.kind === "news" ? story.details : null;
  const structuredProject = story?.details.kind === "project" ? story.details : null;
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
  ) : page.kind === "article" && investment ? (
    <InvestmentAside details={investment} analysis={story?.analysis}/>
  ) : page.kind === "article" && structuredProject ? (
    <StructuredProjectAside details={structuredProject} />
  ) : page.kind === "article" && news ? (
    <NewsAside details={news} analysis={story?.analysis}/>
  ) : null;
  const hasAside = Boolean(aside);
  return (
    <Shell
      data={fullData}
      active="topics"
      page="reader"
    >
      <div
        className={`reading-layout${hasAside ? " has-aside" : ""}${page.kind === "article" ? " detail-layout" : ""}${page.kind === "topic" ? " latest-layout" : ""}${page.kind === "article" && structuredProject ? " project-layout" : ""}${page.kind === "article" && investment ? " investment-layout" : ""}${page.kind === "article" && news ? " news-layout" : ""}`}
      >
        <main id="content">
          {page.kind === "topic" &&
            (topic ? <LatestBrief topic={topic} /> : <Empty />)}
          {["date", "report"].includes(page.kind) && selected && (
            <>
              <nav className="breadcrumb" aria-label="面包屑">
                <a href={topicPath(selected.topic.id)}>
                  返回话题
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
                {selectedHasResearchAreas ? selectedResearchGroups.map((group) => (
                  <section className="issue-research-area" key={group.id}>
                    <header className="research-area-heading">
                      <h2>{group.label}</h2>
                      <span>{group.items.length} 个项目</span>
                    </header>
                    {group.items.map((item) => renderIssueStory(item, selectedStories?.indexOf(item) ?? 0))}
                  </section>
                )) : selectedStories?.map(renderIssueStory)}
              </div>
            </>
          )}
          {page.kind === "article" && story && (
            <>
              <nav className="detail-context" aria-label="文章导航">
                <a href={topicPath(story.topic.id)}>返回话题</a>
                <time dateTime={story.report_date}>{dateLabel(story.report_date)}</time>
              </nav>
              {structuredProject ? (
                <StructuredProjectDetail story={story} />
              ) : investment ? (
                <InvestmentDetail story={story} />
              ) : news ? (
                <NewsDetail story={story} />
              ) : null}
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
