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
          {data.newsletterEnabled && (
            <a
              className="subscribe-action"
              href="#newsletter-signup"
              aria-label="Subscribe to the daily email digest"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.25 3.5h11.5c.55 0 1 .45 1 1v7c0 .55-.45 1-1 1H2.25c-.55 0-1-.45-1-1v-7c0-.55.45-1 1-1Zm.2 1.1L8 8.7l5.55-4.1H2.45Z" />
              </svg>
              <span>Subscribe</span>
            </a>
          )}
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
