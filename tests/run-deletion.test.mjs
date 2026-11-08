import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskEngine} from '../dist/apps/server/src/tasks/engine.js';
import {PublicationService} from '../dist/apps/server/src/publish/service.js';
import {publicationFixture} from './fixtures/publication.mjs';
const target={repository:'owner/archive',branch:'reports'};
function setup(adapter){
 const s=publicationFixture();
 const engine=new TaskEngine(s.db,{adapter:{async execute(){throw Error('unexpected execution');}},cwd:'/tmp',concurrency:1,maxQueue:20,timeoutMs:1000});
 const publications=new PublicationService(s.db,adapter?target:undefined,adapter);
 s.db.exec("INSERT INTO run_threads(run_id,thread_id) VALUES ('run','thread'); INSERT INTO run_turns(id,run_id,sequence,idempotency_key,input_text,thread_id,status) VALUES ('turn','run',1,'turn','prompt','thread','failed'); INSERT INTO run_events(run_id,turn_record_id,kind,data_json) VALUES ('run','turn','finished','{}');");
 return {...s,engine,publications,remove:()=>engine.deleteRun('run',id=>publications.remove(id)),async close(){await engine.close();await publications.close();s.close();}};
}
test('deleting a failed run removes its history and snapshots while preserving its task',async()=>{
 const s=setup();try{
  await s.publications.remove('r');
  s.db.exec("UPDATE task_runs SET status='failed'; INSERT INTO codex_news_runs(run_id,topic,initial_input,report_date,channel) VALUES ('run','topic','prompt','2026-11-03','opensource');");
  const task=s.db.prepare("SELECT * FROM tasks WHERE id='news-github'").get();
  await s.remove();
  for(const table of ['task_runs','run_turns','run_threads','run_events','news_runs','codex_news_runs'])assert.equal(s.db.prepare(`SELECT count(*) n FROM ${table}`).get().n,0,table);
  assert.deepEqual(s.db.prepare("SELECT * FROM tasks WHERE id='news-github'").get(),task);
  assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await s.close();}
});
test('remote failure keeps the run and report, and retry deletes both once',async()=>{
 let calls=0;
 const s=setup({async publish(){return {sha:'a'.repeat(40),committedAt:'2026-11-03T01:00:00Z'};},async remove(){if(++calls===1)throw Error('private remote error');}});
 try{
  s.publications.approve('r',s.publications.inspect('r').contentHash);await s.publications.publish('r');
  await assert.rejects(s.remove(),/github_unavailable/);
  assert.ok(s.db.prepare("SELECT id FROM task_runs WHERE id='run'").get());assert.ok(s.db.prepare("SELECT id FROM reports WHERE id='r'").get());
  await s.remove();await s.remove();
  assert.equal(calls,2);assert.equal(s.db.prepare('SELECT count(*) n FROM reports').get().n,0);assert.equal(s.db.prepare('SELECT count(*) n FROM task_runs').get().n,0);
  assert.equal(s.db.prepare('SELECT version FROM report_deletions').get().version,1);
 }finally{await s.close();}
});
test('queued, running and waiting runs reject deletion before touching any reports',async()=>{
 const s=setup();try{
  for(const status of ['queued','running','waiting_approval']){
   s.db.prepare('UPDATE task_runs SET status=?').run(status);
   await assert.rejects(s.remove(),/run_busy/);
   assert.ok(s.db.prepare("SELECT id FROM reports WHERE id='r'").get());
  }
  s.db.exec("UPDATE task_runs SET status='failed'");
 }finally{await s.close();}
});
test('concurrent deletion shares the operation and blocks continuing the same run',async()=>{
 let release,started;
 const ready=new Promise(resolve=>{started=resolve;});let calls=0;
 const s=setup({async publish(){throw Error('unexpected publish');},async remove(){calls++;started();await new Promise(resolve=>{release=resolve;});}});
 try{
  // A failed publication may have committed remotely, so its recorded target must also be removed.
  s.db.prepare("INSERT INTO publication_records(id,report_id,target,idempotency_key,status,repository,branch,artifact_path,content_hash) VALUES ('p','r','github','p','failed',?,?,?,?)").run(target.repository,target.branch,'reports/2026/11/03/opensource/v000001.json','a'.repeat(64));
  const first=s.remove();await ready;
  assert.equal(s.engine.busy(),true);
  assert.throws(()=>s.engine.continueRun('run','followup','next'),/run_deleting/);
  const second=s.remove();assert.equal(first,second);release();await Promise.all([first,second]);assert.equal(calls,1);
 }finally{await s.close();}
});
test('local cleanup failure rolls back run history and can retry after remote removal',async()=>{
 const s=setup();try{
  s.db.exec("CREATE TRIGGER refuse_run_delete BEFORE DELETE ON task_runs BEGIN SELECT RAISE(ABORT,'cleanup blocked'); END;");
  await assert.rejects(s.remove(),/cleanup blocked/);
  assert.equal(s.db.prepare('SELECT count(*) n FROM reports').get().n,0);
  assert.equal(s.db.prepare('SELECT count(*) n FROM run_turns').get().n,1);
  assert.equal(s.db.prepare('SELECT count(*) n FROM news_runs').get().n,1);
  s.db.exec('DROP TRIGGER refuse_run_delete');await s.remove();
  assert.equal(s.db.prepare('SELECT count(*) n FROM task_runs').get().n,0);
  assert.equal(s.db.prepare('PRAGMA foreign_key_check').all().length,0);
 }finally{await s.close();}
});
test('shutdown interrupts remote deletion and waits before releasing database work',async()=>{
 let started;
 const ready=new Promise(resolve=>{started=resolve;});
 const s=setup({async publish(){throw Error('unexpected publish');},async remove(_artifact,_target,signal){started();await new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}});
 try{
  s.db.prepare("INSERT INTO publication_records(id,report_id,target,idempotency_key,status,repository,branch,artifact_path,content_hash) VALUES ('p','r','github','p','failed',?,?,?,?)").run(target.repository,target.branch,'reports/2026/11/03/opensource/v000001.json','a'.repeat(64));
  const deletion=s.remove();await ready;
  s.publications.interrupt();const closing=s.engine.close();
  await assert.rejects(deletion,/publication_interrupted/);await closing;
  assert.ok(s.db.prepare("SELECT id FROM task_runs WHERE id='run'").get());
  assert.ok(s.db.prepare("SELECT id FROM reports WHERE id='r'").get());
  assert.equal(s.db.prepare('SELECT status FROM report_deletions').get().status,'failed');
 }finally{await s.close();}
});
