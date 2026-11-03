import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {buildServer} from '../dist/apps/server/src/app.js';
import {loadConfig} from '../dist/apps/server/src/config.js';
import {ControlledAdapter} from './fixtures/controlled-adapter.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const password='local-test-password-123';
const legacyToken='test_only_0123456789_abcdefghijklmnop';
function fixture(extra={}) {
 const dir=mkdtempSync('/tmp/news-settings-'); const config=loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_LOG_LEVEL:'silent',...extra});
 const adapter=new ControlledAdapter();let app=buildServer(config,{adapter});
 return {dir,adapter,get app(){return app;},async restart(env={}){await app.close();app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_LOG_LEVEL:'silent',...env}),{adapter});},async close(){await app.close();rmSync(dir,{recursive:true,force:true});}};
}
const auth=token=>({authorization:'Bearer '+token});
const post=(f,url,payload,token)=>f.app.inject({method:'POST',url:'/api'+url,headers:token?auth(token):{},payload});
const get=(f,url,token)=>f.app.inject({url:'/api'+url,headers:token?auth(token):{}});
const save=(f,body,token)=>f.app.inject({method:'PUT',url:'/api/settings',headers:auth(token),payload:body});
async function initialize(f) {
 const code=readFileSync(join(f.dir,'setup-code'),'utf8').trim();
 const r=await post(f,'/auth/setup',{code,password});assert.equal(r.statusCode,201,r.body);return r.json().token;
}
test('minimal env bootstraps once, protects settings, and password/session lifecycle persists without env credentials',async()=>{
 const f=fixture();try{
  const status=await get(f,'/auth/status');assert.equal(status.statusCode,200);assert.deepEqual(status.json(),{initialized:false,mode:'setup'});
  assert.equal((await get(f,'/settings')).statusCode,503);
  assert.equal(statSync(join(f.dir,'setup-code')).mode&0o777,0o600);
  assert.equal((await post(f,'/auth/setup',{code:'wrong',password})).statusCode,401);
  const token=await initialize(f);assert.equal((await get(f,'/tasks',token)).statusCode,200);
  assert.equal((await get(f,'/settings')).statusCode,401);
  assert.equal((await post(f,'/auth/setup',{code:'anything',password})).statusCode,409);
  assert.equal((await post(f,'/auth/login',{password:'wrong-password'})).statusCode,401);
  await f.restart();
  assert.deepEqual((await get(f,'/auth/status')).json(),{initialized:true,mode:'password'});
  const login=await post(f,'/auth/login',{password});assert.equal(login.statusCode,200);const second=login.json().token;
  const rotated=await post(f,'/auth/password',{currentPassword:password,newPassword:'replacement-password-456'},second);assert.equal(rotated.statusCode,200);
  assert.equal((await get(f,'/tasks',token)).statusCode,401);assert.equal((await get(f,'/tasks',second)).statusCode,401);
  const current=rotated.json().token;assert.equal((await get(f,'/tasks',current)).statusCode,200);
  assert.equal((await post(f,'/auth/logout',{},current)).statusCode,200);assert.equal((await get(f,'/tasks',current)).statusCode,401);
 }finally{await f.close();}
});
test('Web settings validate and persist, redact/encrypt secrets, and use optimistic revision + explicit secret keep/clear',async()=>{
 const f=fixture();try{
  const token=await initialize(f), initial=(await get(f,'/settings',token)).json();
  assert.equal(initial.github.enabled,false);assert.equal(initial.github.tokenConfigured,false);
  const secret='fixture_github_secret_0123456789';
  const body={revision:initial.revision,logLevel:'silent',codex:{binary:'codex',model:'test-model'},execution:{timeoutMs:90000,concurrency:2,maxQueue:5},github:{enabled:true,repository:'fixture/archive',branch:'reports',token:secret}};
  const written=await save(f,body,token);assert.equal(written.statusCode,200,written.body);assert.ok(!written.body.includes(secret));assert.equal(written.json().github.tokenConfigured,true);
  const db=new DatabaseSync(join(f.dir,'news.db'));const stored=db.prepare('SELECT * FROM app_settings').get();assert.ok(!JSON.stringify(stored).includes(secret));db.close();
  assert.equal(statSync(join(f.dir,'settings.key')).mode&0o777,0o600);
  assert.equal((await save(f,body,token)).statusCode,409);
  await f.restart({AI_NEWS_HUB_MODEL:'env_must_not_override_db',AI_NEWS_HUB_CONCURRENCY:'obsolete',AI_NEWS_HUB_GITHUB_REPOSITORY:'only/leftover',AI_NEWS_HUB_ADMIN_TOKEN:'invalid_old_value'});
  const login=(await post(f,'/auth/login',{password})).json().token;
  const persisted=(await get(f,'/settings',login)).json();assert.equal(persisted.codex.model,'test-model');assert.equal(persisted.github.repository,'fixture/archive');
  const next={...body,revision:persisted.revision,github:{...body.github}};delete next.github.token;
  const kept=await save(f,next,login);assert.equal(kept.statusCode,200);assert.equal(kept.json().github.tokenConfigured,true);
  const invalid={...next,revision:kept.json().revision,execution:{...next.execution,concurrency:0}};assert.equal((await save(f,invalid,login)).statusCode,400);
  const cleared=await save(f,{...next,revision:kept.json().revision,github:{enabled:false,repository:'',branch:'',clearToken:true}},login);assert.equal(cleared.statusCode,200);assert.equal(cleared.json().github.tokenConfigured,false);
 }finally{await f.close();}
});
test('legacy env imports once and idle runtime settings apply to new Turns without restart',async()=>{
 const f=fixture({AI_NEWS_HUB_ADMIN_TOKEN:legacyToken,AI_NEWS_HUB_MODEL:'legacy-model'});try{
  assert.deepEqual((await get(f,'/auth/status')).json(),{initialized:true,mode:'token'});
  const settings=(await get(f,'/settings',legacyToken)).json();assert.equal(settings.codex.model,'legacy-model');
  const body={revision:settings.revision,logLevel:'silent',codex:{binary:'codex',model:'web-model'},execution:{timeoutMs:80000,concurrency:1,maxQueue:10},github:{enabled:false,repository:'',branch:''}};
  assert.equal((await save(f,body,legacyToken)).statusCode,200);
  const r=await post(f,'/tasks/sample-connectivity/runs',{idempotencyKey:'runtime-check'},legacyToken);assert.equal(r.statusCode,202);
  for(let i=0;i<30&&!f.adapter.calls.length;i++)await delay(5);
  assert.equal(f.adapter.calls[0].input.model,'web-model');assert.equal(f.adapter.calls[0].input.timeoutMs,80000);
  assert.equal((await save(f,{...body,revision:settings.revision+1},legacyToken)).statusCode,409);
  f.adapter.succeed(0);await delay(10);
  await f.restart({AI_NEWS_HUB_ADMIN_TOKEN:legacyToken,AI_NEWS_HUB_MODEL:'legacy-must-not-win'});
  assert.equal((await get(f,'/settings',legacyToken)).json().codex.model,'web-model');
 }finally{await f.close();}
});
test('auth bootstrap/login reject foreign browser origins and DNS-rebinding Host names',async()=>{
 const f=fixture();try{
  for(const headers of [{host:'evil.example'},{host:'localhost:3000',origin:'https://evil.example'}]){
   const r=await f.app.inject({method:'POST',url:'/api/auth/setup',headers,payload:{code:readFileSync(join(f.dir,'setup-code'),'utf8').trim(),password}});assert.equal(r.statusCode,403);
  }
  assert.equal((await get(f,'/auth/status')).json().initialized,false);
 }finally{await f.close();}
});
test('legacy credential cannot return after migration to password, and expired sessions are rejected',async()=>{
 const f=fixture({AI_NEWS_HUB_ADMIN_TOKEN:legacyToken});try{
  const rotated=await post(f,'/auth/password',{currentPassword:legacyToken,newPassword:password},legacyToken);assert.equal(rotated.statusCode,200);
  await f.restart({AI_NEWS_HUB_ADMIN_TOKEN:legacyToken});assert.equal((await get(f,'/tasks',legacyToken)).statusCode,401);
  const session=(await post(f,'/auth/login',{password})).json().token;
  const db=new DatabaseSync(join(f.dir,'news.db'));db.prepare("UPDATE admin_sessions SET expires_at='2000-01-01T00:00:00.000Z'").run();db.close();
  assert.equal((await get(f,'/tasks',session)).statusCode,401);
 }finally{await f.close();}
});
test('parallel password attempts are rate limited before expensive derivation',async()=>{
 const f=fixture();try{
  await initialize(f);
  const results=await Promise.all(Array.from({length:10},()=>post(f,'/auth/login',{password:'wrong-password-123'})));
  assert.ok(results.filter(r=>r.statusCode===429).length>=6);assert.ok(results.every(r=>[401,429].includes(r.statusCode)));
 }finally{await f.close();}
});
test('missing encryption key fails startup without discarding settings or silently regenerating a key',async()=>{
 const f=fixture();try{
  const token=await initialize(f),v=(await get(f,'/settings',token)).json();
  const body={revision:v.revision,logLevel:v.logLevel,codex:v.codex,execution:v.execution,github:{enabled:true,repository:'fixture/archive',branch:'reports',token:'fixture_secret_012345678901234'}};
  assert.equal((await save(f,body,token)).statusCode,200);
  await f.app.close();const {unlinkSync,existsSync}=await import('node:fs');unlinkSync(join(f.dir,'settings.key'));
  assert.throws(()=>buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:f.dir})),{code:'settings_key_missing'});assert.equal(existsSync(join(f.dir,'settings.key')),false);
 }finally{await f.close();}
});
test('changing GitHub destination through settings creates a separate publication identity',async()=>{
 const {publicationFixture}=await import('./fixtures/publication.mjs');const original=publicationFixture();const dir=original.db.prepare('PRAGMA database_list').get().file.replace(/\/news.db$/,'');original.db.close();let writes=0;
 const app=buildServer(loadConfig({AI_NEWS_HUB_DATA_DIR:dir,AI_NEWS_HUB_ADMIN_TOKEN:legacyToken,AI_NEWS_HUB_LOG_LEVEL:'silent',AI_NEWS_HUB_GITHUB_REPOSITORY:'owner/first',AI_NEWS_HUB_GITHUB_BRANCH:'reports',AI_NEWS_HUB_GITHUB_TOKEN:legacyToken}),{githubAdapter:{async publish(){writes++;return {sha:'a'.repeat(40),committedAt:'2026-11-03T00:00:00Z'};}}});const f={app};
 try{
  const status=(await get(f,'/news/reports/r/publication',legacyToken)).json();assert.equal((await post(f,'/news/reports/r/approve',{confirm:true,contentHash:status.contentHash},legacyToken)).statusCode,200);
  assert.equal((await post(f,'/news/reports/r/publish',{},legacyToken)).statusCode,200);
  const v=(await get(f,'/settings',legacyToken)).json();assert.equal((await save(f,{revision:v.revision,logLevel:v.logLevel,codex:v.codex,execution:v.execution,github:{enabled:true,repository:'owner/second',branch:'new-reports'}},legacyToken)).statusCode,200);
  assert.equal((await post(f,'/news/reports/r/publish',{},legacyToken)).statusCode,200);assert.equal(writes,2);
  const publications=(await get(f,'/news/reports/r/publication',legacyToken)).json().publications;assert.deepEqual(new Set(publications.map(p=>p.repository)),new Set(['owner/first','owner/second']));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
