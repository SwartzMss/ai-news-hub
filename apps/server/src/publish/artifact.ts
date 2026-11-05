import { Ajv } from "ajv";
import addFormats from "ajv-formats";
import type { FormatsPlugin } from "ajv-formats";
import { ARCHIVE_SCHEMA } from "./archive-schema.js";
import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { isDeepStrictEqual } from "node:util";
import { HttpError } from "../errors.js";
import { buildReport, type DailyReport } from "../news/report.js";
import { legacySourceUrl } from "../news/legacy-source.js";
import { sourceUrl } from "../news/sources.js";
import type { ArticleCandidate } from "../news/types.js";
const validator = new Ajv({
  strict: true,
  coerceTypes: false,
  removeAdditional: false,
});
(addFormats as unknown as FormatsPlugin)(validator);
const validateArchive = validator.compile(ARCHIVE_SCHEMA);
export const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function reviewedReport(db: DatabaseSync, id: string) {
  const row = db
    .prepare(
      `SELECT r.*,n.source_id,n.source_mode,n.candidates_json,n.collected_at,n.report_date snapshot_date,n.channel snapshot_channel,t.status run_status
 FROM reports r JOIN (
 SELECT run_id,report_id,source_id,'verified' source_mode,candidates_json,collected_at,report_date,channel FROM news_runs
 UNION ALL SELECT run_id,report_id,'codex-research' source_id,source_mode,candidates_json,collected_at,report_date,channel FROM codex_news_runs
 ) n ON n.report_id=r.id AND n.run_id=r.run_id JOIN task_runs t ON t.id=r.run_id WHERE r.id=?`,
    )
    .get(id);
  if (!row) throw new HttpError(404, "report_not_found");
  if (
    !["validated", "approved", "published"].includes(String(row.status)) ||
    row.run_status !== "succeeded"
  )
    throw new HttpError(409, "report_not_publishable");
  try {
    const document = JSON.parse(String(row.content_json)) as DailyReport;
    const candidates = JSON.parse(
      String(row.candidates_json),
    ) as ArticleCandidate[];
    if (
      !['github-blog','codex-research'].includes(String(row.source_id)) ||
      row.channel !== "opensource" ||
      row.channel !== row.snapshot_channel ||
      row.report_date !== row.snapshot_date ||
      document.reportDate !== row.report_date ||
      document.reportId !== id ||
      document.runId !== row.run_id ||
      row.title !== document.title ||
      !Number.isSafeInteger(row.version) ||
      Number(row.version) < 1 ||
      Number(row.version) > 999999
    )
      throw Error();
    for (const candidate of candidates)
      if (
        (row.source_id === 'github-blog'
          ? candidate.sourceName !== 'GitHub Blog' || legacySourceUrl(candidate.originalUrl) !== candidate.canonicalUrl
          : sourceUrl(candidate.originalUrl) !== candidate.canonicalUrl || candidate.sourceName !== new URL(candidate.canonicalUrl).hostname)
      )
        throw Error();
    if(!['verified','codex_reported'].includes(String(row.source_mode))||(row.source_id==='github-blog'&&row.source_mode!=='verified'))throw Error();
    const proposal = {
      title: document.title,
      items: document.items.map(
        ({
          articleId,
          category,
          importance,
          factSummary,
          analysis,
          evidenceQuote,
        }) => ({
          articleId,
          category,
          importance,
          factSummary,
          analysis,
          evidenceQuote,
        }),
      ),
    };
    const rebuilt = buildReport(JSON.stringify(proposal), candidates, {
      reportId: id,
      runId: String(row.run_id),
      reportDate: String(row.report_date),
      collectedAt: String(row.collected_at),
    }, row.source_mode as 'verified'|'codex_reported');
    if (!isDeepStrictEqual(rebuilt, document)) throw Error();
    const links = db
      .prepare(
        "SELECT article_id FROM report_articles WHERE report_id=? ORDER BY position",
      )
      .all(id)
      .map((x) => String(x.article_id));
    if (
      !isDeepStrictEqual(
        links,
        document.items.map((x) => x.articleId),
      )
    )
      throw Error();
    return {
      document,
      version: Number(row.version),
      status: String(row.status),
      contentHash: sha256(
        JSON.stringify({ document, version: row.version, candidates, links }),
      ),
    };
  } catch {
    throw new HttpError(409, "report_provenance_invalid");
  }
}
export function archiveArtifact(
  report: ReturnType<typeof reviewedReport>,
  approvedAt: string,
) {
  const d = report.document;
  const document = {
    schema_version: 1,
    report_id: d.reportId,
    report_date: d.reportDate,
    channel: d.channel,
    version: report.version,
    title: d.title,
    collected_at: d.collectedAt,
    review_status: "approved",
    approved_at: approvedAt,
    reviewed_content_sha256: report.contentHash,
    items: d.items.map((x) => ({
      id: x.articleId,
      category: x.category,
      importance: x.importance,
      fact_summary: x.factSummary,
      analysis: x.analysis,
      evidence_quote: x.evidenceQuote,
      verification: x.verification,
      source: {
        name: x.source.name,
        original_url: x.source.originalUrl,
        canonical_url: x.source.canonicalUrl,
        published_at: x.source.publishedAt,
        event_at: x.source.eventAt,
        fetched_at: x.source.fetchedAt,
      },
    })),
  };
  if (!validateArchive(document))
    throw new HttpError(409, "archive_schema_invalid");
  const content = JSON.stringify(document, null, 2) + "\n";
  const path = `reports/${d.reportDate.replaceAll("-", "/")}/${d.channel}/v${String(report.version).padStart(6, "0")}.json`;
  return { path, content, hash: sha256(content) };
}
