import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {migrate,migrations} from '../dist/apps/server/src/db/migrations.js';
import {buildReport} from '../dist/apps/server/src/news/report.js';
import {archiveArtifact,reviewedReport,sha256} from '../dist/apps/server/src/publish/artifact.js';

test('v9 managed Codex reports retain their approved hash and exact v1 artifact bytes after migration',()=>{
 const db=new DatabaseSync(':memory:');migrate(db,migrations.slice(0,9));
 try{
  const collectedAt='2026-11-03T00:00:00Z',candidate={id:'source',title:'Announcement',originalUrl:'https://example.com/news',canonicalUrl:'https://example.com/news',sourceName:'example.com',publishedAt:null,eventAt:null,fetchedAt:null,excerpt:'',sourceMode:'codex_reported'};
  const item={articleId:'source',category:'ai',importance:1,factSummary:'来源宣布更新。',analysis:null,evidenceQuote:'Official announcement'};
  const document=buildReport(JSON.stringify({title:'Legacy managed report',items:[item]}),[candidate],{reportId:'report',runId:'run',reportDate:'2026-11-03',collectedAt},'codex_reported');
  const configuration=JSON.stringify({topic:'Old AI topic',prompts:['Search'],autoPublish:false,schedule:{kind:'manual'},timezone:'UTC'});
  db.prepare("INSERT INTO tasks(id,name,channel,prompt,configuration_json) VALUES('task','Old task','opensource','Search',?)").run(configuration);
  db.prepare("INSERT INTO task_runs(id,task_id,idempotency_key,status,configuration_json) VALUES('run','task','key','succeeded',?)").run(configuration);
  db.prepare("INSERT INTO articles(id,original_url,canonical_url,source_name,title,fetched_at,source_mode) VALUES('source',?,?,?,'Announcement',?,'codex_reported')").run(candidate.originalUrl,candidate.canonicalUrl,candidate.sourceName,collectedAt);
  db.prepare("INSERT INTO reports(id,run_id,report_date,channel,version,title,body_markdown,content_json,status) VALUES('report','run','2026-11-03','opensource',1,?,'body',?,'approved')").run(document.title,JSON.stringify(document));
  db.prepare("INSERT INTO report_articles(report_id,article_id,position) VALUES('report','source',0)").run();
  db.prepare("INSERT INTO codex_news_runs(run_id,topic,initial_input,report_date,channel,collected_at,candidates_json,report_id,source_mode) VALUES('run','Old AI topic','Search','2026-11-03','opensource',?,?,'report','codex_reported')").run(collectedAt,JSON.stringify([candidate]));
  const contentHash=sha256(JSON.stringify({document,version:1,candidates:[candidate],links:['source']}));
  const expected=JSON.stringify({schema_version:1,report_id:'report',report_date:'2026-11-03',channel:'opensource',version:1,title:document.title,collected_at:collectedAt,review_status:'approved',approved_at:collectedAt,reviewed_content_sha256:contentHash,items:[{id:'source',category:item.category,importance:1,fact_summary:item.factSummary,analysis:null,evidence_quote:item.evidenceQuote,verification:'codex_reported',source:{name:'example.com',original_url:candidate.originalUrl,canonical_url:candidate.canonicalUrl,published_at:null,event_at:null,fetched_at:null}}]},null,2)+'\n';
  migrate(db);
  const reviewed=reviewedReport(db,'report'),artifact=archiveArtifact(reviewed,collectedAt);
  assert.equal(reviewed.contentHash,contentHash);assert.equal(artifact.content,expected);assert.equal(artifact.hash,sha256(expected));assert.equal(artifact.path,'reports/2026/11/03/opensource/v000001.json');
  assert.equal(db.prepare("SELECT public_topic_json FROM codex_news_runs WHERE run_id='run'").get().public_topic_json,null);
 }finally{db.close();}
});
