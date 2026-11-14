import type { PublicData } from "./types";
import { Shell } from "./Shell";
import { Row, Empty, dateLabel, lead, groupResearchAreas, hasResearchAreas } from "./ReadingParts";
import { topicPath, topicArchivePath } from "./paths";
function BriefLinks({ topic }: { topic: PublicData["topics"][number] }) {
  const items = topic.latest.items;
  const grouped = hasResearchAreas(items);
  const link = (story: (typeof items)[number]) => {
    const id = `brief-${topic.id}-${story.key}`;
    return (
      <a key={story.key} href={`#${id}`} data-brief-target={id} title={lead(story).title}>
        <span>{lead(story).title}</span>
      </a>
    );
  };
  return (
    <nav aria-label="本期目录">
      {grouped ? groupResearchAreas(items).map((group) => (
        <section className="brief-toc-group" key={group.id}>
          <h3>{group.label} · {group.items.length}</h3>
          {group.items.length ? group.items.map(link) : <p>本期无合格项目</p>}
        </section>
      )) : items.map(link)}
    </nav>
  );
}
export function LatestBrief({
  topic,
}: {
  topic: PublicData["topics"][number];
}) {
  const report = topic.latest;
  const grouped = hasResearchAreas(report.items);
  const groups = groupResearchAreas(report.items);
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(report.report_date + "T00:00:00Z"));
  const generated = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Asia/Shanghai",
  }).format(new Date(report.collected_at));
  return (
    <div className="brief-layout">
      <div className="brief-main">
        <header className="brief-heading">
          <div className="brief-date">
            <h1>
              <time dateTime={report.report_date}>
                {dateLabel(report.report_date)}
              </time>
            </h1>
            <span>{weekday}</span>
          </div>
          <p className="brief-description">围绕当前话题整理的最新动态与研究信息。</p>
          <div className="brief-generation">
            <span>
              生成于 <time dateTime={report.collected_at}>{generated}</time>
              （北京时间）
            </span>
          </div>
        </header>
        <details className="brief-mobile-toc">
          <summary>本期目录 · {report.items.length} 条</summary>
          <BriefLinks topic={topic} />
        </details>
        <div className="brief-list-heading">
          <h2>全部资讯</h2>
          <span>{report.items.length} 条</span>
        </div>
        <div className="news-list">
          {grouped ? groups.map((group) => (
            <section className="research-area-section" key={group.id}>
              <header className="research-area-heading">
                <h2>{group.label}</h2>
                <span>{group.items.length} 个项目</span>
              </header>
              {group.items.length ? group.items.map((story) => (
                <Row key={story.key} story={story} level={3} id={`brief-${topic.id}-${story.key}`} />
              )) : <p className="research-area-empty">本期无符合条件的项目</p>}
            </section>
          )) : report.items.map((story) => (
            <Row key={story.key} story={story} id={`brief-${topic.id}-${story.key}`} />
          ))}
        </div>
      </div>
      <aside className="brief-toc">
        <h2>本期目录</h2>
        <BriefLinks topic={topic} />
      </aside>
    </div>
  );
}
export function TopicHome({ data }: { data: PublicData }) {
  return (
    <Shell data={data} topic={data.topics[0]} page="home">
      <main id="content" className="topic-home">
        {!data.topics.length ? (
          <Empty />
        ) : (
          data.topics.map((topic, i) => (
            <section
              key={topic.id}
              data-topic-panel={topic.id}
              hidden={i !== 0}
              aria-label={topic.name}
            >
              <LatestBrief topic={topic} />
            </section>
          ))
        )}
      </main>
    </Shell>
  );
}
export function TopicDirectory({
  data,
  archive = false,
}: {
  data: PublicData;
  archive?: boolean;
}) {
  return (
    <Shell data={data} active={archive ? "archive" : "topics"} page="directory">
      <main id="content" className="topic-home">
        <header className="page-heading">
          <h1>{archive ? "话题归档" : "全部话题"}</h1>
          <span>{data.topics.length} 个话题</span>
        </header>
        {!data.topics.length ? (
          <Empty />
        ) : (
          <div className="topic-directory">
            {data.topics.map((topic) => (
              <a
                className="topic-card"
                key={topic.id}
                href={
                  archive ? topicArchivePath(topic.id) : topicPath(topic.id)
                }
                data-topic-choice={topic.id}
              >
                <h2>{topic.name}</h2>
                <span>
                  {topic.reportCount} 期 · 最近更新{" "}
                  {dateLabel(topic.latest.report_date)}
                </span>
                <p>{topic.latest.title}</p>
                <strong>{archive ? "查看往期" : "进入话题"} →</strong>
              </a>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}
