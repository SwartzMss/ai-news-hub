import type { PublicData } from "./types";
import { Shell } from "./Shell";
import { Row, Empty, dateLabel, groupResearchAreas, hasResearchAreas } from "./ReadingParts";
import { topicPath, topicArchivePath } from "./paths";
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
        </header>
        <div className="brief-list-heading">
          <h2>全部资讯</h2>
          <span>{report.items.length} 条</span>
        </div>
        <div className="news-list">
          {grouped ? groups.map((group) => (
            <section className="research-area-section" key={group.id}>
              {group.items.length ? group.items.map((story) => (
                <Row key={story.key} story={story} id={`brief-${topic.id}-${story.key}`} />
              )) : (
                <p className="research-area-empty">
                  <strong>{group.label}</strong>
                  <span>本期无符合条件的项目</span>
                </p>
              )}
            </section>
          )) : report.items.map((story) => (
            <Row key={story.key} story={story} id={`brief-${topic.id}-${story.key}`} />
          ))}
        </div>
      </div>
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
