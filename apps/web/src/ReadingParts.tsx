import { InlineText } from "./InlineText";
import type { Story, Report, ResearchArea } from "./types";
import { issuePath, storyPath } from "./paths";
export const researchAreaLabels: Record<ResearchArea, string> = {
  agent: "AI Agent 与自动化执行",
  rust: "Rust 生态与工程工具",
  multimedia: "AI 视频、音频与多媒体创作",
  performance_security: "性能分析与软件安全",
  decentralized: "区块链与去中心化基础设施",
};
export const researchAreaOrder: { id: ResearchArea; label: string }[] = [
  { id: "agent", label: researchAreaLabels.agent },
  { id: "rust", label: researchAreaLabels.rust },
  { id: "multimedia", label: researchAreaLabels.multimedia },
  { id: "performance_security", label: researchAreaLabels.performance_security },
  { id: "decentralized", label: researchAreaLabels.decentralized },
];
export function hasResearchAreas(items: Story[]) {
  return items.some((item) => item.research_area !== undefined);
}
export function groupResearchAreas(items: Story[]) {
  return researchAreaOrder.map((area) => ({
    ...area,
    items: items.filter((item) => item.research_area === area.id),
  }));
}
export function projectEntryLabel(story: Story) {
  if (!story.research_area || story.details?.kind !== 'project') return undefined;
  return story.details.change ? '近期进展' : '项目发现';
}
export const categories: Record<string, string> = {
  ai: "AI 与大模型",
  opensource: "开源项目",
  developer_tools: "开发工具",
  security: "安全动态",
  industry: "公司与产业",
  ai_industry_chain: "AI 产业链",
  optical_communications: "光模块与光通信",
  semiconductor: "半导体",
  social_event: "社会事件",
  entertainment: "娱乐明星",
  tech_digital: "科技数码",
  sports: "体育赛事",
  film_animation: "影视动漫",
  gaming: "游戏",
  finance_consumption: "财经消费",
  internet_culture: "网络文化",
  lifestyle_emotion: "生活情感",
  international_topic: "国际话题",
  other: "其他",
};
export const trendTagLabels: Record<string,string> = {
  cross_platform: "跨平台传播",
  single_platform: "单平台热度",
  controversial: "争议较大",
  viral_video: "热门视频",
  sustained_discussion: "持续讨论",
};
export const contentTagLabels: Record<string,string> = {
  short_video: "适合短视频",
  debate: "观点讨论",
  story_reversal: "故事反转",
  explainer: "知识解读",
  emotional_resonance: "情绪共鸣",
  entertainment: "娱乐传播",
  not_suitable: "不建议创作",
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
export function Source({ story, expanded = false }: { story: Story; expanded?: boolean }) {
  return (
    <details className="source-details" open={expanded}>
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
  id,
  level = 2,
}: {
  story: Story;
  id?: string;
  level?: 2 | 3;
}) {
  const Heading = level === 3 ? "h3" : "h2",
    text = lead(story);
  return (
    <article className="news-row" id={id} data-brief-story={id}>
      <div className="news-content">
        <Heading>
          <a href={storyPath(story)} title={text.title}>
            {text.title}
          </a>
        </Heading>
        {text.rest && (
          <p className="news-summary">
            <InlineText text={text.rest} />
          </p>
        )}
        <div className="news-meta">
          {story.research_area ? (
            projectEntryLabel(story) && <span className="project-entry-label">{projectEntryLabel(story)}</span>
          ) : story.details?.kind === "news" && (story.details.trendTags?.length || story.details.contentTags?.length) ? (
            <span className="news-row-tags">
              <span className="news-tag news-tag-topic">{categories[story.category] ?? story.category}</span>
              {story.details.trendTags?.slice(0, 1).map(tag => <span className="news-tag news-tag-trend" key={tag}>{trendTagLabels[tag] ?? tag}</span>)}
              {story.details.contentTags?.slice(0, 1).map(tag => <span className="news-tag news-tag-content" key={tag}>{contentTagLabels[tag] ?? tag}</span>)}
            </span>
          ) : (
            <span className="category-label">{categories[story.category] ?? story.category}</span>
          )}
          <a
            href={story.source.canonical_url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`查看原文：${story.source.name}`}
          >
            {story.source.name} <span aria-hidden="true">↗</span>
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
