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
// Presentation only: hide internal social-platform research from the headlines UI.
const HEADLINES_TOPIC_NAME = "每日热点观察";
const headlinePlatformName = /(?:Reddit|微博|抖音|B站|哔哩哔哩|小红书|知乎|Twitter|\bX\b|TikTok|YouTube|Instagram|Facebook|Telegram|Discord|Threads)/iu;
const headlineSocialSignal = /(?:社区.{0,12}(?:出现|集中|讨论|转载|评论)|(?:出现|集中).{0,12}(?:转载|转发|转述|评论|讨论|帖子)|(?:转载|转发|转述|评论|讨论).{0,12}(?:帖子|社区|话题)|(?:转载|转发|转述|评论|讨论)(?:与|及|和)(?:评论|讨论|转载|转发)|带话题帖子|传播帖|平台传播|讨论样本|评论样本|互动量|热榜|热搜|跨平台)/u;
const headlineInternalResearch = /(?:入选依据|统计窗口|窗口内新增|平台样本|平台证据|互动量未披露|互动数据|传播规模|公众观点比例|原帖票数|原帖|原视频(?:页|评论|链接)|评论者身份|评论中的|推广投入|自然传播|刷量|不同平台账号的数据|不能称为全网热议|本次新增信息|不将本次进展表述为|编辑推断|适合进一步制作|不建议进一步制作|平台传播信号|转录通知|不采用搜索索引票数)/u;
export function readerText(story: Pick<Story, "topic">, value: string | null | undefined) {
  const text = value ?? "";
  if (story.topic.name !== HEADLINES_TOPIC_NAME || !text.trim()) return text;
  const segments = text.match(/[^。！？；;\n]+[。！？；;]?/gu) ?? [];
  return segments
    .filter((segment) => {
      const sentence = segment.trim();
      if (!sentence || headlineInternalResearch.test(sentence)) return false;
      return !(headlinePlatformName.test(sentence) && headlineSocialSignal.test(sentence));
    })
    .join("")
    .trim();
}
// Presentation only: split the reader-facing summary without changing archived data.
export function lead(story: Story) {
  const summary = readerText(story, story.fact_summary);
  const index = summary.search(/[。；\n]/u);
  return index > 0
    ? {
        title: summary.slice(0, index),
        rest: summary.slice(index + 1).trim(),
      }
    : { title: summary, rest: "" };
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
            <span className="news-row-tags">
              <span className="news-tag news-tag-topic news-tag-research-area">{researchAreaLabels[story.research_area]}</span>
              {projectEntryLabel(story) && <span className="project-entry-label">{projectEntryLabel(story)}</span>}
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
