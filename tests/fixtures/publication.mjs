import { mkdtempSync, rmSync } from "node:fs";
import { openDatabase } from "../../dist/apps/server/src/db/database.js";
import { buildReport } from "../../dist/apps/server/src/news/report.js";
export function publicationFixture() {
  const dir = mkdtempSync("/tmp/publish-test-"),
    db = openDatabase(dir);
  const candidate = {
    id: "a",
    title: "Test source announcement",
    excerpt: "This fixture only verifies publication storage.",
    originalUrl: "https://github.blog/test",
    canonicalUrl: "https://github.blog/test",
    sourceName: "GitHub Blog",
    publishedAt: null,
    eventAt: null,
    fetchedAt: "2026-11-03T00:00:00Z",
  };
  const proposal = {
    title: "[TEST] Archive fixture",
    items: [
      {
        articleId: "a",
        category: "opensource",
        importance: 1,
        factSummary: "测试数据，仅用于验证归档。",
        analysis: null,
        evidenceQuote: candidate.title,
      },
    ],
  };
  const doc = buildReport(JSON.stringify(proposal), [candidate], {
    reportId: "r",
    runId: "run",
    reportDate: "2026-11-03",
    collectedAt: candidate.fetchedAt,
  });
  db.prepare(
    "INSERT INTO tasks(id,name,channel,prompt) VALUES ('news-github','test','opensource','test')",
  ).run();
  db.prepare(
    "INSERT INTO task_runs(id,task_id,idempotency_key,status) VALUES ('run','news-github','test','succeeded')",
  ).run();
  db.prepare(
    "INSERT INTO articles(id,original_url,canonical_url,source_name,title,fetched_at) VALUES (?,?,?,?,?,?)",
  ).run(
    "a",
    candidate.originalUrl,
    candidate.canonicalUrl,
    candidate.sourceName,
    candidate.title,
    candidate.fetchedAt,
  );
  db.prepare(
    "INSERT INTO reports(id,run_id,report_date,channel,version,title,body_markdown,content_json,status) VALUES ('r','run','2026-11-03','opensource',1,?,'test',?,'validated')",
  ).run(doc.title, JSON.stringify(doc));
  db.prepare(
    "INSERT INTO report_articles(report_id,article_id,position) VALUES ('r','a',0)",
  ).run();
  db.prepare(
    "INSERT INTO rss_sources(id,name,feed_url) VALUES ('github-blog','GitHub Blog','https://github.blog/feed/')",
  ).run();
  db.prepare(
    "INSERT INTO news_runs(run_id,source_id,report_date,channel,collected_at,candidates_json,report_id) VALUES ('run','github-blog','2026-11-03','opensource',?,?,'r')",
  ).run(candidate.fetchedAt, JSON.stringify([candidate]));
  return {
    db,
    doc,
    close() {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
