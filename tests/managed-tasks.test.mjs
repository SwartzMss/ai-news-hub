import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
import {nextOccurrence} from '../dist/apps/server/src/tasks/configuration.js';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
const headers={authorization:'Bearer test_only_0123456789_abcdefghijklmnop'};
const configuration={name:'AI 日报',topic:'AI',prompts:['搜索原始公告','筛选并核实'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
const proposal={title:'AI 日报',items:[{url:'https://example.com/model',category:'ai',importance:2,factSummary:'来源宣布模型更新。',analysis:null,evidenceQuote:'Official AI model release announcement'}]};
function setup(publish){
 const dir=mkdtempSync('/tmp/managed-tasks-'),adapter=new ControlledAdapter();
 const env={AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:headers.authorization.slice(7),AI_NEWS_HUB_LOG_LEVEL:'silent',...(publish?{AI_NEWS_HUB_GITHUB_REPOSITORY:'fixture/archive',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:'fixture_github_secret_012345678901234'}:{})};
 const app=buildServer(loadConfig(env),{adapter,newsFetcher:async()=>new Response('<html><head><title>Official AI model release announcement</title></head><body><p>Official AI model release announcement</p></body></html>',{headers:{'content-type':'text/html'}}),githubAdapter:publish});
 const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
 async function wait(fn){for(let i=0;i<200;i++){const result=await fn();if(result)return result;await delay(5);}throw Error('timeout');}
 return {app,adapter,request,wait,async close(){await app.close();rmSync(dir,{recursive:true,force:true});}};
}
test('managed tasks CRUD, ordered same-thread prompts, automatic finalization, and immutable history',async()=>{
 const s=setup();try{
  const created=await s.request('POST','/tasks',configuration);assert.equal(created.statusCode,201);const task=created.json().task;
  assert.deepEqual(task.configuration.prompts,configuration.prompts);assert.equal(task.next_run_at,null);
  const started=await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'start'});assert.equal(started.statusCode,202);const id=started.json().run.id;
  await s.wait(()=>s.adapter.calls[0]);assert.equal(s.adapter.calls[0].input.webSearch,true);
  assert.equal((await s.request('PUT',`/tasks/${task.id}`,configuration)).statusCode,409);
  assert.equal((await s.request('DELETE',`/tasks/${task.id}`)).statusCode,409);
  assert.equal((await s.request('POST',`/runs/${id}/turns`,{idempotencyKey:'bad',input:'manual followup'})).statusCode,409);
  s.adapter.succeed(0,'first');await s.wait(()=>s.adapter.calls[1]);assert.equal(s.adapter.calls[1].input.threadId,'thread-0');assert.ok(s.adapter.calls[1].input.input.includes(configuration.prompts[1]));
  assert.ok(s.adapter.calls[1].input.outputSchema);assert.equal(s.adapter.calls[1].input.input,configuration.prompts[1]);
  assert.ok(s.adapter.calls[1].input.outputSchema.properties.items.items.required.includes('details'));
  s.adapter.succeed(1,JSON.stringify({...proposal,items:[{...proposal.items[0],details:null}]}));await s.wait(async()=>{const r=(await s.request('GET',`/runs/${id}`)).json();if(r.run.status==='failed')throw Error(JSON.stringify(r));return r.run.status==='succeeded'&&r.turns.length===2;});
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'validated');
  assert.equal((await s.request('DELETE',`/tasks/${task.id}`)).statusCode,204);
  assert.ok(!(await s.request('GET','/tasks')).json().tasks.some(t=>t.id===task.id));
  assert.equal((await s.request('GET',`/runs/${id}`)).statusCode,200);
 }finally{await s.close();}
});
for(const count of [8,10])test(`explicit fixed-${count} marker rejects underfilled reports before persistence`,async()=>{
 const s=setup();try{
  const task=(await s.request('POST','/tasks',{...configuration,prompts:[`筛选重要新闻。【固定 ${count} 条】`]})).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'underfilled'})).json().run;
  const call=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(call.input.outputSchema.properties.items.minItems,1);
  assert.equal(call.input.outputSchema.properties.items.maxItems,count);
  s.adapter.succeed(0,JSON.stringify(proposal));
  const failed=await s.wait(async()=>{const r=(await s.request('GET',`/runs/${run.id}`)).json().run;return r.status==='failed'&&r;});
  assert.equal(failed.error_code,'report_item_count_invalid');
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,0);
 }finally{await s.close();}
});
test('two-round flexible technology task accepts a short report and reuses it for deduplication',async()=>{
 const s=setup();try{
  const template=promptTemplates().find(t=>t.id==='daily-technology');
  const task=(await s.request('POST','/tasks',{...configuration,topic:template.topic,prompts:template.prompts})).json().task;
  const first=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'first'})).json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'候选事件及来源');
  const final=await s.wait(()=>s.adapter.calls[1]);
  assert.equal(final.input.outputSchema.properties.items.maxItems,10);
  assert.equal(final.input.threadId,'thread-0');
  s.adapter.succeed(1,JSON.stringify(proposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${first}`)).json().run.status==='succeeded');
  await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'second'});
  const second=await s.wait(()=>s.adapter.calls[2]);
  assert.match(second.input.developerInstructions,/近期同任务日报/);
  assert.match(second.input.developerInstructions,/https:\/\/example\.com\/model/);
 }finally{await s.close();}
});
test('flexible-count tasks receive full same-task history without leaking it to another task',async()=>{
 const s=setup();try{
  const prompts=['研究并生成日报'];
  const task=(await s.request('POST','/tasks',{...configuration,name:'自定义任务名',topic:'用户自定义主题',templateId:'daily-opensource',templateVersion:1,prompts})).json().task;
  const first=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'first-flexible'})).json().run.id;
  const firstCall=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(firstCall.input.outputSchema.properties.items.items.properties.details.anyOf,undefined);
  assert.match(firstCall.input.developerInstructions,/fact.*evidenceRefs/);
  assert.match(firstCall.input.developerInstructions,/历史去重状态.*不要写入.*evaluation/);
  const summary='项目发布了重要更新。适合本地文件处理；[项目仓库](https://github.com/example/project)';
  const openSourceProposal={title:'每日开源项目',items:[{...proposal.items[0],category:'opensource',researchArea:'rust',factSummary:summary,url:'https://example.com/releases/v2',details:{kind:'project',overview:'用于本地批量文件处理。',change:{summary:'发布并行处理能力。',evidenceRefs:['release']},evidence:[{id:'release',name:'Release',url:'https://example.com/releases/v2',supports:'并行处理能力'}]}}]};
  s.adapter.succeed(0,JSON.stringify(openSourceProposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${first}`)).json().run.status==='succeeded');
  const secondRun=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'second-flexible'})).json().run.id;
  const second=await s.wait(()=>s.adapter.calls[1]);
  assert.equal(second.input.outputSchema.properties.items.maxItems,10);
  assert.match(second.input.developerInstructions,/近期同任务日报/);
  assert.ok(second.input.developerInstructions.includes(summary));
  assert.ok(second.input.developerInstructions.includes('https://example.com/releases/v2'));
  s.adapter.succeed(1,JSON.stringify(openSourceProposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${secondRun}`)).json().run.status==='succeeded');
  const other=(await s.request('POST','/tasks',{...configuration,name:'另一个开源任务',topic:'每日开源项目',prompts})).json().task;
  await s.request('POST',`/tasks/${other.id}/runs`,{idempotencyKey:'other-flexible'});
  const third=await s.wait(()=>s.adapter.calls[2]);
  assert.doesNotMatch(third.input.developerInstructions,/近期同任务日报/);
  assert.ok(Array.isArray(third.input.outputSchema.properties.items.items.properties.details.anyOf));
 }finally{await s.close();}
});
test('daily technology template routes to focused AI investment schema independently of editable topic',async()=>{
 const s=setup();try{
  const prompts=['发现 AI 产业链、光模块与半导体候选事件','核查并生成科技投资日报 JSON'];
  const created=await s.request('POST','/tasks',{
   ...configuration,name:'每日科技投资简报',topic:'自定义科技主题',
   templateId:'daily-technology',templateVersion:1,prompts,
  });
  assert.equal(created.statusCode,201);
  const task=(await s.request('GET','/tasks')).json().tasks.find(item=>item.name==='每日科技投资简报');
  assert.ok(task?.id,'technology task should be persisted');
  const started=await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'technology-schema'});
  assert.equal(started.statusCode,202);
  const run=started.json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'已完成三个方向的候选发现。');
  const final=await s.wait(()=>s.adapter.calls[1]);
  const itemSchema=final.input.outputSchema.properties.items.items;
  assert.ok(itemSchema.required.includes('details'));
  assert.deepEqual(itemSchema.properties.category.enum,['ai_industry_chain','optical_communications','semiconductor']);
  for(const field of ['kind','background','evidence'])assert.ok(itemSchema.properties.details.required.includes(field),field);
  const output={title:'2026-11-13 每日科技投资简报',items:[{
   url:'https://example.com/filing',category:'ai_industry_chain',importance:5,
   factSummary:'云厂商上调 AI 数据中心资本开支计划。',
   analysis:'资本开支兑现可能拉动 GPU、服务器和网络设备需求。',
   evidenceQuote:'Official AI model release announcement',
   details:{
    kind:'investment',
    background:'公司在业绩会上更新了 AI 数据中心资本开支计划。',
    evidence:[{id:'filing',name:'公司业绩会纪要',url:'https://example.com/filing',supports:'AI 数据中心资本开支计划'}],
   },
  }]};
  s.adapter.succeed(1,JSON.stringify(output));
  const completed=await s.wait(async()=>{
   const result=(await s.request('GET',`/runs/${run}`)).json().run;
   if(result.status==='failed')throw new Error(JSON.stringify(result));
   return result.status==='succeeded'&&result;
  });
  assert.equal(completed.status,'succeeded');
  const reports=(await s.request('GET','/news/reports')).json().reports;
  assert.equal(reports.length,1);
  const publication=await s.request('GET',`/news/reports/${reports[0].id}/publication`);
  assert.equal(publication.statusCode,200,'technology reports must pass publication provenance checks');
  assert.match(publication.json().contentHash,/^[a-f0-9]{64}$/);
  const approved=await s.request('POST',`/news/reports/${reports[0].id}/approve`,{contentHash:publication.json().contentHash,confirm:true});
  assert.equal(approved.statusCode,200,'technology reports must remain approvable');
 }finally{await s.close();}
});
test('daily headlines template routes to strict social trend schema independently of editable topic',async()=>{
 const s=setup();try{
  const prompts=['发现最近 24 小时社交平台热点','核查并生成热点日报 JSON'];
  const task=(await s.request('POST','/tasks',{
   ...configuration,name:'每日热点观察',topic:'我的网络热点日报',
   templateId:'daily-headlines',templateVersion:1,prompts,
  })).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'headlines-schema'})).json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'已完成候选话题发现。');
  const final=await s.wait(()=>s.adapter.calls[1]);
  const itemSchema=final.input.outputSchema.properties.items.items;
  assert.ok(itemSchema.required.includes('details'));
  assert.deepEqual(itemSchema.properties.category.enum,['social_event','entertainment','tech_digital','sports','film_animation','gaming','finance_consumption','internet_culture','lifestyle_emotion','international_topic','other']);
  assert.equal(itemSchema.properties.details.properties.trendSignals.minItems,1);
  assert.ok(itemSchema.properties.details.required.includes('contentSuitability'));
  const output={title:'2026-11-13 北京时间网络热点',items:[{
   url:'https://example.com/event',category:'social_event',importance:4,
   factSummary:'一个社会话题在微博平台进入热榜并引发讨论。',
   analysis:null,evidenceQuote:'Public platform trend signal',
   details:{
    kind:'news',background:'该话题在最近 24 小时进入微博热榜。',
    trendTags:['single_platform'],contentTags:['short_video'],
    trendSignals:[{platform:'weibo',contentType:'hashtag',metric:'rank',value:'热榜第 2 位',observedAt:'2026-11-13T06:00:00+08:00',evidenceType:'direct',evidenceRefs:['trend']}],
    contentSuitability:'recommended',contentReason:'话题有明确事实和可解释的讨论焦点。',
    contentAngles:[{angle:'解释争议焦点',suggestedTitle:'大家为什么讨论这个话题？',hook:'争议到底在哪里？',corePoints:['还原公开事实'],evidenceRefs:['source']}],
    evidence:[
     {id:'trend',name:'微博话题页',url:'https://example.com/weibo',supports:'微博热榜排名'},
     {id:'source',name:'事件来源',url:'https://example.com/source',supports:'话题背景和事实'},
    ],
   },
  }]};
  s.adapter.succeed(1,JSON.stringify(output));
  const completed=await s.wait(async()=>{
   const result=(await s.request('GET',`/runs/${run}`)).json().run;
   return result.status==='succeeded'&&result;
  });
  assert.equal(completed.status,'succeeded');
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,1);

  const generic=(await s.request('POST','/tasks',{...configuration,name:'普通热点主题',topic:'每日热点观察',prompts:['搜索','整理']})).json().task;
  const genericRun=(await s.request('POST',`/tasks/${generic.id}/runs`,{idempotencyKey:'generic-headlines-name'})).json().run.id;
  await s.wait(()=>s.adapter.calls[2]);
  s.adapter.succeed(2,'普通主题研究结果');
  const genericFinal=await s.wait(()=>s.adapter.calls[3]);
  const genericItem=genericFinal.input.outputSchema.properties.items.items;
  assert.ok(Array.isArray(genericItem.properties.details.anyOf));
  assert.equal(JSON.stringify(genericItem.properties.details).includes('trendSignals'),false);
  const partialSocialOutput={title:'普通主题研究',items:[{
   url:'https://example.com/generic',category:'social_event',importance:3,
   factSummary:'普通主题结果不应使用热点专属字段。',analysis:null,evidenceQuote:'Generic source evidence',
   details:{kind:'news',background:'普通主题背景。',trendSignals:[{platform:'weibo',contentType:'hashtag',metric:'rank',value:'热榜第 2 位',observedAt:'2026-11-13T06:00:00+08:00',evidenceType:'direct',evidenceRefs:['trend']}]},
  }]};
  s.adapter.succeed(3,JSON.stringify(partialSocialOutput));
  const genericFailed=await s.wait(async()=>{
   const result=(await s.request('GET',`/runs/${genericRun}`)).json().run;
   return result.status==='failed'&&result;
  });
  assert.equal(genericFailed.error_code,'report_schema_invalid');
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,1);
 }finally{await s.close();}
});
test('open-source tasks reject more than two projects in a single research area',async()=>{
 const s=setup();try{
  const task=(await s.request('POST','/tasks',{
   ...configuration,name:'开源日报',topic:'任意可编辑主题',
   templateId:'daily-opensource',templateVersion:1,prompts:['研究并生成日报'],
  })).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'area-limit'})).json().run.id;
  const call=await s.wait(()=>s.adapter.calls[0]);
  assert.ok(call.input.outputSchema.properties.items.items.required.includes('researchArea'));
  const items=Array.from({length:3},(_,index)=>({
   ...proposal.items[0],
   category:'opensource',
   importance:3,
   researchArea:'rust',
   factSummary:`Rust 工具 ${index+1} 发布并行处理更新。适合批量文件处理；[项目仓库](https://github.com/example/project-${index+1})`,
   evidenceQuote:`Official Rust tool release announcement ${index+1}`,
   url:`https://example.com/releases/${index+1}`,
   details:{
    kind:'project',
    overview:'用于本地批量文件处理。',
    change:{summary:'发布并行处理能力。',evidenceRefs:['release']},
    evidence:[{id:'release',name:'Release',url:`https://example.com/releases/${index+1}`,supports:'并行处理能力'}],
   },
  }));
  s.adapter.succeed(0,JSON.stringify({title:'开源日报',items}));
  const failed=await s.wait(async()=>{
   const result=(await s.request('GET',`/runs/${run}`)).json().run;
   return result.status==='failed'&&result;
  });
  assert.equal(failed.error_code,'report_research_area_limit_exceeded');
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,0);
 }finally{await s.close();}
});
test('stop prevents subsequent rounds; invalid plans are rejected',async()=>{
 const s=setup();try{
  for(const bad of [{schedule:{kind:'toString'}},{schedule:{kind:'__proto__'}},{schedule:{kind:42}},{prompts:[]},{timezone:'bad/timezone'},{templateId:'daily-opensource'},{templateVersion:1},{templateId:'daily-opensource',templateVersion:0},{templateId:'Daily Open Source',templateVersion:1},{schedule:{kind:'interval',minutes:0}},{schedule:{kind:'weekly',time:'25:00',weekday:8}}])assert.equal((await s.request('POST','/tasks',{...configuration,...bad})).statusCode,400);
  const task=(await s.request('POST','/tasks',configuration)).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'stop'})).json().run;
  await s.wait(()=>s.adapter.calls[0]);await s.request('POST',`/tasks/${task.id}/stop`);
  await s.wait(async()=>(await s.request('GET',`/runs/${run.id}`)).json().run.status==='cancelled');assert.equal(s.adapter.calls.length,1);
  assert.equal((await s.request('PUT',`/tasks/${task.id}`,{...configuration,status:'paused'})).statusCode,200);
  assert.equal((await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'paused'})).statusCode,202);
 }finally{await s.close();}
});
test('schedule computes strictly future UTC instants in task timezone without catchup',()=>{
 const base={...configuration};
 assert.equal(nextOccurrence({...base,schedule:{kind:'daily',time:'08:30'}},new Date('2026-11-04T00:29:00Z')),'2026-11-04T00:30:00.000Z');
 assert.equal(nextOccurrence({...base,schedule:{kind:'weekly',time:'08:30',weekday:3}},new Date('2026-11-04T00:30:00Z')),'2026-11-11T00:30:00.000Z');
 assert.equal(nextOccurrence({...base,schedule:{kind:'once',at:'2026-11-04T00:00:00Z'}},new Date('2026-11-05T00:00:00Z')),null);
 assert.equal(nextOccurrence({...base,schedule:{kind:'interval',minutes:5}},new Date('2026-11-04T00:00:00Z')),'2026-11-04T00:05:00.000Z');
});
for(const fails of [false,true])test(`automatic publishing ${fails?'records failure and allows retry':'pushes only validated report'}`,async()=>{
 let writes=0;const s=setup({async publish(){writes++;if(fails&&writes===1)throw Error('fixture unavailable');return {sha:'a'.repeat(40),committedAt:'2026-11-04T00:00:00Z'};}});
 try{
  const task=(await s.request('POST','/tasks',{...configuration,prompts:['搜索'],autoPublish:true})).json().task;
  const id=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'publish'})).json().run.id;
  await s.wait(()=>s.adapter.calls[0]);assert.ok(s.adapter.calls[0].input.outputSchema);s.adapter.succeed(0,JSON.stringify(proposal));
  await s.wait(()=>writes===1);
  const report=(await s.request('GET','/news/reports')).json().reports[0];
  const inspection=(await s.request('GET',`/news/reports/${report.id}/publication`)).json();
  assert.equal(inspection.approval.approval_kind,'automatic');
  assert.equal(inspection.publications[0].status,fails?'failed':'succeeded');
  assert.equal(report.status,fails?'approved':'published');
  if(fails){const result=await s.wait(async()=>{const r=(await s.request('GET',`/runs/${id}`)).json().run;return r.error_code&&r;});assert.equal(result.status,'succeeded');
    const retry=await s.request('POST',`/news/reports/${report.id}/publish`,{});assert.equal(retry.statusCode,200);assert.equal(writes,2);
    assert.equal((await s.request('GET',`/runs/${id}`)).json().run.error_code,null);
  }
 }finally{await s.close();}
});
test('due schedule starts once, skips overlaps, and restart advances missed intervals',async()=>{
 const {openDatabase}=await import('../dist/apps/server/src/db/database.js');
 const {TaskEngine}=await import('../dist/apps/server/src/tasks/engine.js');
 const dir=mkdtempSync('/tmp/managed-schedule-'),db=openDatabase(dir),adapter=new ControlledAdapter();
 let engine=new TaskEngine(db,{adapter,concurrency:1,maxQueue:20,timeoutMs:120000,cwd:dir});
 try{
  const task=engine.createTask({...configuration,schedule:{kind:'interval',minutes:5}});
  const due='2026-11-04T00:00:00.000Z';db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(due,task.id);
  engine.tick(new Date(due));await delay(5);assert.equal(adapter.calls.length,1);
  assert.equal(engine.listRuns(task.id)[0].trigger_kind,'scheduled');
  engine.tick(new Date('2026-11-04T00:05:00Z'));await delay(5);assert.equal(adapter.calls.length,1);
  assert.equal(engine.task(task.id).next_run_at,'2026-11-04T00:10:00.000Z');
  await engine.close();engine=new TaskEngine(db,{adapter:new ControlledAdapter(),concurrency:1,maxQueue:20,timeoutMs:120000,cwd:dir});
  db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(due,task.id);engine.resetSchedules();
  assert.ok(Date.parse(engine.task(task.id).next_run_at)>Date.now());
  assert.equal(engine.listRuns(task.id).length,1);
 }finally{await engine.close();db.close();rmSync(dir,{recursive:true,force:true});}
});

