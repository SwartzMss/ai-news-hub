import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
import {nextOccurrence} from '../dist/apps/server/src/tasks/configuration.js';
import {promptTemplates} from '../dist/apps/server/src/tasks/prompt-templates.js';
const headers={authorization:'Bearer test_only_0123456789_abcdefghijklmnop'};
const defaultTemplate=promptTemplates().find(t=>t.id==='daily-technology');
const configuration={templateId:'daily-technology',templateVersion:1,autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
Object.defineProperties(configuration,{
 name:{value:defaultTemplate.name},
 topic:{value:defaultTemplate.topic},
 prompts:{value:defaultTemplate.prompts},
});
const proposal={title:'每日科技投资简报',items:[{url:'https://example.com/model',category:'ai_industry_chain',importance:2,factSummary:'来源宣布 AI 产业链更新。',analysis:null,evidenceQuote:'Official AI model release announcement',details:{kind:'investment',background:'公司公布了 AI 产业链相关进展。',evidence:[{id:'release',name:'官方公告',url:'https://example.com/model',supports:'公司公布的进展'}]}}]};
function setup(publish){
 const dir=mkdtempSync('/tmp/managed-tasks-'),adapter=new ControlledAdapter();
 const env={AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:headers.authorization.slice(7),AI_NEWS_HUB_LOG_LEVEL:'silent',...(publish?{AI_NEWS_HUB_GITHUB_REPOSITORY:'fixture/archive',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:'fixture_github_secret_012345678901234'}:{})};
 const app=buildServer(loadConfig(env),{adapter,newsFetcher:async()=>new Response('<html><head><title>Official AI model release announcement</title></head><body><p>Official AI model release announcement</p></body></html>',{headers:{'content-type':'text/html'}}),githubAdapter:publish});
 const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
 async function wait(fn){for(let i=0;i<200;i++){const result=await fn();if(result)return result;await delay(5);}throw Error('timeout');}
 const db=new DatabaseSync(dir+'/news.db');
 return {app,adapter,db,request,wait,async close(){await app.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('migration removes task prompt copies while preserving historical topic provenance',async()=>{
 const {migrate,migrations}=await import('../dist/apps/server/src/db/migrations.js');
 const db=new DatabaseSync(':memory:');
 migrate(db,migrations.slice(0,13));
 try{
  const templateConfig={templateId:'daily-technology',templateVersion:1,topic:'每日科技投资简报',prompts:['第一轮私有 Prompt','第二轮私有 Prompt'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
  db.prepare('INSERT INTO tasks(id,name,channel,prompt,status,configuration_json) VALUES(?,?,?,?,?,?)')
    .run('template-task','每日科技投资简报','opensource','第一轮私有 Prompt','active',JSON.stringify(templateConfig));
  db.prepare('INSERT INTO task_runs(id,task_id,idempotency_key,status,configuration_json) VALUES(?,?,?,?,?)')
    .run('template-run','template-task','run','succeeded',JSON.stringify(templateConfig));
  const legacyConfig={topic:'旧自定义主题',prompts:['旧版手动 Prompt'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
  db.prepare('INSERT INTO tasks(id,name,channel,prompt,status,configuration_json) VALUES(?,?,?,?,?,?)')
    .run('legacy-task','旧任务','opensource','旧版手动 Prompt','active',JSON.stringify(legacyConfig));
  migrate(db);
  const task=db.prepare('SELECT prompt,status,configuration_json FROM tasks WHERE id=?').get('template-task');
  const taskConfig=JSON.parse(task.configuration_json);
  assert.equal(task.prompt,'');
  assert.equal(Object.hasOwn(taskConfig,'prompts'),false);
  assert.equal(Object.hasOwn(taskConfig,'topic'),false);
  const runConfig=JSON.parse(db.prepare('SELECT configuration_json FROM task_runs WHERE id=?').get('template-run').configuration_json);
  assert.equal(Object.hasOwn(runConfig,'prompts'),false);
  assert.equal(runConfig.topic,'每日科技投资简报','historical run topic remains available for archive provenance');
  const legacy=db.prepare('SELECT prompt,status,configuration_json,next_run_at FROM tasks WHERE id=?').get('legacy-task');
  const legacyStored=JSON.parse(legacy.configuration_json);
  assert.equal(legacy.prompt,'');
  assert.equal(legacy.status,'paused');
  assert.equal(legacy.next_run_at,null);
  assert.equal(Object.hasOwn(legacyStored,'prompts'),false);
  assert.equal(legacyStored.topic,'旧自定义主题');
 }finally{db.close();}
});
test('template endpoint exposes selection metadata but never prompt bodies',async()=>{
 const s=setup();try{
  const response=await s.request('GET','/prompt-templates');
  assert.equal(response.statusCode,200);
  const templates=response.json().templates;
  assert.equal(templates.length,3);
  assert.ok(templates.every(template=>typeof template.promptCount==='number'&&template.promptCount>0));
  assert.ok(templates.every(template=>!Object.hasOwn(template,'prompts')));
 }finally{await s.close();}
});
test('managed tasks CRUD, ordered same-thread prompts, automatic finalization, and immutable history',async()=>{
 const s=setup();try{
  const created=await s.request('POST','/tasks',configuration);assert.equal(created.statusCode,201);const task=created.json().task;
  assert.equal(task.configuration.templateId,'daily-technology');
  assert.equal(task.configuration.templateVersion,1);
  assert.equal(task.configuration.promptCount,2);
  assert.equal(Object.hasOwn(task.configuration,'prompts'),false);
  assert.equal(task.prompt,'');
  const storedTask=s.db.prepare('SELECT prompt,configuration_json FROM tasks WHERE id=?').get(task.id);
  assert.equal(storedTask.prompt,'');
  const storedTaskConfiguration=JSON.parse(storedTask.configuration_json);
  assert.deepEqual(Object.keys(storedTaskConfiguration).sort(),['autoPublish','schedule','templateId','templateVersion','timezone']);
  assert.equal(task.next_run_at,null);
  const started=await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'start'});assert.equal(started.statusCode,202);const id=started.json().run.id;
  const storedRunConfiguration=JSON.parse(s.db.prepare('SELECT configuration_json FROM task_runs WHERE id=?').get(id).configuration_json);
  assert.deepEqual(Object.keys(storedRunConfiguration).sort(),['autoPublish','schedule','templateId','templateVersion','timezone']);
  const listed=(await s.request('GET',`/runs?taskId=${task.id}`)).json();
  assert.equal(listed.runs[0].task_name,defaultTemplate.name);
  await s.wait(()=>s.adapter.calls[0]);assert.equal(s.adapter.calls[0].input.webSearch,true);
  assert.equal((await s.request('PUT',`/tasks/${task.id}`,configuration)).statusCode,409);
  assert.equal((await s.request('DELETE',`/tasks/${task.id}`)).statusCode,409);
  assert.equal((await s.request('POST',`/runs/${id}/turns`,{idempotencyKey:'bad',input:'manual followup'})).statusCode,409);
  s.adapter.succeed(0,'first');await s.wait(()=>s.adapter.calls[1]);assert.equal(s.adapter.calls[1].input.threadId,'thread-0');assert.ok(s.adapter.calls[1].input.input.includes(configuration.prompts[1]));
  assert.ok(s.adapter.calls[1].input.outputSchema);assert.equal(s.adapter.calls[1].input.input,configuration.prompts[1]);
  assert.ok(s.adapter.calls[1].input.outputSchema.properties.items.items.required.includes('details'));
   s.adapter.succeed(1,JSON.stringify(proposal));await s.wait(async()=>{const r=(await s.request('GET',`/runs/${id}`)).json();if(r.run.status==='failed')throw Error(JSON.stringify(r));return r.run.status==='succeeded'&&r.turns.length===2;});
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'validated');
  assert.equal((await s.request('DELETE',`/tasks/${task.id}`)).statusCode,204);
  assert.ok(!(await s.request('GET','/tasks')).json().tasks.some(t=>t.id===task.id));
  assert.equal((await s.request('GET',`/runs/${id}`)).statusCode,200);
 }finally{await s.close();}
});
test('two-round flexible technology task accepts a short report and reuses it for deduplication',async()=>{
 const s=setup();try{
  const template=promptTemplates().find(t=>t.id==='daily-technology');
  const task=(await s.request('POST','/tasks',{...configuration,templateId:template.id,templateVersion:template.version})).json().task;
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
test('template-bound open-source tasks receive same-task history without leaking it to another task',async()=>{
 const s=setup();try{
  const openSourceConfiguration={...configuration,templateId:'daily-opensource'};
  const task=(await s.request('POST','/tasks',openSourceConfiguration)).json().task;
  const first=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'first-flexible'})).json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'候选项目及来源');
  const firstCall=await s.wait(()=>s.adapter.calls[1]);
  assert.equal(firstCall.input.outputSchema.properties.items.items.properties.details.anyOf,undefined);
  assert.match(firstCall.input.developerInstructions,/fact.*evidenceRefs/);
  assert.match(firstCall.input.developerInstructions,/历史去重状态.*不要写入.*evaluation/);
  const summary='项目发布了重要更新。适合本地文件处理；[项目仓库](https://github.com/example/project)';
  const openSourceProposal={title:'每日开源项目',items:[{...proposal.items[0],category:'opensource',researchArea:'rust',factSummary:summary,url:'https://example.com/releases/v2',details:{kind:'project',overview:'用于本地批量文件处理。',change:{summary:'发布并行处理能力。',evidenceRefs:['release']},evidence:[{id:'release',name:'Release',url:'https://example.com/releases/v2',supports:'并行处理能力'}]}}]};
  s.adapter.succeed(1,JSON.stringify(openSourceProposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${first}`)).json().run.status==='succeeded');
  const secondRun=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'second-flexible'})).json().run.id;
  const secondDiscovery=await s.wait(()=>s.adapter.calls[2]);
  s.adapter.succeed(2,'再次发现候选项目');
  const second=await s.wait(()=>s.adapter.calls[3]);
  assert.equal(second.input.outputSchema.properties.items.maxItems,10);
  assert.match(second.input.developerInstructions,/近期同任务日报/);
  assert.ok(second.input.developerInstructions.includes(summary));
  assert.ok(second.input.developerInstructions.includes('https://example.com/releases/v2'));
  s.adapter.succeed(3,JSON.stringify(openSourceProposal));
  await s.wait(async()=>(await s.request('GET',`/runs/${secondRun}`)).json().run.status==='succeeded');
  const other=(await s.request('POST','/tasks',openSourceConfiguration)).json().task;
  const otherRun=(await s.request('POST',`/tasks/${other.id}/runs`,{idempotencyKey:'other-flexible'})).json().run.id;
  const thirdDiscovery=await s.wait(()=>s.adapter.calls[4]);
  s.adapter.succeed(4,'另一任务的候选项目');
  const third=await s.wait(()=>s.adapter.calls[5]);
  assert.doesNotMatch(third.input.developerInstructions,/近期同任务日报/);
  const projectDetailsSchema = third.input.outputSchema.properties.items.items.properties.details;
  assert.equal(projectDetailsSchema.properties.kind.const, "project");
  assert.ok(Array.isArray(projectDetailsSchema.properties.evaluation.anyOf[0].items.anyOf));
  assert.equal((await s.request('GET',`/runs/${otherRun}`)).json().run.status,'running');
 }finally{await s.close();}
});
test('daily technology template binds its fixed topic and investment schema',async()=>{
 const s=setup();try{
  const created=await s.request('POST','/tasks',configuration);
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
test('daily headlines template binds its reader-facing news schema',async()=>{
 const s=setup();try{
  const task=(await s.request('POST','/tasks',{
   ...configuration,templateId:'daily-headlines',templateVersion:1,
  })).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'headlines-schema'})).json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'已完成候选话题发现。');
  const final=await s.wait(()=>s.adapter.calls[1]);
  assert.match(final.input.developerInstructions,/2026-11-24T09:00:00\+08:00/);
  assert.match(final.input.developerInstructions,/未明确时区.*approximate/);
  const itemSchema=final.input.outputSchema.properties.items.items;
  assert.ok(itemSchema.required.includes('details'));
  assert.deepEqual(itemSchema.properties.category.enum,['social_event','entertainment','tech_digital','sports','film_animation','gaming','finance_consumption','internet_culture','lifestyle_emotion','international_topic','other']);
  assert.equal(itemSchema.properties.details.properties.trendSignals,undefined);
  assert.equal(itemSchema.properties.details.properties.trendTags,undefined);
  assert.equal(itemSchema.properties.details.properties.discussionTags,undefined);
  assert.ok(itemSchema.properties.details.required.includes('evidence'));
  assert.equal(itemSchema.properties.details.properties.contentSuitability,undefined);
  assert.equal(itemSchema.properties.details.properties.contentAngles,undefined);
  const output={title:'2026-11-13 北京时间网络热点',items:[{
   url:'https://example.com/event',category:'social_event',importance:4,
   factSummary:'主管部门公布鉴定结果，案件调查取得新进展。',
   analysis:null,evidenceQuote:'Public platform trend signal',
   details:{
    kind:'news',background:'此前相关事件已立案，本次公布了新的鉴定结果。',
    keyFacts:[{name:'鉴定结果',value:'已公布',nature:'confirmed',evidenceRefs:['notice']}],
    evidence:[{id:'notice',name:'官方通报',url:'https://example.com/notice',supports:'鉴定结果及公布时间'}],
   },
  }]};
  s.adapter.succeed(1,JSON.stringify(output));
  const completed=await s.wait(async()=>{
   const result=(await s.request('GET',`/runs/${run}`)).json().run;
   return result.status==='succeeded'&&result;
  });
  assert.equal(completed.status,'succeeded');
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,1);

  const manualPrompt=await s.request('POST','/tasks',{...configuration,prompts:['用户自定义 Prompt']});
  assert.equal(manualPrompt.statusCode,400);
  const manualTopic=await s.request('POST','/tasks',{...configuration,topic:'用户自定义主题'});
  assert.equal(manualTopic.statusCode,400);
 }finally{await s.close();}
});
test('open-source tasks reject more than two projects in a single research area',async()=>{
 const s=setup();try{
  const task=(await s.request('POST','/tasks',{...configuration,templateId:'daily-opensource'})).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'area-limit'})).json().run.id;
  const discovery=await s.wait(()=>s.adapter.calls[0]);
  assert.equal(discovery.input.outputSchema,undefined);
  s.adapter.succeed(0,'发现三个候选项目。');
  const call=await s.wait(()=>s.adapter.calls[1]);
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
  s.adapter.succeed(1,JSON.stringify({title:'开源日报',items}));
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
  for(const bad of [{schedule:{kind:'toString'}},{schedule:{kind:'__proto__'}},{schedule:{kind:42}},{prompts:[]},{topic:'手动主题'},{name:'手动任务名'},{timezone:'bad/timezone'},{templateId:undefined},{templateVersion:0},{templateId:'Daily Open Source'},{templateId:'missing-template'},{schedule:{kind:'interval',minutes:0}},{schedule:{kind:'weekly',time:'25:00',weekday:8}}])assert.equal((await s.request('POST','/tasks',{...configuration,...bad})).statusCode,400);
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
  const task=(await s.request('POST','/tasks',{...configuration,autoPublish:true})).json().task;
  const id=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'publish'})).json().run.id;
  await s.wait(()=>s.adapter.calls[0]);assert.equal(s.adapter.calls[0].input.outputSchema,undefined);s.adapter.succeed(0,'完成候选发现。');
  await s.wait(()=>s.adapter.calls[1]);assert.ok(s.adapter.calls[1].input.outputSchema);s.adapter.succeed(1,JSON.stringify(proposal));
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

test('task API rejects user-supplied prompt, topic and task-name copies',async()=>{
 const s=setup();try{
  for(const extra of [{prompts:['manual prompt']},{topic:'manual topic'},{name:'manual name'}])
    assert.equal((await s.request('POST','/tasks',{...configuration,...extra})).statusCode,400);
  const created=await s.request('POST','/tasks',configuration);assert.equal(created.statusCode,201);
  const id=created.json().task.id;
  assert.equal((await s.request('PUT',`/tasks/${id}`,configuration)).statusCode,200);
  for(const extra of [{prompts:['manual prompt']},{topic:'manual topic'},{name:'manual name'}])
    assert.equal((await s.request('PUT',`/tasks/${id}`,{...configuration,...extra})).statusCode,400);
 }finally{await s.close();}
});
test('stopping publication does not record success when an adapter ignores abort',async()=>{
 let resolvePublish;const s=setup({publish(){return new Promise(resolve=>{resolvePublish=resolve;});}});
 try{
  const task=(await s.request('POST','/tasks',{...configuration,autoPublish:true})).json().task;
  const id=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'publish-stop'})).json().run.id;
  await s.wait(()=>s.adapter.calls[0]);assert.equal(s.adapter.calls[0].input.outputSchema,undefined);s.adapter.succeed(0,'候选发现完成。');
  await s.wait(()=>s.adapter.calls[1]);assert.ok(s.adapter.calls[1].input.outputSchema);s.adapter.succeed(1,JSON.stringify(proposal));
  await s.wait(()=>resolvePublish);assert.equal((await s.request('GET',`/tasks/${task.id}/runs`)).json().runs[0].publishing,true);
  await s.request('POST',`/tasks/${task.id}/stop`);resolvePublish({sha:'a'.repeat(40),committedAt:'2026-11-04T00:00:00Z'});
  await s.wait(async()=>(await s.request('GET',`/runs/${id}`)).json().run.error_code==='publication_interrupted');
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'approved');
  const inspection=(await s.request('GET',`/news/reports/${report.id}/publication`)).json();assert.equal(inspection.publications[0].status,'failed');
 }finally{await s.close();}
});
test('each template executes its ordered prompts from the repository definition',async()=>{
 const s=setup();try{
  const task=(await s.request('POST','/tasks',configuration)).json().task;
  const run=(await s.request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'template-order'})).json().run;
  for(let index=0;index<configuration.prompts.length;index++){
   await s.wait(()=>s.adapter.calls[index]);
   const input=s.adapter.calls[index].input;
   assert.equal(input.input,configuration.prompts[index]);
   assert.equal(!!input.outputSchema,index===configuration.prompts.length-1);
   assert.equal(input.threadId,index===0?undefined:'thread-0');
   assert.ok(input.developerInstructions.includes(configuration.topic));
   s.adapter.succeed(index,index===configuration.prompts.length-1?JSON.stringify(proposal):`Research ${index+1}`);
  }
  const result=await s.wait(async()=>{const detail=(await s.request('GET',`/runs/${run.id}`)).json();return detail.run.status==='succeeded'&&detail;});
  assert.equal(result.turns.length,configuration.prompts.length);
  assert.deepEqual(result.turns.map(turn=>turn.input_text),configuration.prompts);
  assert.deepEqual(result.turns.map(turn=>turn.mode),configuration.prompts.map((_,index)=>index===configuration.prompts.length-1?'finalize':'research'));
  assert.equal((await s.request('GET','/news/reports')).json().reports.length,1);
 }finally{await s.close();}
});
test('manual Prompt overrides are rejected and stopping a template final round adds no extra Turn',async()=>{
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
  for(const change of [{autoPublish:true},{templateId:'daily-headlines',templateVersion:1}])assert.equal(engine.updateTask(task.id,{...input,...change}).next_run_at,due);
  assert.notEqual(engine.updateTask(task.id,{...input,schedule:{kind:'interval',minutes:10}}).next_run_at,due);
  assert.equal(engine.updateTask(task.id,{...input,status:'paused'}).next_run_at,null);
  assert.ok(Date.parse(engine.updateTask(task.id,input).next_run_at)>Date.now());
 }finally{await engine.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
