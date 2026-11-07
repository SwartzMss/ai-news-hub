import type { PublicData } from "./types";
import { Shell } from "./Shell";
import { Row, Empty, dateLabel } from "./ReadingParts";
import { topicPath, topicArchivePath } from "./paths";
export function LatestBrief({
  topic,
}: {
  topic: PublicData["topics"][number];
}) {
  return (
    <>
      <header className="brief-heading">
        <h1>{topic.name}</h1>
        <div className="brief-date">
          <time dateTime={topic.latest.report_date}>
            {dateLabel(topic.latest.report_date)}
          </time>
          <span>{topic.latest.items.length} 条资讯</span>
        </div>
      </header>
      <div className="news-list">
        {topic.latest.items.map((story) => (
          <Row key={story.key} story={story} />
        ))}
      </div>
    </>
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