test('task routes accept maximum configured prompt payload while retaining per-prompt bounds',async()=>{
 const s=setup();try{
  const payload={...configuration,prompts:Array.from({length:20},()=> '新'.repeat(8000))};
  const created=await s.request('POST','/tasks',payload);assert.equal(created.statusCode,201);
  const id=created.json().task.id;assert.equal((await s.request('PUT',`/tasks/${id}`,payload)).statusCode,200);
  assert.equal((await s.request('POST','/tasks',{...payload,prompts:['x'.repeat(8001)]})).statusCode,400);
 }finally{await s.close();}
});
test('stopping publication does not record success when an adapter ignores abort',async()=>{
 let resolvePublish;const s=setup({publish(){return new Promise(resolve=>{resolvePublish=resolve;});}});
 try{
  const task=(await s.request('POST','/tasks',{...configuration,prompts:['搜索'],autoPublish:true})).json().task;
  const id=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'publish-stop'})).json().run.id;
  await s.wait(()=>s.adapter.calls[0]);assert.ok(s.adapter.calls[0].input.outputSchema);s.adapter.succeed(0,JSON.stringify(proposal));
  await s.wait(()=>resolvePublish);assert.equal((await s.request('GET',`/tasks/${task.id}/runs`)).json().runs[0].publishing,true);
  await s.request('POST',`/tasks/${task.id}/stop`);resolvePublish({sha:'a'.repeat(40),committedAt:'2026-11-04T00:00:00Z'});
  await s.wait(async()=>(await s.request('GET',`/runs/${id}`)).json().run.error_code==='publication_interrupted');
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'approved');
  const inspection=(await s.request('GET',`/news/reports/${report.id}/publication`)).json();assert.equal(inspection.publications[0].status,'failed');
 }finally{await s.close();}
});
for(const count of [1,2,20])test(`${count} configured Prompts execute exactly ${count} original Turns with only the last structured`,async()=>{
 const s=setup();try{
  const prompts=Array.from({length:count},(_,i)=>`  Configured Prompt ${i+1}\nPreserve literal input  `);
  const task=(await s.request('POST','/tasks',{...configuration,prompts})).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'exact-count'})).json().run;
  for(let index=0;index<count;index++){
   await s.wait(()=>s.adapter.calls[index]);const input=s.adapter.calls[index].input;
   assert.equal(input.input,prompts[index]);assert.equal(!!input.outputSchema,index===count-1);
   assert.equal(input.threadId,index===0?undefined:'thread-0');assert.ok(input.developerInstructions.includes(configuration.topic));
   s.adapter.succeed(index,index===count-1?JSON.stringify(proposal):`Research ${index+1}`);
  }
  const result=await s.wait(async()=>{const detail=(await s.request('GET',`/runs/${run.id}`)).json();return detail.run.status==='succeeded'&&detail;});
  await delay(10);assert.equal(s.adapter.calls.length,count);assert.equal(result.turns.length,count);
  assert.deepEqual(result.turns.map(turn=>turn.input_text),prompts);assert.deepEqual(result.turns.map(turn=>turn.mode),prompts.map((_,index)=>index===count-1?'finalize':'research'));
  assert.equal(result.turns.some(turn=>turn.input_text==='依据前面所有轮次的研究结果，生成完整日报。'),false);
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,1);
 }finally{await s.close();}
});
test('more than twenty configured Prompts is rejected and stopping the final Prompt adds no Turn',async()=>{
 const s=setup();try{
  assert.equal((await s.request('POST','/tasks',{...configuration,prompts:Array(21).fill('Search')})).statusCode,400);
  const task=(await s.request('POST','/tasks',configuration)).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'stop-final'})).json().run;
  await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'research');await s.wait(()=>s.adapter.calls[1]);assert.ok(s.adapter.calls[1].input.outputSchema);
  await s.request('POST',`/tasks/${task.id}/stop`);await s.wait(async()=>(await s.request('GET',`/runs/${run.id}`)).json().run.status==='cancelled');
  assert.equal(s.adapter.calls.length,2);assert.equal((await s.request('GET',`/runs/${run.id}`)).json().turns.length,2);assert.equal((await s.request('GET','/news/reports')).json().reports.length,0);
 }finally{await s.close();}
});

