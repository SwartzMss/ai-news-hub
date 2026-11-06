import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { articleKey, readArchives } from "../apps/web/generator/data.mjs";
import { ARCHIVE_SCHEMA } from "../dist/apps/server/src/publish/archive-schema.js";
import { publicationFixture } from "./fixtures/publication.mjs";
import {
  archiveArtifact,
  reviewedReport,
} from "../dist/apps/server/src/publish/artifact.js";
function setup() {
  const dir = mkdtempSync("/tmp/web-archive-");
  const f = publicationFixture();
  const doc = JSON.parse(
    archiveArtifact(reviewedReport(f.db, "r"), "2026-11-03T01:00:00Z").content,
  );
  f.close();
  function save(d) {
    const p = `${dir}/${d.report_date.replaceAll("-", "/")}/${d.channel}`;
    mkdirSync(p, { recursive: true });
    writeFileSync(
      `${p}/v${String(d.version).padStart(6, "0")}.json`,
      JSON.stringify(d),
    );
  }
  return {
    dir,
    doc,
    save,
    close() {
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
test("public loader preserves history and chooses latest revision deterministically", () => {
  const s = setup();
  try {
    s.save(s.doc);
    s.save({ ...s.doc, report_id: "r2", version: 2, title: "revised" });
    s.save({ ...s.doc, report_id: "r3", report_date: "2026-11-04" });
    const data = readArchives(s.dir, { allowDemo: true });
    assert.equal(data.reports.length, 3);
    assert.equal(data.latest.length, 2);
    assert.equal(
      data.latest.find((r) => r.report_date === "2026-11-03").title,
      "revised",
    );
    assert.equal(data.articles.length, 1);
  } finally {
    s.close();
  }
});
test("public build refuses malformed contracts, unsafe source URLs and path mismatch", () => {
  for (const change of [
    { review_status: "pending" },
    { schema_version: 99 },
    { run_id: "private" },
    { report_date: "2026-99-99" },
    { items: [] },
  ]) {
    const s = setup();
    try {
      s.save({ ...s.doc, ...change });
      assert.throws(() => readArchives(s.dir, { allowDemo: true }));
    } finally {
      s.close();
    }
  }
  const s = setup();
  try {
    s.doc.items[0].source.canonical_url = "javascript:alert(1)";
    s.save(s.doc);
    assert.throws(() => readArchives(s.dir, { allowDemo: true }));
  } finally {
    s.close();
  }
  assert.equal(ARCHIVE_SCHEMA.properties.review_status.const, "approved");
});
test("production never silently accepts demo data or a symlink", async () => {
  const s = setup();
  try {
    s.save(s.doc);
    assert.throws(() => readArchives(s.dir), /test report/);
    const { symlinkSync } = await import("node:fs");
    symlinkSync(s.dir + "/2026", s.dir + "/link");
    assert.throws(() => readArchives(s.dir, { allowDemo: true }), /symlink/);
  } finally {
    s.close();
  }
});
test("removed revision entries remain historical but do not replace current older-date content", () => {
  const s = setup();
  try {
    const source = s.doc.items[0];
    s.save({
      ...s.doc,
      report_date: "2026-11-02",
      report_id: "old",
      items: [{ ...source, fact_summary: "Old current content" }],
    });
    s.save({
      ...s.doc,
      report_id: "before",
      items: [{ ...source, fact_summary: "Withdrawn content" }],
    });
    s.save({
      ...s.doc,
      version: 2,
      report_id: "after",
      items: [{ ...source, id: "different", fact_summary: "Replacement" }],
    });
    const data = readArchives(s.dir, { allowDemo: true });
    assert.equal(
      data.current.find((x) => x.id === source.id).fact_summary,
      "Old current content",
    );
    assert.equal(
      data.current.find((x) => x.id === source.id).report_date,
      "2026-11-02",
    );
    assert.equal(
      data.reports.find((x) => x.report_id === "before").items[0].fact_summary,
      "Withdrawn content",
    );
  } finally {
    s.close();
  }
});
test('Linux archive paths cannot be disguised by backslashes in a filename',()=>{
 const s=setup();try{writeFileSync(s.dir+'/2026\\11\\03\\opensource\\v000001.json',JSON.stringify(s.doc));assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/unexpected archive file/);}finally{s.close();}
});

test('Codex-reported archives render without fabricating backend fetch timestamps',async()=>{
 const s=setup();try{
  s.doc.items[0].verification='codex_reported';s.doc.items[0].source.fetched_at=null;s.save(s.doc);
  const data=readArchives(s.dir,{allowDemo:true});assert.equal(data.articles[0].verification,'codex_reported');assert.equal(data.articles[0].source.fetched_at,null);
  const {rss}=await import('../apps/web/generator/rss.mjs');const feed=rss(data,'https://example.com');
  assert.match(feed,/来源由 Codex 提供/);assert.ok(!feed.includes('抓取：null'));assert.ok(!feed.includes('人工允许发布'));
 }finally{s.close();}
});
test('archive source mode and fetch timestamp must agree',()=>{
 for(const [verification,fetched_at]of[['source_only',null],['codex_reported','2026-11-03T00:00:00Z']]){
  const s=setup();try{s.doc.items[0].verification=verification;s.doc.items[0].source.fetched_at=fetched_at;s.save(s.doc);assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/invalid archive schema/);}finally{s.close();}
 }
});

const topicA = { id: "t-" + "a".repeat(24), name: "模型进展" };
const topicB = { id: "t-" + "b".repeat(24), name: "开源工具" };
function saveTopic(dir, doc, pathTopic = doc.topic.id) {
  const path = `${dir}/topics/${pathTopic}/${doc.report_date.replaceAll("-", "/")}`;
  mkdirSync(path, { recursive: true });
  writeFileSync(`${path}/v${String(doc.version).padStart(6, "0")}.json`, JSON.stringify(doc));
}
function assignTopics(dir, assignments) {
  writeFileSync(`${dir}/topics.json`, JSON.stringify({ schema_version: 1, assignments }));
}
function legacyFixture() {
  return JSON.parse(readFileSync("tests/fixtures/web-reports/2026/11/03/opensource/v000001.json", "utf8"));
}
test("topic/date revisions and shared source identities remain independent", () => {
  const dir = mkdtempSync("/tmp/web-topic-identity-");
  try {
    const base = legacyFixture();
    const a = { ...base, schema_version: 2, report_id: "a1", topic: topicA };
    const b = { ...base, schema_version: 2, report_id: "b1", topic: topicB,
      items: base.items.map((item) => ({ ...item, fact_summary: "Only topic B" })) };
    saveTopic(dir, a);
    saveTopic(dir, b);
    saveTopic(dir, { ...a, report_id: "a2", version: 2, title: "Revised topic A",
      items: base.items.map((item) => ({ ...item, fact_summary: "Only revised topic A" })) });
    const data = readArchives(dir, { allowDemo: true });
    assert.equal(data.latest.length, 2);
    assert.equal(data.topics.length, 2);
    assert.equal(data.reports.length, 3);
    assert.equal(data.current.length, 2);
    assert.equal(data.articles.length, 2);
    assert.equal(data.latest.find((r) => r.topic.id === topicA.id).version, 2);
    assert.equal(data.latest.find((r) => r.topic.id === topicB.id).version, 1);
    const [source] = base.items;
    for (const [topic, summary] of [[topicA, "Only revised topic A"], [topicB, "Only topic B"]]) {
      const story = data.current.find((item) => item.topic.id === topic.id);
      assert.equal(story.id, source.id);
      assert.equal(story.key, articleKey(source.id, topic.id));
      assert.equal(story.fact_summary, summary);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test("legacy assignments preserve archive bytes and original public article keys", () => {
  const s = setup();
  try {
    s.save(s.doc);
    const path = `${s.dir}/${s.doc.report_date.replaceAll("-", "/")}/opensource/v000001.json`;
    const original = readFileSync(path);
    const unassigned = readArchives(s.dir, { allowDemo: true });
    assert.equal(unassigned.topics[0].id, "legacy");
    assignTopics(s.dir, [{ report_id: s.doc.report_id, topic: topicA }]);
    const data = readArchives(s.dir, { allowDemo: true });
    assert.deepEqual(readFileSync(path), original);
    assert.deepEqual(data.reports[0].topic, topicA);
    assert.equal(data.current[0].key, articleKey(s.doc.items[0].id));
    assert.equal(data.current[0].key, unassigned.current[0].key);
    saveTopic(s.dir, { ...s.doc, schema_version: 2, report_id: "other-topic", topic: topicB });
    const shared = readArchives(s.dir, { allowDemo: true });
    assert.equal(shared.current.length, 2);
    assert.equal(shared.current.find((item) => item.topic.id === topicB.id).key,
      articleKey(s.doc.items[0].id, topicB.id));
  } finally { s.close(); }
});
test("topic archives reject missing/invalid topic metadata and mismatched path identity", () => {
  for (const change of [{ topic: undefined }, { topic: { ...topicA, id: "unsafe" } },
    { topic: { ...topicA, name: "" } }, { topic: { ...topicA, extra: true } }]) {
    const dir = mkdtempSync("/tmp/web-invalid-topic-");
    try {
      saveTopic(dir, { ...legacyFixture(), schema_version: 2, ...change }, topicA.id);
      assert.throws(() => readArchives(dir, { allowDemo: true }), /invalid archive schema/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
  for (const change of [{ topic: topicB }, { report_date: "2026-11-04" }, { version: 2 }, { schema_version: 1, topic: undefined }]) {
    const dir = mkdtempSync("/tmp/web-mismatch-topic-");
    try {
      const doc = { ...legacyFixture(), schema_version: 2, topic: topicA, ...change };
      const path = `${dir}/topics/${topicA.id}/2026/11/03`;
      mkdirSync(path, { recursive: true });
      writeFileSync(`${path}/v000001.json`, JSON.stringify(doc));
      assert.throws(() => readArchives(dir, { allowDemo: true }), /archive path mismatch/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});
test("legacy topic assignments reject unknown, duplicate and malformed entries or v2 reassignment", () => {
  for (const assignments of [
    [{ report_id: "missing", topic: topicA }],
    [{ report_id: "r", topic: topicA }, { report_id: "r", topic: topicB }],
    [{ report_id: "r", topic: { ...topicA, id: "../escape" } }],
    [{ report_id: "r", topic: { ...topicA, name: "" } }],
  ]) {
    const s = setup();
    try {
      s.save(s.doc); assignTopics(s.dir, assignments);
      assert.throws(() => readArchives(s.dir, { allowDemo: true }), /topic assignment/);
    } finally { s.close(); }
  }
  const dir = mkdtempSync("/tmp/web-v2-assignment-");
  try {
    const doc = { ...legacyFixture(), schema_version: 2, topic: topicA };
    saveTopic(dir, doc);
    assignTopics(dir, [{ report_id: doc.report_id, topic: topicB }]);
    assert.throws(() => readArchives(dir, { allowDemo: true }), /only supports legacy/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
