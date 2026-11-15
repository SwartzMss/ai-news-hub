import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchIndex, searchCutoffDate } from "../apps/web/generator/search-index.mjs";

test("search cutoff keeps 30 Shanghai calendar dates, including the cutoff date", () => {
  assert.equal(searchCutoffDate(new Date("2026-11-15T15:59:59.000Z")), "2026-10-17");
  assert.equal(searchCutoffDate(new Date("2026-11-15T16:00:00.000Z")), "2026-10-18");
});

test("search index filters expired reports, deduplicates stable keys and uses the newest revision", () => {
  const topic = { id: "t-aaaaaaaaaaaaaaaaaaaaaaaa", name: "科技投资" };
  const stories = [
    { key: "same", topic, report_date: "2026-11-15", report_version: 1, fact_summary: "旧标题。旧摘要", category: "optical_communications" },
    { key: "same", topic, report_date: "2026-11-15", report_version: 2, fact_summary: "最新标题。最新摘要", category: "optical_communications" },
    { key: "expired", topic, report_date: "2026-10-16", report_version: 1, fact_summary: "过期文章", category: "semiconductor" },
    { key: "cutoff", topic, report_date: "2026-10-17", report_version: 1, fact_summary: "边界文章", category: "semiconductor" },
  ];
  const index = buildSearchIndex(stories, { now: new Date("2026-11-15T00:00:00.000Z") });
  assert.equal(index.schema_version, 1);
  assert.equal(index.cutoff_date, "2026-10-17");
  assert.deepEqual(index.articles.map((item) => item.key), ["same", "cutoff"]);
  assert.equal(index.articles[0].title, "最新标题");
  assert.equal(index.articles[0].summary, "最新摘要");
  assert.equal(index.articles[0].topic_name, "科技投资");
  assert.equal(index.articles[0].href, "/topics/t-aaaaaaaaaaaaaaaaaaaaaaaa/news/same/");
});

test("search index includes research area metadata and returns lean public fields only", () => {
  const story = {
    key: "project", topic: { id: "t-bbbbbbbbbbbbbbbbbbbbbbbb", name: "开源项目" },
    report_date: "2026-11-15", report_version: 1, fact_summary: "Rust 工具发布。新增增量索引。",
    category: "opensource", research_area: "rust", analysis: "private analysis should not be indexed",
  };
  const index = buildSearchIndex([story], { now: new Date("2026-11-15T00:00:00.000Z") });
  assert.equal(index.articles[0].research_area, "rust");
  assert.equal(index.articles[0].summary, "新增增量索引。");
  assert.equal(Object.hasOwn(index.articles[0], "analysis"), false);
});
