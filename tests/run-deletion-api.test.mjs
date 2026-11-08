import test from 'node:test';
import assert from 'node:assert/strict';
import {rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {publicationFixture} from './fixtures/publication.mjs';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
const token='test_only_0123456789_abcdefghijklmnop';
const headers={authorization:'Bearer '+token};
function setup(githubAdapter){
 const fixture=publicationFixture();const dir=fixture.db.prepare('PRAGMA database_list').get().file.replace(/\/news.db$/,'');fixture.db.close();
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:token,AI_NEWS_HUB_LOG_LEVEL:'silent',...(githubAdapter?{AI_NEWS_HUB_GITHUB_REPOSITORY:'owner/archive',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:token}:{})}),{githubAdapter});
 const request=(method,url,payload)=>app.inject({method,url:'/api'+url,headers,payload});
 return {app,dir,request,async close(){await app.close();rmSync(dir,{recursive:true,force:true});}};
}
test('run deletion is authenticated, confirmed, idempotent, and retains task configuration',async()=>{
 const s=setup();try{
  assert.equal((await s.app.inject({method:'DELETE',url:'/api/runs/run',payload:{confirm:true}})).statusCode,401);
  for(const payload of [{},{confirm:false}])assert.equal((await s.request('DELETE','/runs/run',payload)).statusCode,400);
  assert.equal((await s.request('GET','/runs/run')).statusCode,200);
  for(let i=0;i<2;i++)assert.equal((await s.request('DELETE','/runs/run',{confirm:true})).statusCode,200);
  assert.equal((await s.request('GET','/runs/run')).statusCode,404);
  assert.equal((await s.request('GET','/news/reports/r')).statusCode,404);
  assert.equal((await s.request('GET','/tasks/news-github')).statusCode,200);
 }finally{await s.close();}
});
test('active run deletion returns conflict and leaves history available',async()=>{
 const s=setup();const db=new DatabaseSync(s.dir+'/news.db');
 try{
  db.exec("UPDATE task_runs SET status='running'");
  const response=await s.request('DELETE','/runs/run',{confirm:true});
  assert.equal(response.statusCode,409);assert.equal(response.json().error.code,'run_busy');
  assert.equal((await s.request('GET','/runs/run')).statusCode,200);
 }finally{db.close();await s.close();}
});
test('remote deletion failure retains the execution and explicit retry removes its GitHub archive',async()=>{
 let attempts=0;
 const s=setup({async publish(){return {sha:'a'.repeat(40),committedAt:'2026-11-03T01:00:00Z'};},async remove(artifact,target){assert.equal(artifact.reportId,'r');assert.deepEqual(target,{repository:'owner/archive',branch:'reports'});if(++attempts===1)throw Error('private remote failure');}});
 try{
  const inspection=(await s.request('GET','/news/reports/r/publication')).json();
  assert.equal((await s.request('POST','/news/reports/r/approve',{confirm:true,contentHash:inspection.contentHash})).statusCode,200);
  assert.equal((await s.request('POST','/news/reports/r/publish',{})).statusCode,200);
  assert.equal((await s.request('DELETE','/runs/run',{confirm:true})).statusCode,502);
  assert.equal((await s.request('GET','/runs/run')).statusCode,200);
  assert.equal((await s.request('GET','/news/reports/r')).statusCode,200);
  assert.equal((await s.request('DELETE','/runs/run',{confirm:true})).statusCode,200);
  assert.equal((await s.request('GET','/runs/run')).statusCode,404);
  assert.equal(attempts,2);
 }finally{await s.close();}
});