test('editing publication, names and prompts preserves due slot; scheduling changes recalculate it',async()=>{
 const {openDatabase}=await import('../dist/apps/server/src/db/database.js');
 const {TaskEngine}=await import('../dist/apps/server/src/tasks/engine.js');
 const dir=mkdtempSync('/tmp/schedule-edit-'),db=openDatabase(dir),engine=new TaskEngine(db,{adapter:new ControlledAdapter(),concurrency:1,maxQueue:20,timeoutMs:120000,cwd:dir});
 try{
  const input={...configuration,schedule:{kind:'interval',minutes:5}},task=engine.createTask(input),due='2026-11-04T00:00:00.000Z';
  db.prepare('UPDATE tasks SET next_run_at=? WHERE id=?').run(due,task.id);
  for(const change of [{autoPublish:true},{name:'Renamed'},{prompts:['New prompt']},{topic:'Another topic'}])assert.equal(engine.updateTask(task.id,{...input,...change}).next_run_at,due);
  assert.notEqual(engine.updateTask(task.id,{...input,schedule:{kind:'interval',minutes:10}}).next_run_at,due);
  assert.equal(engine.updateTask(task.id,{...input,status:'paused'}).next_run_at,null);
  assert.ok(Date.parse(engine.updateTask(task.id,input).next_run_at)>Date.now());
 }finally{await engine.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
