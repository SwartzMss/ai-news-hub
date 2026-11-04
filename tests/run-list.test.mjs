import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
const token='test_only_0123456789_abcdefghijklmnop',headers={authorization:`Bearer ${token}`};
function setup(){
 const dir=mkdtempSync('/tmp/run-list-');
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:token,AI_NEWS_HUB_LOG_LEVEL:'silent'}));
 const db=new DatabaseSync(dir+'/news.db');
 const get=(query='')=>app.inject({url:'/api/runs'+query,headers});
 return {app,db,get,async close(){await app.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
const snapshot={topic:'AI',prompts:['Search'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
function fixture(db){
 db.prepare('INSERT INTO tasks(id,name,channel,prompt,deleted_at) VALUES (?,?,?,?,?)').run('deleted-task','已删除的任务','opensource','Search','2026-11-05T00:00:00Z');
 for(const [id,status] of [['a','succeeded'],['b','running'],['c','failed'],['d','succeeded'],['e','succeeded'],['f','succeeded']]){
  db.prepare('INSERT INTO task_runs(id,task_id,idempotency_key,status,created_at,configuration_json) VALUES (?,?,?,?,?,?)').run(id,id==='a'?'deleted-task':'sample-connectivity',id,status,'2026-11-04T00:00:00.000Z',JSON.stringify(snapshot));
  db.prepare('INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,status,mode,error_code) VALUES (?,?,1,?,?,?,?,?)').run('turn-'+id,id,id,'Search',status,'research',status==='failed'?'agent_failed':null);
 }
 db.prepare("INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,status,mode,error_code) VALUES ('turn-c-final','c',2,'final','Finalize','failed','finalize','report_schema_invalid')").run();
 for(const [id,status] of [['d','validated'],['e','approved'],['f','published']]){
  db.prepare('INSERT INTO reports(id,run_id,report_date,channel,title,body_markdown,content_json,status) VALUES (?,?,?,?,?,?,?,?)').run('report-'+id,id,'2026-11-04','channel-'+id,'Report '+id,'body','{}',status);
 }
 for(const [id,report,status,updated] of [['old-success','report-e','succeeded','2026-11-04T00:00:00Z'],['new-failure','report-e','failed','2026-11-05T00:00:00Z'],['published','report-f','succeeded','2026-11-05T00:00:00Z']]){
  db.prepare('INSERT INTO publication_records(id,report_id,target,idempotency_key,status,error_code,commit_sha,updated_at) VALUES (?,?,?,?,?,?,?,?)').run(id,report,'github',id,status,status==='failed'?'github_unavailable':null,status==='succeeded'?'a'.repeat(40):null,updated);
 }
}
test('authenticated cross-task Run history has deterministic bounded pagination and deleted task snapshots',async()=>{
 const s=setup();try{
  fixture(s.db);
  assert.equal((await s.app.inject('/api/runs')).statusCode,401);
  const response=await s.get('?limit=2&offset=0');assert.equal(response.statusCode,200);assert.equal(response.headers['cache-control'],'no-store');
  const first=response.json();assert.equal(first.total,6);assert.equal(first.limit,2);assert.equal(first.offset,0);assert.deepEqual(first.runs.map(x=>x.run.id),['f','e']);
  assert.equal(first.runs[1].publication.error_code,'github_unavailable');
  const second=(await s.get('?limit=2&offset=2')).json();assert.deepEqual(second.runs.map(x=>x.run.id),['d','c']);
  assert.deepEqual(second.runs[1].latest_turn,{sequence:2,mode:'finalize',status:'failed',error_code:'report_schema_invalid'});
  const deleted=(await s.get('?taskId=deleted-task')).json();assert.equal(deleted.total,1);assert.equal(deleted.runs[0].task_name,'已删除的任务');assert.equal(deleted.runs[0].task_deleted,true);assert.deepEqual(deleted.runs[0].run.configuration,snapshot);
  assert.equal((await s.get('?taskId=unknown')).json().total,0);assert.deepEqual((await s.get('?offset=100000')).json().runs,[]);
  for(const query of ['?limit=101','?limit=0','?offset=-1','?offset=100001','?state=unknown','?taskId=','?other=x'])assert.equal((await s.get(query)).statusCode,400,query);
 }finally{await s.close();}
});
test('state filters distinguish research failures, pending review, latest publish failure and publishing',async()=>{
 const s=setup();try{
  fixture(s.db);
  for(const [state,id] of [['running','b'],['failed','c'],['pending_review','d'],['publish_failed','e'],['published','f']]){
   const result=(await s.get('?state='+state)).json();assert.equal(result.total,1,state);assert.equal(result.runs[0].run.id,id);assert.equal(result.runs[0].state,state);
  }
  s.db.prepare("UPDATE publication_records SET status='publishing' WHERE id='new-failure'").run();
  assert.equal((await s.get('?state=running')).json().total,2);assert.equal((await s.get('?state=publish_failed')).json().total,0);
  s.db.prepare("UPDATE task_runs SET status='cancelled' WHERE id='a'").run();assert.equal((await s.get('?state=failed')).json().total,2);
 }finally{await s.close();}
});

test('automatic publish preflight errors without publication rows are publish failures, not pending review',async()=>{
 const s=setup();try{
  fixture(s.db);
  s.db.prepare("UPDATE task_runs SET error_code='publication_disabled' WHERE id='d'").run();
  const failed=(await s.get('?state=publish_failed')).json();assert.equal(failed.total,2);
  const preflight=failed.runs.find(row=>row.run.id==='d');assert.equal(preflight.state,'publish_failed');assert.equal(preflight.run.error_code,'publication_disabled');assert.equal(preflight.publication,null);assert.equal(preflight.report.status,'validated');
  assert.equal((await s.get('?state=pending_review')).json().total,0);
  // A failed research/finalization Run remains a research failure even if a report exists.
  s.db.prepare("UPDATE task_runs SET status='failed',error_code='report_schema_invalid' WHERE id='d'").run();
  assert.equal((await s.get('?state=publish_failed')).json().total,1);
  assert.equal((await s.get('?state=failed')).json().total,2);
 }finally{await s.close();}
});
