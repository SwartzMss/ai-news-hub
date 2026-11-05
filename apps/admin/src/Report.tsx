import type { DailyReport } from "../../server/src/news/report";
import { Icon } from "./ui";
export interface ReportRecord {
  id: string;
  version: number;
  status: string;
  document: DailyReport;
}
function safeUrl(value: string) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
const categoryNames: Record<string, string> = {
  ai: "AI 与大模型",
  opensource: "开源项目",
  developer_tools: "开发工具",
  security: "安全动态",
  industry: "公司与产业",
  other: "综合资讯",
};
function displayTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });
}
export function Report({ report }: { report: ReportRecord }) {
  const doc = report.document;
  const codexReported = doc.items.some(
    (item) => item.verification === "codex_reported",
  );
  return (
    <section className="report-preview" aria-label="简报阅读预览">
      <div className="report-preview-bar">
        <span>
          <Icon name="file" size={16} />
          阅读预览
        </span>
        <span>
          版本 {report.version}
        </span>
      </div>
      <article className="panel report-panel">
        <header className="report-cover">
          <p className="report-edition">
            <time dateTime={doc.reportDate}>{doc.reportDate}</time>
            <span>{doc.items.length} 条精选</span>
          </p>
          <h2>{doc.title}</h2>
          <p className="report-byline">
            {codexReported ? "内容与来源由 Codex 整理" : "历史来源记录"} ·
            生成于{" "}
            <time dateTime={doc.collectedAt}>
              {displayTime(doc.collectedAt)}
            </time>
          </p>
        </header>
        <ol className="report-stories">
          {doc.items.map((item, index) => (
            <li className="report-item" key={item.articleId}>
              <div className="report-story-meta">
                <span className="report-number">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="report-category">
                  {categoryNames[item.category] ?? item.category}
                </span>
                <span className="report-importance">
                  重要性 {item.importance}/5
                </span>
              </div>
              <p className="fact-summary">{item.factSummary}</p>
              {item.analysis && (
                <div className="analysis-block">
                  <h3>分析（推断）</h3>
                  <p>{item.analysis}</p>
                </div>
              )}
              <div className="report-source-link">
                <a
                  href={safeUrl(item.source.canonicalUrl)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {item.source.name} · 查看原文 ↗
                </a>
              </div>
              <details className="report-evidence">
                <summary>来源与引文</summary>
                <blockquote>
                  <span>
                    {item.verification === "codex_reported"
                      ? "Codex 提供的引文"
                      : "依据原文"}
                  </span>
                  {item.evidenceQuote}
                </blockquote>
                {(item.source.publishedAt ||
                  item.source.eventAt ||
                  item.source.fetchedAt) && (
                  <dl className="source-times">
                    {item.source.publishedAt && (
                      <>
                        <dt>来源发布时间</dt>
                        <dd>
                          <time dateTime={item.source.publishedAt}>
                            {displayTime(item.source.publishedAt)}
                          </time>
                        </dd>
                      </>
                    )}
                    {item.source.eventAt && (
                      <>
                        <dt>事件时间</dt>
                        <dd>
                          <time dateTime={item.source.eventAt}>
                            {displayTime(item.source.eventAt)}
                          </time>
                        </dd>
                      </>
                    )}
                    {item.source.fetchedAt && (
                      <>
                        <dt>首次抓取时间</dt>
                        <dd>
                          <time dateTime={item.source.fetchedAt}>
                            {displayTime(item.source.fetchedAt)}
                          </time>
                        </dd>
                      </>
                    )}
                  </dl>
                )}
                <p className="muted">
                  {item.verification === "codex_reported"
                    ? "来源由 Codex 提供"
                    : "来源关联：source_only · 未独立证实"}
                </p>
              </details>
            </li>
          ))}
        </ol>
        <footer className="report-end">本期完</footer>
      </article>
      <details className="report-raw">
        <summary>查看结构化 JSON</summary>
        <pre>{JSON.stringify(doc, null, 2)}</pre>
      </details>
    </section>
  );
}
