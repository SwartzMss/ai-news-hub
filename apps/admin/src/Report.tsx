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
export function Report({ report }: { report: ReportRecord }) {
  return (
    <section className="panel report-panel">
      <div className="report-kicker">
        <Icon name="file" size={16} />
        日报预览<span>版本 {report.version}</span>
      </div>
      <h2>{report.document.title}</h2>
      <p className="notice">
        {report.status === "published"
          ? "已归档"
          : report.status === "approved"
            ? "已批准"
            : "待人工审核"}{" "}
        {report.document.items.some(
          (item) => item.verification === "codex_reported",
        )
          ? "· 内容与来源由 Codex 整理。"
          : "· 历史来源记录。"}
      </p>
      <p>
        {report.document.reportDate} · {report.document.channel} · 采集时间{" "}
        {report.document.collectedAt}
      </p>
      {report.document.items.map((item) => (
        <article className="report-item" key={item.articleId}>
          <span className="badge">
            {item.category} · 重要性 {item.importance}/5
          </span>
          <h3 className="fact-label">来源事实摘要</h3>
          <p className="fact-summary">{item.factSummary}</p>
          <div className="analysis-block">
            <h3>分析（推断）</h3>
            <p>{item.analysis ?? "无"}</p>
          </div>
          <blockquote>
            <span>
              {item.verification === "codex_reported"
                ? "Codex 提供的引文"
                : "依据原文"}
            </span>
            {item.evidenceQuote}
          </blockquote>
          <a
            href={safeUrl(item.source.canonicalUrl)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {item.source.name} · 查看原文 ↗
          </a>
          <dl className="source-times">
            <dt>来源发布时间</dt>
            <dd>{item.source.publishedAt ?? "未知"}</dd>
            <dt>事件时间</dt>
            <dd>{item.source.eventAt ?? "未知"}</dd>
            {item.source.fetchedAt && (
              <>
                <dt>首次抓取时间</dt>
                <dd>{item.source.fetchedAt}</dd>
              </>
            )}
          </dl>
          <p className="muted">
            {item.verification === "codex_reported"
              ? "来源由 Codex 提供"
              : "来源关联：source_only · 未独立证实"}
          </p>
        </article>
      ))}
      <details>
        <summary>查看结构化 JSON</summary>
        <pre>{JSON.stringify(report.document, null, 2)}</pre>
      </details>
    </section>
  );
}
