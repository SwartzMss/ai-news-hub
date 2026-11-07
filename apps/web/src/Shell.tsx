import type { ReactNode } from "react";
import type { PublicData, TopicSummary } from "./types";
import { topicPath, topicArchivePath } from "./paths";
export function Shell({
  data,
  topic,
  active = "topics",
  page = "reader",
  children,
}: {
  data: PublicData;
  topic?: TopicSummary;
  active?: "topics" | "archive";
  page?: string;
  children: ReactNode;
}) {
  const rss = topic ? `/rss/topics/${topic.id}.xml` : "/rss/all.xml";
  return (
    <div className="site-shell" data-page={page} data-topic-id={topic?.id}>
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
          <a href="/" aria-current={active === "topics" ? "page" : undefined}>
            话题首页
          </a>
          <a
            href={topic ? topicArchivePath(topic.id) : "/archive/"}
            aria-current={active === "archive" ? "page" : undefined}
          >
            往期归档
          </a>
        </nav>
        <div className="header-actions">
          <a href={rss} data-topic-feed>
            RSS 订阅
          </a>
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
      {data.topics.length > 0 && (
        <nav className="topic-picker" aria-label="话题选择">
          {data.topics.map((t) => (
            <a
              key={t.id}
              href={
                active === "archive" ? topicArchivePath(t.id) : topicPath(t.id)
              }
              data-topic-choice={t.id}
              aria-current={
                (topic?.id ??
                  (page === "home" ? data.topics[0]?.id : undefined)) === t.id
                  ? "page"
                  : undefined
              }
            >
              {t.name}
            </a>
          ))}
        </nav>
      )}
      {children}
      <footer>
        <a href="/">AI News Hub</a>
        <nav aria-label="页脚导航">
          <a href={topic ? topicArchivePath(topic.id) : "/archive/"}>
            往期归档
          </a>
          <a href={rss} data-topic-feed>
            RSS
          </a>
        </nav>
      </footer>
    </div>
  );
}
