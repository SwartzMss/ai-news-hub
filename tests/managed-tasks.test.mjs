import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
import {nextOccurrence} from '../dist/apps/server/src/tasks/configuration.js';
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
  s.adapter.succeed(1,'second');await s.wait(()=>s.adapter.calls[2]);assert.equal(s.adapter.calls[2].input.threadId,'thread-0');assert.ok(s.adapter.calls[2].input.outputSchema);
  s.adapter.succeed(2,JSON.stringify(proposal));await s.wait(async()=>{const r=(await s.request('GET',`/runs/${id}`)).json();if(r.run.status==='failed')throw Error(JSON.stringify(r));return r.run.status==='succeeded'&&r.turns.length===3;});
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'validated');
  assert.equal((await s.request('DELETE',`/tasks/${task.id}`)).statusCode,204);
  assert.ok(!(await s.request('GET','/tasks')).json().tasks.some(t=>t.id===task.id));
  assert.equal((await s.request('GET',`/runs/${id}`)).statusCode,200);
 }finally{await s.close();}
});
test('stop prevents subsequent rounds; invalid plans are rejected',async()=>{
 const s=setup();try{
  for(const bad of [{schedule:{kind:'toString'}},{schedule:{kind:'__proto__'}},{schedule:{kind:42}},{prompts:[]},{timezone:'bad/timezone'},{schedule:{kind:'interval',minutes:0}},{schedule:{kind:'weekly',time:'25:00',weekday:8}}])assert.equal((await s.request('POST','/tasks',{...configuration,...bad})).statusCode,400);
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
  await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'research');await s.wait(()=>s.adapter.calls[1]);s.adapter.succeed(1,JSON.stringify(proposal));
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
  const payload={...configuration,prompts:Array.from({length:19},()=> '新'.repeat(8000))};
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
  await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'research');await s.wait(()=>s.adapter.calls[1]);s.adapter.succeed(1,JSON.stringify(proposal));
  await s.wait(()=>resolvePublish);assert.equal((await s.request('GET',`/tasks/${task.id}/runs`)).json().runs[0].publishing,true);
  await s.request('POST',`/tasks/${task.id}/stop`);resolvePublish({sha:'a'.repeat(40),committedAt:'2026-11-04T00:00:00Z'});
  await s.wait(async()=>(await s.request('GET',`/runs/${id}`)).json().run.error_code==='publication_interrupted');
  const report=(await s.request('GET','/news/reports')).json().reports[0];assert.equal(report.status,'approved');
  const inspection=(await s.request('GET',`/news/reports/${report.id}/publication`)).json();assert.equal(inspection.publications[0].status,'failed');
 }finally{await s.close();}
});
