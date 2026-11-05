import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
const title='Official model announcement for verification';
const proposal=(urls)=>JSON.stringify({title:'研究日报',items:urls.map(url=>({url,category:'ai',importance:2,factSummary:'来源宣布模型更新。',analysis:null,evidenceQuote:title}))});
async function setup(prompts=['研究']){
 const dir=mkdtempSync('/tmp/source-repair-'),adapter=new ControlledAdapter();let writes=0,active=0,peak=0;
 const headers={authorization:'Bearer fixture_token_0123456789_abcdefghijk'};
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:headers.authorization.slice(7),AI_NEWS_HUB_LOG_LEVEL:'silent',AI_NEWS_HUB_GITHUB_REPOSITORY:'fixture/archive',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:'fixture_github_secret_012345678901234'}),{adapter,newsFetcher:async url=>{
  active++;peak=Math.max(peak,active);await delay(2);active--;
  if(String(url).includes('/blocked'))return new Response('blocked',{status:403});
  if(String(url).endsWith('.pdf'))return new Response('pdf',{headers:{'content-type':'application/pdf'}});
  return new Response(`<html><head><title>${title}</title></head><body>${title}</body></html>`,{headers:{'content-type':'text/html'}});
 },githubAdapter:{async publish(){writes++;return{sha:'a'.repeat(40),committedAt:'2026-11-05T00:00:00Z'};}}});
 const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
 const wait=async(fn)=>{for(let i=0;i<300;i++){const v=await fn();if(v)return v;await delay(5);}throw Error('timeout');};
 const task=(await request('POST','/tasks',{name:'修复测试',topic:'研究',prompts,autoPublish:true,schedule:{kind:'manual'},timezone:'Asia/Shanghai'})).json().task;
 const run=(await request('POST',`/tasks/${task.id}/runs`,{idempotencyKey:'start'})).json().run;
 return{adapter,request,wait,run,task,get writes(){return writes;},get peak(){return peak;},async detail(){return(await request('GET',`/runs/${run.id}`)).json();},async close(){await app.close();rmSync(dir,{recursive:true,force:true});}};
}
test('collects all unavailable sources and repairs once in the same Thread before publication',async()=>{
 const s=await setup();try{
 await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'研究记录');await s.wait(()=>s.adapter.calls[1]);
 const bad=proposal(['https://example.com/blocked','https://example.com/file.pdf','https://example.com/good']);s.adapter.succeed(1,bad);await s.wait(()=>s.adapter.calls[2]);
 const prior=await s.detail();assert.equal(prior.sourceFailures.length,2);assert.equal(prior.turns[1].status,'failed');assert.equal(prior.turns[1].output_text,bad);assert.equal(prior.turns[2].idempotency_key,'source-repair');assert.equal(s.writes,0);
 assert.equal(s.adapter.calls[2].input.threadId,'thread-0');assert.match(s.adapter.calls[2].input.input,/blocked/);assert.match(s.adapter.calls[2].input.input,/file.pdf/);assert.equal(s.adapter.calls[2].input.webSearch,true);
 s.adapter.succeed(2,proposal(['https://example.com/replacement','https://example.com/good']));await s.wait(()=>s.writes===1);
 assert.equal((await s.detail()).run.status,'succeeded');assert.equal((await s.request('GET','/news/reports')).json().reports[0].status,'published');assert.ok(s.peak<=3);
 }finally{await s.close();}
});
test('failed repair is terminal and does not publish or loop',async()=>{
 const s=await setup();try{
 await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'研究');await s.wait(()=>s.adapter.calls[1]);s.adapter.succeed(1,proposal(['https://example.com/blocked']));await s.wait(()=>s.adapter.calls[2]);s.adapter.succeed(2,proposal(['https://example.com/blocked']));
 await s.wait(async()=>(await s.detail()).run.status==='failed');await delay(10);assert.equal(s.adapter.calls.length,3);assert.equal(s.writes,0);assert.equal((await s.request('GET','/news/reports')).json().reports.length,0);
 }finally{await s.close();}
});
test('cancelling source repair stops its Turn and never publishes',async()=>{
 const s=await setup();try{
 await s.wait(()=>s.adapter.calls[0]);s.adapter.succeed(0,'研究');await s.wait(()=>s.adapter.calls[1]);s.adapter.succeed(1,proposal(['https://example.com/blocked']));await s.wait(()=>s.adapter.calls[2]);await s.request('POST',`/tasks/${s.task.id}/stop`);
 await s.wait(async()=>(await s.detail()).run.status==='cancelled');assert.equal(s.writes,0);assert.equal(s.adapter.calls.length,3);
 }finally{await s.close();}
});
test('source repair never exceeds the twenty Turn budget',async()=>{
 const s=await setup(Array.from({length:19},(_,i)=>`研究 ${i}`));try{
 for(let i=0;i<19;i++){await s.wait(()=>s.adapter.calls[i]);s.adapter.succeed(i,'研究');}await s.wait(()=>s.adapter.calls[19]);s.adapter.succeed(19,proposal(['https://example.com/blocked']));
 await s.wait(async()=>(await s.detail()).run.status==='failed');await delay(10);assert.equal(s.adapter.calls.length,20);assert.equal(s.writes,0);
 }finally{await s.close();}
});
