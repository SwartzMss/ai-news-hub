import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { articleKey, readArchives } from "../apps/web/generator/data.mjs";
import { ARCHIVE_SCHEMA } from "../dist/apps/server/src/publish/archive-schema.js";
import { publicationFixture } from "./fixtures/publication.mjs";
import { archiveArtifact, reviewedReport } from "../dist/apps/server/src/publish/artifact.js";

function saveArchive(dir, document) {
  const folder = `${dir}/topics/${document.topic.id}/${document.report_date.replaceAll("-", "/")}`;
  mkdirSync(folder, { recursive: true });
  writeFileSync(`${folder}/v${String(document.version).padStart(6, "0")}.json`, JSON.stringify(document));
}
function setup() {
  const dir = mkdtempSync("/tmp/web-archive-");
  const f = publicationFixture();
  const doc = JSON.parse(archiveArtifact(reviewedReport(f.db, "r"), "2026-11-03T01:00:00Z").content);
  f.close();
  return {
    dir, doc,
    save(d) { saveArchive(dir, d); },
    close() { rmSync(dir, { recursive: true, force: true }); },
  };
}
function setTemplate(f, templateId, topicName) {
  const current = JSON.parse(f.db.prepare("SELECT content_json FROM reports WHERE id='r'").get().content_json);
  const topic = { ...current.topic, name: topicName };
  f.db.prepare("UPDATE task_runs SET configuration_json=? WHERE id='run'").run(JSON.stringify({templateId,topic:topicName}));
  return { ...current, topic };
}

test("public loader reads only unified v1 topic archives and chooses latest revision deterministically", () => {
  const s = setup();
  try {
    s.save(s.doc);
    s.save({ ...s.doc, report_id: "r2", version: 2, title: "revised" });
    s.save({ ...s.doc, report_id: "r3", report_date: "2026-11-04" });
    const data = readArchives(s.dir, { allowDemo: true });
    assert.equal(data.reports.length, 3);
    assert.equal(data.latest.length, 2);
    assert.equal(data.latest.find((r) => r.report_date === "2026-11-03").title, "revised");
    assert.equal(data.articles.length, 1);
    assert.equal(data.latest.every((report) => report.schema_version === 1), true);
  } finally { s.close(); }
});

