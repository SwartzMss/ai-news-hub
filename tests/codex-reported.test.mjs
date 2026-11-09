import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
const headers={authorization:'Bearer test_only_0123456789_abcdefghijklmnop'};
const configuration={name:'AI 日报',topic:'AI',prompts:['搜索最新新闻'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
const proposal={title:'AI 日报',items:[{url:'https://example.com/inaccessible.pdf',category:'ai',importance:2,factSummary:'来源称宣布更新。',analysis:null,evidenceQuote:'Codex-provided excerpt absent from Backend source content'}]};
function setup(){
 const dir=mkdtempSync('/tmp/codex-reported-'),adapter=new ControlledAdapter();let fetched=0;const artifacts=[];
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:headers.authorization.slice(7),AI_NEWS_HUB_LOG_LEVEL:'silent',AI_NEWS_HUB_GITHUB_REPOSITORY:'owner/reports',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:'fixture_only_012345678901234567890'}),{adapter,newsFetcher:async()=>{fetched++;throw new Error('Backend source fetch must never happen');},githubAdapter:{async publish(artifact){artifacts.push(JSON.parse(artifact.content));return {sha:'a'.repeat(40),committedAt:'2026-11-05T00:00:00Z'};}}});
 const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
 async function wait(fn){for(let i=0;i<200;i++){const value=await fn();if(value)return value;await delay(5);}throw Error('timeout');}
 const db=new DatabaseSync(dir+'/news.db');
 async function execute(autoPublish=false,output=proposal){const task=(await request('POST','/tasks',{...configuration,autoPublish})).json().task;const run=(await request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'run'})).json().run;await wait(()=>adapter.calls[0]);adapter.succeed(0,JSON.stringify(output));await wait(async()=>{const d=(await request('GET',`/runs/${run.id}`)).json();return !['queued','running'].includes(d.run.status)&&!d.run.publishing&&d;});return run.id;}
 return {app,adapter,db,request,wait,execute,artifacts,get fetched(){return fetched;},async close(){await app.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('Codex proposal saves directly without HTTP fetch, evidence matching, invented dates or repair Turn',async()=>{
 const s=setup();try{
  const id=await s.execute();const detail=(await s.request('GET',`/runs/${id}`)).json();assert.equal(detail.run.status,'succeeded');assert.equal(detail.turns.length,1);assert.equal(s.adapter.calls.length,1);assert.equal(s.fetched,0);
  const news=(await s.request('GET',`/news/runs/${id}`)).json().newsRun;const report=(await s.request('GET',`/news/reports/${news.report_id}`)).json().report;
  const item=report.document.items[0];assert.equal(item.verification,'codex_reported');assert.equal(item.evidenceQuote,proposal.items[0].evidenceQuote);assert.equal(item.source.fetchedAt,null);assert.equal(item.source.publishedAt,null);assert.equal(item.source.eventAt,null);
  const snapshot=s.db.prepare('SELECT source_mode,candidates_json FROM codex_news_runs WHERE run_id=?').get(id);assert.equal(snapshot.source_mode,'codex_reported');assert.equal(JSON.parse(snapshot.candidates_json)[0].excerpt,'');
  const article=s.db.prepare('SELECT source_mode,fetched_at FROM articles').get();assert.equal(article.source_mode,'codex_reported');assert.equal(article.fetched_at,report.document.collectedAt);
  const publicArticle=(await s.request('GET','/news/articles')).json().articles[0];assert.equal(publicArticle.source_mode,'codex_reported');assert.equal(publicArticle.fetched_at,null);assert.equal(publicArticle.received_at,report.document.collectedAt);
  s.db.prepare("INSERT INTO articles(id,original_url,canonical_url,source_name,title,fetched_at) VALUES ('old-api-source','https://example.com/legacy','https://example.com/legacy','example.com','Legacy source','2026-01-01T00:00:00Z')").run();
  const verifiedArticle=(await s.request('GET','/news/articles')).json().articles.find(article=>article.id==='old-api-source');assert.equal(verifiedArticle.fetched_at,'2026-01-01T00:00:00Z');assert.equal(verifiedArticle.received_at,undefined);
  const inspection=(await s.request('GET',`/news/reports/${news.report_id}/publication`)).json();assert.ok(inspection.contentHash);
  await s.request('POST',`/news/reports/${news.report_id}/approve`,{confirm:true,contentHash:inspection.contentHash});assert.equal((await s.request('POST',`/news/reports/${news.report_id}/publish`,{})).statusCode,200);
  assert.equal(s.artifacts[0].items[0].verification,'codex_reported');assert.equal(s.artifacts[0].items[0].source.fetched_at,null);assert.equal(s.fetched,0);
 }finally{await s.close();}
});
test('auto-publish accepts directly reported sources and preserves archive provenance',async()=>{
 const s=setup();try{const id=await s.execute(true);assert.equal(s.fetched,0);assert.equal(s.artifacts.length,1);assert.equal(s.artifacts[0].items[0].verification,'codex_reported');assert.equal((await s.request('GET',`/runs/${id}`)).json().turns.length,1);}finally{await s.close();}
});
test('managed research preserves optional investment details through automatic publication',async()=>{
 const s=setup();try{
  const details={kind:'investment',background:'公司公布季度业绩。',metrics:[{name:'收入',value:'12.4',unit:'亿美元',period:'2026 Q3',basis:'actual',evidenceRefs:['filing']}],evidence:[{id:'filing',name:'公司公告',url:'https://example.com/filing',supports:'季度收入实际值'}]};
  const output=structuredClone(proposal);output.items[0].details=details;
  const id=await s.execute(true,output);
  assert.equal((await s.request('GET',`/runs/${id}`)).json().run.status,'succeeded');
  assert.deepEqual(s.artifacts[0].items[0].details,details);
  assert.deepEqual(JSON.parse(s.db.prepare('SELECT content_json FROM reports WHERE run_id=?').get(id).content_json).items[0].details,details);
 }finally{await s.close();}
});
test('durable source mode prevents changing Codex report flags into verified provenance',async()=>{
 const s=setup();try{
  const id=await s.execute();const row=s.db.prepare('SELECT id,content_json FROM reports WHERE run_id=?').get(id),document=JSON.parse(row.content_json);document.items[0].verification='source_only';document.items[0].source.fetchedAt=document.collectedAt;s.db.prepare('UPDATE reports SET content_json=? WHERE id=?').run(JSON.stringify(document),row.id);
  assert.equal((await s.request('GET',`/news/reports/${row.id}/publication`)).statusCode,409);
  s.db.prepare("UPDATE codex_news_runs SET source_mode='verified' WHERE run_id=?").run(id);assert.equal((await s.request('GET',`/news/reports/${row.id}/publication`)).statusCode,409);
 }finally{await s.close();}
});
for(const [label,modify] of [['private URL',p=>p.items[0].url='https://127.0.0.1/'],['duplicate canonical sources',p=>p.items.push({...p.items[0]})],['model verification flags',p=>p.items[0].verification='source_only'],['model supplied topic',p=>p.topic={id:'t-'+'f'.repeat(24),name:'Invented'}]])test(`direct proposal still rejects ${label}`,async()=>{
 const s=setup();try{const output=structuredClone(proposal);modify(output);const id=await s.execute(false,output);assert.equal((await s.request('GET',`/runs/${id}`)).json().run.status,'failed');assert.equal((await s.request('GET','/news/reports')).json().reports.length,0);assert.equal(s.fetched,0);assert.equal(s.adapter.calls.length,1);}finally{await s.close();}
});
test('migration preserves existing independently verified Codex reports and their approval hash',async()=>{
 const {migrate,migrations}=await import('../dist/apps/server/src/db/migrations.js');
 const {buildReport}=await import('../dist/apps/server/src/news/report.js');
 const {PublicationService}=await import('../dist/apps/server/src/publish/service.js');
 const {sha256,archiveArtifact,reviewedReport}=await import('../dist/apps/server/src/publish/artifact.js');
 const db=new DatabaseSync(':memory:');migrate(db,migrations.slice(0,8));
 try{
  const fetchedAt='2026-11-03T00:00:00.000Z',candidate={id:'old-source',title:'A previously verified announcement',originalUrl:'https://example.com/old',canonicalUrl:'https://example.com/old',sourceName:'example.com',publishedAt:null,eventAt:null,fetchedAt,excerpt:'A previously verified announcement'};
  const proposal={title:'Old verified Codex report',items:[{articleId:candidate.id,category:'ai',importance:1,factSummary:'来源宣布更新。',analysis:null,evidenceQuote:candidate.title}]};
  const document=buildReport(JSON.stringify(proposal),[candidate],{reportId:'old-report',runId:'old-run',reportDate:'2026-11-03',collectedAt:fetchedAt});
  db.prepare("INSERT INTO tasks(id,name,channel,prompt) VALUES('old-task','Old','opensource','Search')").run();
  db.prepare("INSERT INTO task_runs(id,task_id,idempotency_key,status) VALUES('old-run','old-task','run','succeeded')").run();
  db.prepare("INSERT INTO articles(id,original_url,canonical_url,source_name,title,fetched_at) VALUES(?,?,?,?,?,?)").run(candidate.id,candidate.originalUrl,candidate.canonicalUrl,candidate.sourceName,candidate.title,fetchedAt);
  db.prepare("INSERT INTO reports(id,run_id,report_date,channel,title,body_markdown,content_json,status) VALUES('old-report','old-run','2026-11-03','opensource',?,'test',?,'validated')").run(document.title,JSON.stringify(document));
  db.prepare("INSERT INTO report_articles(report_id,article_id,position) VALUES('old-report',?,0)").run(candidate.id);
  db.prepare("INSERT INTO codex_news_runs(run_id,topic,initial_input,report_date,channel,collected_at,candidates_json,report_id) VALUES('old-run','AI','Search','2026-11-03','opensource',?,?,'old-report')").run(fetchedAt,JSON.stringify([candidate]));
  const oldHash=sha256(JSON.stringify({document,version:1,candidates:[candidate],links:[candidate.id]}));
  migrate(db);assert.equal(db.prepare("SELECT public_topic_json FROM codex_news_runs WHERE run_id='old-run'").get().public_topic_json,null);assert.equal(db.prepare("SELECT source_mode FROM codex_news_runs WHERE run_id='old-run'").get().source_mode,'verified');
  let saved;const service=new PublicationService(db,{repository:'owner/reports',branch:'reports'},{async publish(artifact){saved=JSON.parse(artifact.content);return {sha:'a'.repeat(40),committedAt:fetchedAt};}});
  assert.equal(service.inspect('old-report').contentHash,oldHash);const legacyArtifact=archiveArtifact(reviewedReport(db,'old-report'),fetchedAt);assert.equal(JSON.parse(legacyArtifact.content).schema_version,1);assert.equal(legacyArtifact.path,'reports/2026/11/03/opensource/v000001.json');service.approve('old-report',oldHash);assert.equal((await service.publish('old-report')).status,'succeeded');
  assert.equal(saved.items[0].verification,'source_only');assert.equal(saved.items[0].source.fetched_at,fetchedAt);await service.close();
 }finally{db.close();}
});

test('managed report snapshots topic independently of shared sources and later task edits',async()=>{
 const {createHash}=await import('node:crypto');
 const s=setup();try{
  const reports=[];
  for(const [index,topic] of ['AI','Security'].entries()){
   const task=(await s.request('POST','/tasks',{...configuration,topic})).json().task;
   const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'topic-run'})).json().run;
   await s.wait(()=>s.adapter.calls[index]);assert.equal(s.adapter.calls[index].input.input,configuration.prompts[0]);s.adapter.succeed(index,JSON.stringify(proposal));
   await s.wait(async()=>(await s.request('GET',`/runs/${run.id}`)).json().run.status==='succeeded');
   const row=s.db.prepare('SELECT * FROM reports WHERE run_id=?').get(run.id),document=JSON.parse(row.content_json);
   const expected={id:'t-'+createHash('sha256').update(task.id).digest('hex').slice(0,24),name:topic};
   assert.deepEqual(document.topic,expected);
   assert.deepEqual(JSON.parse(s.db.prepare('SELECT public_topic_json FROM codex_news_runs WHERE run_id=?').get(run.id).public_topic_json),expected);
   const inspection=(await s.request('GET',`/news/reports/${row.id}/publication`)).json();assert.ok(inspection.contentHash);
   assert.equal((await s.request('PUT',`/tasks/${task.id}`,{...configuration,name:'Renamed task',topic:'Renamed topic'})).statusCode,200);
   assert.equal((await s.request('GET',`/news/reports/${row.id}/publication`)).json().contentHash,inspection.contentHash);
   await s.request('POST',`/news/reports/${row.id}/approve`,{confirm:true,contentHash:inspection.contentHash});assert.equal((await s.request('POST',`/news/reports/${row.id}/publish`,{})).statusCode,200);
   assert.equal(s.artifacts[index].schema_version,2);assert.deepEqual(s.artifacts[index].topic,expected);reports.push(row);
  }
  assert.equal(reports[0].report_date,reports[1].report_date);assert.equal(reports[1].version,reports[0].version+1);
  assert.equal(s.artifacts[0].items[0].id,s.artifacts[1].items[0].id);assert.notEqual(s.artifacts[0].topic.id,s.artifacts[1].topic.id);assert.equal(s.adapter.calls.length,2);assert.equal(s.fetched,0);
 }finally{await s.close();}
});
for(const mutation of ['remove','rename','id','snapshot'])test(`managed topic tampering is rejected: ${mutation}`,async()=>{
 const s=setup();try{
  const id=await s.execute();const row=s.db.prepare('SELECT * FROM reports WHERE run_id=?').get(id),document=JSON.parse(row.content_json);
  assert.ok(document.topic);
  if(mutation==='remove')delete document.topic;
  else if(mutation==='rename')document.topic.name='tampered';
  else if(mutation==='id')document.topic.id='t-'+'f'.repeat(24);
  else s.db.prepare('UPDATE codex_news_runs SET public_topic_json=? WHERE run_id=?').run(JSON.stringify({id:'t-'+'f'.repeat(24),name:'tampered'}),id);
  s.db.prepare('UPDATE reports SET content_json=? WHERE id=?').run(JSON.stringify(document),row.id);
  assert.equal((await s.request('GET',`/news/reports/${row.id}/publication`)).statusCode,409);
 }finally{await s.close();}
});
test('regenerating after deletion allocates a fresh version and keeps the original run history', async () => {
 const s=setup();try {
  const firstRun=await s.execute();
  const first=(await s.request('GET','/news/reports')).json().reports[0];
  assert.equal((await s.request('DELETE',`/news/reports/${first.id}`,{confirm:true})).statusCode,200);
  assert.equal((await s.request('GET',`/runs/${firstRun}`)).json().turns.length,1);
  const task=s.db.prepare('SELECT task_id FROM task_runs WHERE id=?').get(firstRun).task_id;
  const second=(await s.request('POST',`/tasks/${task}/runs`,{idempotencyKey:'regenerate'})).json().run;
  await s.wait(()=>s.adapter.calls[1]);s.adapter.succeed(1,JSON.stringify(proposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${second.id}`)).json().run.status==='succeeded');
  const next=(await s.request('GET','/news/reports')).json().reports[0];
  assert.equal(next.version,first.version+1);
  assert.notEqual(next.id,first.id);
  assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await s.close();}
});
