import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
const token='test_only_0123456789_abcdefghijklmnop',headers={authorization:`Bearer ${token}`};
const configuration={topic:'AI',prompts:['Search'],autoPublish:false,schedule:{kind:'manual'},timezone:'Asia/Shanghai'};
function setup(){
 const dir=mkdtempSync('/tmp/overview-');
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:token,AI_NEWS_HUB_LOG_LEVEL:'silent'}),{now:()=>new Date('2026-11-06T03:00:00Z')});
 const db=new DatabaseSync(dir+'/news.db');
 const get=()=>app.inject({url:'/api/overview',headers});
 function task(id,kind='manual',status='active',deleted=null){db.prepare('INSERT INTO tasks(id,name,channel,prompt,configuration_json,status,deleted_at) VALUES (?,?,?,?,?,?,?)').run(id,id,'opensource','Search',JSON.stringify({...configuration,schedule:{kind}}),status,deleted);}
 function run(id,status,at,taskId='manual',managed=true){db.prepare('INSERT INTO task_runs(id,task_id,idempotency_key,status,created_at,configuration_json) VALUES (?,?,?,?,?,?)').run(id,taskId,id,status,at,managed?JSON.stringify(configuration):null);}
 return {app,db,get,task,run,async close(){await app.close();db.close();rmSync(dir,{recursive:true,force:true});}};
}
test('overview is authenticated and starts with seven empty Shanghai days',async()=>{
 const s=setup();try{
 assert.equal((await s.app.inject('/api/overview')).statusCode,401);
 const r=await s.get();assert.equal(r.statusCode,200);assert.equal(r.headers['cache-control'],'no-store');
 const d=r.json();assert.equal(d.timezone,'Asia/Shanghai');assert.equal(d.tasks.total,0);assert.equal(d.todayRuns,0);assert.equal(d.daily.length,7);assert.equal(d.daily[0].date,'2026-10-31');assert.equal(d.daily[6].date,'2026-11-06');assert.ok(d.daily.every(x=>x.total===0));assert.deepEqual(d.recentRuns,[]);
 }finally{await s.close();}
});
test('overview aggregates full history, Shanghai midnight, managed/deleted scope and separate report states',async()=>{
 const s=setup();try{
 s.task('manual');s.task('enabled','daily');s.task('paused','weekly','paused');s.task('deleted','manual','paused','2026-11-05T00:00:00Z');
 for(let i=0;i<105;i++)s.run('success-'+String(i).padStart(3,'0'),'succeeded','2026-11-06T00:00:00.000Z');
 s.run('prior','failed','2026-11-05T15:59:59.999Z');s.run('midnight','failed','2026-11-05T16:00:00.000Z');
 s.run('cancelled','cancelled','2026-11-06T01:00:00.000Z');s.run('interrupted','interrupted','2026-11-06T01:00:01.000Z');s.run('running','running','2026-11-06T02:00:00.000Z');s.run('queued','queued','2026-11-06T02:01:00.000Z');
 s.run('deleted-history','succeeded','2026-11-06T02:02:00.000Z','deleted');s.run('legacy','succeeded','2026-11-06T02:03:00.000Z','sample-connectivity',false);
 for(const [id,status] of [['pending','validated'],['approved','approved'],['published','published'],['publish-failed','validated']]){
 s.run(id,'succeeded','2026-11-06T02:04:00.000Z');s.db.prepare('INSERT INTO reports(id,run_id,report_date,channel,title,body_markdown,content_json,status) VALUES (?,?,?,?,?,?,?,?)').run('report-'+id,id,'2026-11-06',id,id,'body','{}',status);
 }
 s.db.prepare("UPDATE task_runs SET error_code='publication_disabled' WHERE id='publish-failed'").run();
 const d=(await s.get()).json();
 assert.deepEqual(d.tasks,{total:3,manual:1,scheduled:1,paused:1});assert.equal(d.todayRuns,115);assert.equal(d.running,1);assert.equal(d.queued,1);
 assert.equal(d.pendingReview,1);assert.equal(d.pendingPublish,1);assert.equal(d.publishFailed,1);assert.equal(d.recentFailures,4);
 assert.equal(d.daily[5].failed,1);assert.deepEqual(d.daily[6],{date:'2026-11-06',total:115,succeeded:110,failed:1,stopped:2,active:2});
 assert.equal(d.recentRuns.length,5);assert.ok(!d.recentRuns.some(x=>x.run.id==='legacy'));
 assert.ok(d.recentRuns.some(x=>x.task_deleted));
 }finally{await s.close();}
});
