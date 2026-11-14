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
      <div className="sticky-header" data-sticky-header>
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
          <nav className="header-links" aria-label="外部链接">
            <a className="header-link" href="https://github.com/SwartzMss/ai-news-hub" target="_blank" rel="noopener noreferrer" aria-label="GitHub 项目仓库">
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path fill="currentColor" d="M12 .9a11.1 11.1 0 0 0-3.51 21.63c.55.1.76-.24.76-.53v-1.86c-3.1.67-3.76-1.32-3.76-1.32-.5-1.28-1.24-1.62-1.24-1.62-1.01-.69.08-.68.08-.68 1.12.08 1.7 1.15 1.7 1.15.99 1.7 2.6 1.21 3.23.93.1-.72.39-1.21.7-1.49-2.48-.28-5.09-1.24-5.09-5.52 0-1.22.44-2.22 1.15-3-.12-.28-.5-1.42.11-2.96 0 0 .94-.3 3.08 1.15a10.7 10.7 0 0 1 5.6 0c2.14-1.45 3.08-1.15 3.08-1.15.61 1.54.23 2.68.11 2.96.72.78 1.15 1.78 1.15 3 0 4.29-2.61 5.24-5.1 5.51.4.35.75 1.03.75 2.08V22c0 .29.2.64.76.53A11.1 11.1 0 0 0 12 .9Z"/>
              </svg>
              <span>GitHub</span>
            </a>
            <a className="header-link" href="https://github.com/SwartzMss/ai-news-hub/discussions" target="_blank" rel="noopener noreferrer" aria-label="通过 GitHub Discussions 联系项目" title="GitHub Discussions">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M20.5 11.5a8.5 8.5 0 0 1-12.7 7.4L3 20l1.1-4.2A8.5 8.5 0 1 1 20.5 11.5Z"/>
                <path d="M8 11.5h8M8 8.5h5"/>
              </svg>
              <span>Contact</span>
            </a>
          </nav>
          {data.newsletterEnabled && (
            <button
              className="subscribe-action"
              type="button"
              data-newsletter-open
              aria-haspopup="dialog"
              aria-controls="newsletter-dialog"
              aria-label="订阅每日邮件汇总"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <rect x="3" y="5" width="18" height="14" rx="2"/>
                <path d="m3 7 9 6 9-6"/>
              </svg>
              <span>Subscribe</span>
            </button>
          )}
          <button id="theme-toggle" aria-label="切换明暗主题" aria-pressed="false" type="button">
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
      </div>
      <div className={`reader-body${data.topics.length ? " has-topics" : ""}`}>        {children}
      </div>
      <footer className="site-footer">
        <span>© 2026 AI News Hub. All rights reserved.</span>
      </footer>
      {data.newsletterEnabled && <Newsletter />}
    </div>
  );
}
