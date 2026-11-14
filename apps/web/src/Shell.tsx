import type { ReactNode } from "react";
import type { PublicData, TopicSummary } from "./types";
import { topicPath, topicArchivePath } from "./paths";
import { Newsletter } from "./Newsletter";
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
            首页
          </a>
          <a
            href={topic ? topicArchivePath(topic.id) : "/archive/"}
            data-topic-archive
            aria-current={active === "archive" ? "page" : undefined}
          >
            往期归档
          </a>
        </nav>
        <div className="header-actions">
          <a
            className="rss-action"
            data-topic-rss
            href={topic ? `/rss/topics/${topic.id}.xml` : "/rss/all.xml"}
            aria-label={topic ? "订阅当前话题 RSS" : "订阅全部话题 RSS"}
            title="订阅 RSS"
          >
            RSS
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
      <div className={`reader-body${data.topics.length ? " has-topics" : ""}`}>
        {data.topics.length > 0 && (
          <nav className="topic-picker" aria-label="话题选择">
            {data.topics.map((t) => (
              <a
                key={t.id}
                href={
                  active === "archive"
                    ? topicArchivePath(t.id)
                    : topicPath(t.id)
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
      </div>
      {data.newsletterEnabled && <Newsletter />}
    </div>
  );
}
