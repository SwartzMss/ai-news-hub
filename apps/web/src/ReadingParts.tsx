import type { Story, Report } from "./types";
import { issuePath, storyPath } from "./paths";
export const categories: Record<string, string> = {
  ai: "AI 与大模型",
  opensource: "开源项目",
  developer_tools: "开发工具",
  security: "安全动态",
  industry: "公司与产业",
  other: "综合资讯",
};
export const dateLabel = (value: string) =>
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
export function lead(story: Story) {
  const index = story.fact_summary.search(/[。；\n]/u);
  return index > 0
    ? {
        title: story.fact_summary.slice(0, index),
        rest: story.fact_summary.slice(index + 1).trim(),
      }
    : { title: story.fact_summary, rest: "" };
}
export function counts(items: Story[]) {
  return Object.entries(
    items.reduce<Record<string, number>>((result, item) => {
      result[item.category] = (result[item.category] ?? 0) + 1;
      return result;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
}
export function Source({ story }: { story: Story }) {
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
export function Row({
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
          <a href={storyPath(story)}>{text.title}</a>
        </Heading>
        {text.rest && <p className="news-summary">{text.rest}</p>}
        <div className="news-footer">
          <a href={storyPath(story)}>查看详情</a>
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
export function Empty() {
  return (
    <div className="empty">
      <h2>还没有已发布的日报</h2>
    </div>
  );
}
export function EditionLinks({
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
          <a href={versioned ? issuePath(r, true) : issuePath(r)}>
            <time dateTime={r.report_date}>{dateLabel(r.report_date)}</time>
            <strong>{r.title}</strong>
            <span>{r.items.length} 条</span>
          </a>
        </li>
      ))}
    </ol>
  );
}
