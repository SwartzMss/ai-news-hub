import type { PublicData, Story } from "./types";
import { Shell } from "./Shell";
import { Row, Empty, dateLabel, groupResearchAreas, hasResearchAreas } from "./ReadingParts";
import { topicPath } from "./paths";
export function LatestBrief({
  topic,
}: {
  topic: PublicData["topics"][number];
}) {
  const report = topic.latest;
  return <Brief date={report.report_date} stories={report.items} groupProjects />;
}
function Brief({
  date,
  stories,
  groupProjects = false,
  fromHome = false,
}: {
  date: string;
  stories: Story[];
  groupProjects?: boolean;
  fromHome?: boolean;
}) {
  const grouped = groupProjects && hasResearchAreas(stories);
  const groups = grouped ? groupResearchAreas(stories) : [];
  const weekday = new Intl.DateTimeFormat("zh-CN", {
    weekday: "long",
    timeZone: "UTC",
  }).format(new Date(date + "T00:00:00Z"));
  return (
    <div className="brief-layout">
      <div className="brief-main">
        <header className="brief-heading">
          <div className="brief-date">
            <h1>
              <time dateTime={date}>
                {dateLabel(date)}
              </time>
            </h1>
            <span>{weekday}</span>
          </div>
        </header>
        <div className="news-list">
          {grouped ? groups.map((group) => (
            <section className="research-area-section" key={group.id}>
              {group.items.map((story) => (
                <Row key={story.key} story={story} id={`brief-${story.topic.id}-${story.key}`} fromHome={fromHome} />
              ))}
            </section>
          )) : stories.map((story) => (
            <Row key={story.key} story={story} id={`brief-${story.topic.id}-${story.key}`} />
          ))}
        </div>
      </div>
    </div>
  );
}
export function TopicHome({ data }: { data: PublicData }) {
  const byDate = new Map<string, Story[]>();
  for (const topic of data.topics) {
    const date = topic.latest.report_date;
    const stories = byDate.get(date) ?? [];
    stories.push(...topic.latest.items);
    byDate.set(date, stories);
  }
  return (
    <Shell data={data} page="home">
      <main id="content" className="topic-home">
        {!byDate.size ? (
          <Empty />
        ) : (
          [...byDate.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([date, stories]) => <Brief key={date} date={date} stories={stories} fromHome />)
        )}
      </main>
    </Shell>
  );
}
export function TopicDirectory({ data }: { data: PublicData }) {
  return (
    <Shell data={data} active="topics" page="directory">
      <main id="content" className="topic-home">
        <header className="page-heading">
          <h1>全部话题</h1>
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
                href={topicPath(topic.id)}
              >
                <h2>{topic.name}</h2>
                <span>
                  {topic.reportCount} 期 · 最近更新{" "}
                  {dateLabel(topic.latest.report_date)}
                </span>
                <p>{topic.latest.title}</p>
                <strong>进入话题 →</strong>
              </a>
            ))}
          </div>
        )}
      </main>
    </Shell>
  );
}
