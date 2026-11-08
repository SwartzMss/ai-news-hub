import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync,symlinkSync,copyFileSync} from 'node:fs';
import {tmpdir,userInfo} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderService,installService,validateExecutables} from '../scripts/install-service.mjs';

function fixture(){
 const dir=mkdtempSync(join(tmpdir(),'hub-service-'));
 const repo=join(dir,'news hub % edition');mkdirSync(repo);mkdirSync(join(repo,'logs'),{mode:0o700});
 const unitDir=join(dir,'units');mkdirSync(unitDir);
 const nodeDir=join(dir,'node-bin'),codexDir=join(dir,'codex-bin');mkdirSync(nodeDir);mkdirSync(codexDir);
 for(const [base,name] of [[nodeDir,'node'],[codexDir,'codex']])writeFileSync(join(base,name),'#!/bin/sh\nexit 0\n',{mode:0o700});
 const plan={user:userInfo().username,group:'test-group',uid:process.getuid(),gid:process.getgid(),home:'/srv/news-service',repo,node:join(nodeDir,'node'),codex:join(codexDir,'codex'),codexHome:join(dir,'.codex'),envFile:join(dir,'private.env'),logDir:join(repo,'logs')};
 const calls=[];
 const run=(cmd,args)=>{calls.push({cmd,args});return Buffer.from(cmd.endsWith('runuser')&&args.includes('--version')?'v22.19.0\n':'');};
 return {dir,unitDir,plan,calls,run,close:()=>rmSync(dir,{recursive:true,force:true})};
}

test('system unit renders portable paths, private environment references and non-root identity',()=>{
 const f=fixture();try{
  const unit=renderService(f.plan);
  assert.ok(unit.includes('WorkingDirectory='+f.plan.repo.replaceAll('%','%%')));
  assert.ok(unit.includes('EnvironmentFile="'+f.plan.envFile+'"'));
  assert.match(unit,/WantedBy=multi-user.target/);assert.match(unit,/Restart=on-failure/);
  assert.ok(unit.includes('User='+f.plan.user));assert.ok(unit.includes('CODEX_HOME='+f.plan.codexHome));
  assert.ok(unit.includes('--no-env-file'));assert.ok(unit.includes('--log-dir'));
  assert.ok(!unit.includes('/home/swartz'));assert.ok(!unit.includes('API_KEY='));
  for(const change of [{repo:'/tmp/x\nExecStart=/bin/false'},{home:'/tmp/x\u0000y'},{node:'node'},{user:'root',uid:0},{node:'/tmp/colon:bin/node'},{node:'/tmp/node22'},{codex:'/tmp/codex-custom'}])assert.throws(()=>renderService({...f.plan,...change}));
 }finally{f.close();}
});

test('installer enables next-boot startup without starting or killing the running backend',()=>{
 const f=fixture();try{
  const installed=installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>0});
  assert.equal(readFileSync(installed,'utf8'),renderService(f.plan));
  const commands=f.calls.filter(c=>c.cmd.endsWith('systemctl')).map(c=>c.args);
  assert.deepEqual(commands,[['daemon-reload'],['enable','ai-news-hub.service']]);
  assert.ok(f.calls.some(c=>c.cmd.endsWith('systemd-analyze')&&c.args[0]==='verify'));
  assert.ok(!f.calls.some(c=>c.args.includes('start')||c.args.includes('restart')||c.args.includes('--now')));
  const initialCalls=f.calls.length;
  assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>0}),/already exists/);
  assert.equal(f.calls.length,initialCalls);
  installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>0,replace:true});
 }finally{f.close();}
});

test('non-root installation and failed verification do not write a unit or enable a service',()=>{
 const f=fixture();try{
  assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>1000}),/sudo/);
  assert.equal(f.calls.length,0);
  const failedRun=(cmd,args)=>{if(cmd.endsWith('systemd-analyze'))throw Error('unit verify failed');return f.run(cmd,args);};
  assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run:failedRun,getuid:()=>0}),/unit verify failed/);
  assert.equal(existsSync(join(f.unitDir,'ai-news-hub.service')),false);
  assert.ok(!f.calls.some(c=>c.cmd.endsWith('systemctl')));
 }finally{f.close();}
});