test("investment details survive v1 publication and public archive loading", () => {
  const f = publicationFixture(), dir = mkdtempSync("/tmp/web-investment-");
  try {
    const base = setTemplate(f, "daily-technology", "每日科技投资简报");
    const details = {kind:"investment",background:"季度业绩较先前指引改善。",metrics:[{name:"收入",value:"12.4",unit:"亿美元",period:"2026 Q3",basis:"actual",evidenceRefs:["filing"]}],evidence:[{id:"filing",name:"公司公告",url:"https://example.com/filing",supports:"收入实际值"}]};
    const doc = {...base,items:[{...base.items[0],researchArea:undefined,category:"optical_communications",details}]};
    f.db.prepare("UPDATE reports SET content_json=? WHERE id='r'").run(JSON.stringify(doc));
    const artifact = JSON.parse(archiveArtifact(reviewedReport(f.db,"r"),"2026-11-03T01:00:00Z").content);
    assert.equal(artifact.schema_version,1);
    assert.deepEqual(artifact.items[0].details,details);
    saveArchive(dir,artifact);
    assert.deepEqual(readArchives(dir,{allowDemo:true}).articles[0].details,details);
  } finally { f.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("news details survive v1 publication and public archive loading", () => {
  const f = publicationFixture(), dir = mkdtempSync("/tmp/web-news-");
  try {
    const base = setTemplate(f,"daily-headlines","每日热点观察");
    const details = {kind:"news",background:"政策此前处于征求意见阶段。",keyFacts:[{name:"生效范围",value:"全国",nature:"confirmed",evidenceRefs:["notice"]}],timeline:[{time:"2026-11-03",precision:"date",event:"正式发布",evidenceRefs:["notice"]}],positions:[{actor:"主管部门",statement:"分阶段实施",form:"paraphrase",evidenceRefs:["notice"]}],impacts:[{description:"已发布通知",status:"observed",evidenceRefs:["notice"]}],evidence:[{id:"notice",name:"正式通知",url:"https://example.com/notice",supports:"发布时间与范围"}]};
    const doc = {...base,items:[{...base.items[0],researchArea:undefined,category:"social_event",details}]};
    f.db.prepare("UPDATE reports SET content_json=? WHERE id='r'").run(JSON.stringify(doc));
    const artifact = JSON.parse(archiveArtifact(reviewedReport(f.db,"r"),"2026-11-03T01:00:00Z").content);
    assert.equal(artifact.schema_version,1);
    assert.deepEqual(artifact.items[0].details,details);
    saveArchive(dir,artifact);
    assert.deepEqual(readArchives(dir,{allowDemo:true}).articles[0].details,details);
  } finally { f.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("project details survive v1 publication and public archive loading", () => {
  const f = publicationFixture(), dir = mkdtempSync("/tmp/web-project-");
  try {
    const base = JSON.parse(f.db.prepare("SELECT content_json FROM reports WHERE id='r'").get().content_json);
    const details = {kind:"project",overview:"本地代码检索工具。",change:{summary:"新增增量索引。",evidenceRefs:["release"]},technical:[{description:"索引只处理变更文件。",evidenceRefs:["release"]}],evidence:[{id:"release",name:"发布说明",url:"https://example.com/release",supports:"索引功能"}]};
    const doc = {...base,items:[{...base.items[0],details}]};
    f.db.prepare("UPDATE reports SET content_json=? WHERE id='r'").run(JSON.stringify(doc));
    const artifact = JSON.parse(archiveArtifact(reviewedReport(f.db,"r"),"2026-11-03T01:00:00Z").content);
    assert.deepEqual(artifact.items[0].details,details);
    saveArchive(dir,artifact);
    assert.deepEqual(readArchives(dir,{allowDemo:true}).articles[0].details,details);
  } finally { f.close(); rmSync(dir,{recursive:true,force:true}); }
});

test("public archive rejects unsafe or unresolved detail evidence", () => {
  for (const details of [
    {kind:"news",background:"政策发布。",evidence:[{id:"notice",name:"通知",url:"http://example.com/notice",supports:"发布"}]},
    {kind:"news",background:"政策发布。",evidence:[{id:"notice",name:"通知",url:"https://example.com/notice",supports:"发布"}],keyFacts:[{name:"范围",value:"全国",nature:"confirmed",evidenceRefs:["missing"]}]},
    {kind:"investment",background:"业绩变化。",evidence:[{id:"filing",name:"公告",url:"http://example.com/filing",supports:"收入"}]},
  ]) {
    const s=setup();
    try {
      s.doc.items[0].details=details;
      s.save(s.doc);
      assert.throws(()=>readArchives(s.dir,{allowDemo:true}));
    } finally { s.close(); }
  }
});

test("public build refuses malformed contracts, unsafe source URLs and path mismatches", () => {
  for (const change of [
    {review_status:"pending"},
    {schema_version:99},
    {run_id:"private"},
    {report_date:"2026-99-99"},
    {items:[]},
    {topic:undefined},
  ]) {
    const s=setup();
    try { s.save({...s.doc,...change}); assert.throws(()=>readArchives(s.dir,{allowDemo:true})); }
    finally { s.close(); }
  }
  const s=setup();
  try {
    s.doc.items[0].source.canonical_url="javascript:alert(1)";
    s.save(s.doc);
    assert.throws(()=>readArchives(s.dir,{allowDemo:true}));
  } finally { s.close(); }
  assert.equal(ARCHIVE_SCHEMA.properties.review_status.const,"approved");
});

test("production rejects demo data and archive symlinks", async () => {
  const s=setup();
  try {
    s.save(s.doc);
    assert.throws(()=>readArchives(s.dir),/test report/);
    const {symlinkSync}=await import("node:fs");
    symlinkSync(s.dir+"/topics",s.dir+"/link");
    assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/symlink/);
  } finally { s.close(); }
});

test("revisions retain historical content while current content stays topic-scoped", () => {
  const s=setup();
  try {
    const source=s.doc.items[0];
    s.save({...s.doc,report_date:"2026-11-02",report_id:"old",items:[{...source,fact_summary:"Old current content"}]});
    s.save({...s.doc,report_id:"before",items:[{...source,fact_summary:"Withdrawn content"}]});
    s.save({...s.doc,version:2,report_id:"after",items:[{...source,id:"different",fact_summary:"Replacement"}]});
    const data=readArchives(s.dir,{allowDemo:true});
    assert.equal(data.current.find(x=>x.id===source.id).fact_summary,"Old current content");
    assert.equal(data.current.find(x=>x.id===source.id).report_date,"2026-11-02");
    assert.equal(data.reports.find(x=>x.report_id==="before").items[0].fact_summary,"Withdrawn content");
  } finally { s.close(); }
});

test("archive loader rejects backslash paths and legacy assignment files", () => {
  const s=setup();
  try {
    writeFileSync(s.dir+"/topics\\t-aaaaaaaaaaaaaaaaaaaaaaaa\\2026\\11\\03\\v000001.json",JSON.stringify(s.doc));
    assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/unexpected archive file/);
    writeFileSync(s.dir+"/topics.json",JSON.stringify({schema_version:1,assignments:[]}));
    assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/unexpected archive file/);
  } finally { s.close(); }
});

test("Codex-reported v1 archives preserve null fetch timestamps without fabricating them", async () => {
  const s=setup();
  try {
    s.doc.items[0].verification="codex_reported";
    s.doc.items[0].source.fetched_at=null;
    s.save(s.doc);
    const data=readArchives(s.dir,{allowDemo:true});
    assert.equal(data.articles[0].verification,"codex_reported");
    assert.equal(data.articles[0].source.fetched_at,null);
    const {rss}=await import("../apps/web/generator/rss.mjs");
    const feed=rss(data,"https://example.com");
    assert.match(feed,/来源由 Codex 提供/);
    assert.ok(!feed.includes("抓取：null"));
    assert.ok(!feed.includes("人工允许发布"));
  } finally { s.close(); }
});

test("archive source mode and fetch timestamp must agree", () => {
  for (const [verification,fetched_at] of [["source_only",null],["codex_reported","2026-11-03T00:00:00Z"]]) {
    const s=setup();
    try { s.doc.items[0].verification=verification;s.doc.items[0].source.fetched_at=fetched_at;s.save(s.doc);assert.throws(()=>readArchives(s.dir,{allowDemo:true}),/invalid archive schema/); }
    finally { s.close(); }
  }
});

const topicA={id:"t-"+"a".repeat(24),name:"模型进展"};
const topicB={id:"t-"+"b".repeat(24),name:"开源工具"};
test("topic/date revisions and shared source identities remain independent under v1",()=>{
 const dir=mkdtempSync("/tmp/web-topic-identity-");
 try{
  const base=JSON.parse(readFileSync("tests/fixtures/web-reports/topics/t-aaaaaaaaaaaaaaaaaaaaaaaa/2026/11/03/v000001.json","utf8"));
  const a={...base,report_id:"a1",topic:topicA};
  const b={...base,report_id:"b1",topic:topicB,items:base.items.map(item=>({...item,fact_summary:"Only topic B"}))};
  const save=d=>{const folder=`${dir}/topics/${d.topic.id}/${d.report_date.replaceAll("-","/")}`;mkdirSync(folder,{recursive:true});writeFileSync(`${folder}/v${String(d.version).padStart(6,"0")}.json`,JSON.stringify(d));};
  save(a);save(b);save({...a,report_id:"a2",version:2,title:"Revised topic A",items:base.items.map(item=>({...item,fact_summary:"Only revised topic A"}))});
  const data=readArchives(dir,{allowDemo:true});
  assert.equal(data.latest.length,2);assert.equal(data.topics.length,2);assert.equal(data.reports.length,3);assert.equal(data.current.length,2);assert.equal(data.articles.length,2);
  assert.equal(data.latest.find(r=>r.topic.id===topicA.id).version,2);assert.equal(data.latest.find(r=>r.topic.id===topicB.id).version,1);
  const [source]=base.items;
  for(const [topic,summary] of [[topicA,"Only revised topic A"],[topicB,"Only topic B"]]){
   const story=data.current.find(item=>item.topic.id===topic.id);
   assert.equal(story.id,source.id);assert.equal(story.key,articleKey(source.id,topic.id));assert.equal(story.fact_summary,summary);
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test("v1 requires topic metadata and rejects topic/path mismatches",()=>{
 for(const change of [{topic:undefined},{topic:{...topicA,id:"unsafe"}},{topic:{...topicA,name:""}},{topic:{...topicA,extra:true}}]){
  const dir=mkdtempSync("/tmp/web-invalid-topic-");
  try{
   const base=JSON.parse(readFileSync("tests/fixtures/web-reports/topics/t-aaaaaaaaaaaaaaaaaaaaaaaa/2026/11/03/v000001.json","utf8"));
   const doc={...base,...change};const folder=`${dir}/topics/${topicA.id}/2026/11/03`;mkdirSync(folder,{recursive:true});writeFileSync(`${folder}/v000001.json`,JSON.stringify(doc));
   assert.throws(()=>readArchives(dir,{allowDemo:true}),/invalid archive schema/);
  }finally{rmSync(dir,{recursive:true,force:true});}
 }
 const dir=mkdtempSync("/tmp/web-mismatch-topic-");
 try{
  const base=JSON.parse(readFileSync("tests/fixtures/web-reports/topics/t-aaaaaaaaaaaaaaaaaaaaaaaa/2026/11/03/v000001.json","utf8"));
  const doc={...base,topic:topicB};const folder=`${dir}/topics/${topicA.id}/2026/11/03`;mkdirSync(folder,{recursive:true});writeFileSync(`${folder}/v000001.json`,JSON.stringify(doc));
  assert.throws(()=>readArchives(dir,{allowDemo:true}),/archive path mismatch/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
