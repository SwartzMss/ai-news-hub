import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {openDatabase} from '../dist/apps/server/src/db/database.js';
import {NewsletterScheduler} from '../dist/apps/server/src/newsletter/scheduler.js';
import {NewsletterGatewayError} from '../dist/apps/server/src/newsletter/github.js';

const token='test_only_0123456789_abcdefghijklmnop';
const headers={authorization:`Bearer ${token}`};
test('newsletter has an independent authenticated schedule and manual dispatch record',async()=>{
  const dir=mkdtempSync('/tmp/newsletter-scheduler-');
  let at=new Date('2026-11-10T00:59:00Z');
  let scheduler;
  const calls=[];
  const gateway={
    async dispatch(request){calls.push(request);return {workflowRunId:123,runUrl:'https://api.github.com/repos/SwartzMss/ai-news-hub/actions/runs/123',htmlUrl:'https://github.com/SwartzMss/ai-news-hub/actions/runs/123'};},
    async getRun(){return {status:'completed',conclusion:'success'};},
    async findRun(){return null;},
  };
  const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:token}),{now:()=>at,newsletterGateway:gateway,onNewsletterScheduler:value=>{scheduler=value;}});
  const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
  try{
    assert.equal((await app.inject('/api/newsletter')).statusCode,401);
    const before=await request('GET','/newsletter');
    assert.equal(before.statusCode,200);
    assert.equal(before.json().schedule.enabled,false);
    const enabled=await request('PUT','/newsletter/schedule',{enabled:true});
    assert.equal(enabled.statusCode,200);
    assert.equal(enabled.json().schedule.next_run_at,'2026-11-10T01:00:00.000Z');
    const manual=await request('POST','/newsletter/dispatch',{});
    assert.equal(manual.statusCode,202);
    assert.equal(manual.json().dispatch.trigger_reason,'manual');
    assert.equal(calls.length,1);
    assert.equal(calls[0].triggerReason,'manual');
    assert.equal(calls[0].ref,'main');
    at=new Date('2026-11-10T01:00:00Z');
    await scheduler.tick(at);
    await scheduler.tick(at);
    assert.equal(calls.filter(x=>x.triggerReason==='scheduled').length,1);
    assert.equal((await request('GET','/newsletter')).json().dispatches.length,2);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
test('scheduler advances Shanghai slots once, records missed slots, and pauses without replay',async()=>{
  const dir=mkdtempSync('/tmp/newsletter-slots-'),db=openDatabase(dir),calls=[];
  const gateway={async dispatch(input){calls.push(input);return {workflowRunId:calls.length,runUrl:`https://api.github.com/runs/${calls.length}`,htmlUrl:`https://github.com/runs/${calls.length}`};},async getRun(){return {status:'completed',conclusion:'success'};},async findRun(){return null;}};
  const scheduler=new NewsletterScheduler(db,gateway,()=>new Date('2026-11-10T00:59:00Z'));
  try{
    scheduler.configure(true,new Date('2026-11-10T00:59:00Z'));
    await scheduler.tick(new Date('2026-11-10T01:00:00Z'));
    await scheduler.tick(new Date('2026-11-10T01:00:00Z'));
    assert.equal(calls.length,1);
    assert.equal(calls[0].dispatchId,'newsletter-20261110-0900');
    assert.equal(calls[0].scheduledAt,'2026-11-10T09:00:00+08:00');
    assert.equal(scheduler.state().dispatches[0].status,'succeeded');
    await scheduler.tick(new Date('2026-11-10T01:26:00Z'));
    assert.equal(calls.length,1);
    assert.equal(scheduler.record('newsletter-20261110-0915').status,'failed');
    assert.equal(scheduler.record('newsletter-20261110-0915').error_code,'schedule_missed');
    scheduler.configure(false,new Date('2026-11-10T01:26:00Z'));
    await scheduler.tick(new Date('2026-11-10T01:30:00Z'));
    assert.equal(calls.length,1);
    assert.equal(scheduler.configure(true,new Date('2026-11-10T01:30:00Z')).next_run_at,'2026-11-11T01:00:00.000Z');
  }finally{await scheduler.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('uncertain dispatch never blindly repeats and reconciles by dispatch ID after restart',async()=>{
  const dir=mkdtempSync('/tmp/newsletter-uncertain-'),db=openDatabase(dir);
  let calls=0,matched=false;
  const gateway={async dispatch(){calls++;throw new NewsletterGatewayError('github_timeout',false);},async getRun(){return {status:'completed',conclusion:'success'};},async findRun(id){return matched?{workflowRunId:456,runUrl:'https://api.github.com/runs/456',htmlUrl:'https://github.com/runs/456'}:null;}};
  let scheduler=new NewsletterScheduler(db,gateway,()=>new Date('2026-11-10T00:59:00Z'));
  try{
    const first=await scheduler.manual(new Date('2026-11-10T00:59:00Z'));
    assert.equal(first.status,'dispatch_unknown');
    await scheduler.tick(new Date('2026-11-10T01:00:00Z'));
    assert.equal(calls,1);
    await scheduler.close();
    scheduler=new NewsletterScheduler(db,gateway,()=>new Date('2026-11-10T01:01:00Z'));
    matched=true;
    await scheduler.tick(new Date('2026-11-10T01:01:00Z'));
    assert.equal(scheduler.record(first.dispatch_id).workflow_run_id,456);
    await scheduler.tick(new Date('2026-11-10T01:01:01Z'));
    assert.equal(scheduler.record(first.dispatch_id).status,'succeeded');
    assert.equal(calls,1);
  }finally{await scheduler.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
test('manual dispatch shares concurrency guard and rate limit with scheduled work',async()=>{
  const dir=mkdtempSync('/tmp/newsletter-manual-'),db=openDatabase(dir);
  let id=788;
  const gateway={async dispatch(){id++;return {workflowRunId:id,runUrl:`https://api.github.com/runs/${id}`,htmlUrl:`https://github.com/runs/${id}`};},async getRun(){return {status:'completed',conclusion:'failure'};},async findRun(){return null;}};
  const scheduler=new NewsletterScheduler(db,gateway,()=>new Date('2026-11-10T00:00:00Z'));
  try{
    const first=await scheduler.manual(new Date('2026-11-10T00:00:00Z'));
    await assert.rejects(scheduler.manual(new Date('2026-11-10T00:00:01Z')),{code:'newsletter_busy'});
    await scheduler.tick(new Date('2026-11-10T00:00:30Z'));
    assert.equal(scheduler.record(first.dispatch_id).status,'failed');
    await assert.rejects(scheduler.manual(new Date('2026-11-10T00:01:00Z')),{code:'newsletter_rate_limited'});
    const second=await scheduler.manual(new Date('2026-11-10T00:06:00Z'));
    assert.equal(second.status,'queued');
  }finally{await scheduler.close();db.close();rmSync(dir,{recursive:true,force:true});}
});