test('CLI dry-run prints a portable unit without exposing environment secrets or installing it',()=>{
 const f=fixture();try{
  writeFileSync(f.plan.codex,'#!/bin/sh\nexit 0\n',{mode:0o700});
  writeFileSync(f.plan.envFile,'RESEND_API_KEY=PRIVATE_TEST_VALUE\n',{mode:0o600});
  const result=spawnSync(process.execPath,['scripts/install-service.mjs','--dry-run','--user',userInfo().username,'--node',f.plan.node,'--codex',f.plan.codex,'--env-file',f.plan.envFile],{encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/WantedBy=multi-user.target/);
  assert.ok(result.stdout.includes(f.plan.envFile));assert.ok(!result.stdout.includes('PRIVATE_TEST_VALUE'));
  assert.equal(existsSync(join(f.unitDir,'ai-news-hub.service')),false);
 }finally{f.close();}
});


test('installer refuses existing dangling unit links without explicit replacement',()=>{
 const f=fixture();try{
  symlinkSync(join(f.dir,'missing.service'),join(f.unitDir,'ai-news-hub.service'));
  assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>0}),/already exists/);
  assert.equal(f.calls.length,0);
 }finally{f.close();}
});


test('installer rejects a different Codex shadowing the explicitly selected binary',()=>{
 const f=fixture();try{
  validateExecutables(f.plan);
  writeFileSync(join(f.dir,'node-bin/codex'),'#!/bin/sh\nexit 0\n',{mode:0o700});
  assert.throws(()=>validateExecutables(f.plan),/shadowed/);
  assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run:f.run,getuid:()=>0}),/shadowed/);
  assert.equal(f.calls.length,0);
 }finally{f.close();}
});

test('systemd command failures explain that the installed unit remains on disk',()=>{
 for(const failedCommand of ['daemon-reload','enable']){
  const f=fixture();try{
   const run=(cmd,args)=>{if(cmd.endsWith('systemctl')&&args[0]===failedCommand)throw Error('mock systemd failure');return f.run(cmd,args);};
   assert.throws(()=>installService(f.plan,{unitDir:f.unitDir,run,getuid:()=>0}),/Unit remains installed.*reload\/enable failed/);
   assert.equal(readFileSync(join(f.unitDir,'ai-news-hub.service'),'utf8'),renderService(f.plan));
  }finally{f.close();}
 }
});
test('system unit references the private network file separately without embedding its values',()=>{
 const f=fixture();try{
  const path=join(f.dir,'network.env');writeFileSync(path,"HTTPS_PROXY='http://user:PRIVATE_PROXY_CREDENTIAL@proxy.example:8080'\n",{mode:0o600});
  const unit=renderService({...f.plan,extraEnvFile:path});
  assert.ok(unit.includes('EnvironmentFile="'+f.plan.envFile+'"\nEnvironmentFile="'+path+'"'));
  assert.ok(!unit.includes('PRIVATE_PROXY_CREDENTIAL'));
  assert.ok(!unit.includes('proxy.example'));
 }finally{f.close();}
});

test('CLI detects a project network.env by default and permits an explicit override',()=>{
 const f=fixture();try{
  for(const path of ['scripts','dist/apps/server/src','dist/admin'])mkdirSync(join(f.plan.repo,path),{recursive:true});
  copyFileSync('scripts/install-service.mjs',join(f.plan.repo,'scripts/install-service.mjs'));
  writeFileSync(join(f.plan.repo,'dist/apps/server/src/main.js'),'fixture');
  writeFileSync(join(f.plan.repo,'dist/admin/index.html'),'fixture');
  writeFileSync(join(f.plan.repo,'.env'),'AI_NEWS_HUB_PORT=3000\n',{mode:0o600});
  const network=join(f.plan.repo,'network.env');
  const args=[join(f.plan.repo,'scripts/install-service.mjs'),'--dry-run','--user',userInfo().username,'--node',f.plan.node,'--codex',f.plan.codex];
  const before=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(before.status,0,before.stderr);assert.ok(!before.stdout.includes(network.replaceAll('%','%%')));
  writeFileSync(network,'HTTPS_PROXY=http://example.invalid:8080\n',{mode:0o600});
  const after=spawnSync(process.execPath,args,{encoding:'utf8'});assert.equal(after.status,0,after.stderr);assert.ok(after.stdout.includes('EnvironmentFile="'+network.replaceAll('%','%%')+'"'));assert.ok(!after.stdout.includes('example.invalid'));
  const other=join(f.dir,'other.env');writeFileSync(other,'NO_PROXY=localhost\n',{mode:0o600});
  const overridden=spawnSync(process.execPath,[...args,'--extra-env-file',other],{encoding:'utf8'});assert.equal(overridden.status,0,overridden.stderr);assert.ok(overridden.stdout.includes('EnvironmentFile="'+other+'"'));assert.ok(!overridden.stdout.includes(network.replaceAll('%','%%')));
 }finally{f.close();}
});
