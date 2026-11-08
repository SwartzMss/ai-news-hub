import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,statSync,rmSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {writeNetworkEnvironment} from '../scripts/configure-network.mjs';

test('copies only proxy settings, normalizes aliases and writes a private environment file',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hub-network-'));
 try {
  const path=join(dir,'network.env');
  writeNetworkEnvironment(path,{https_proxy:'http://user:pass@proxy.example:8080',http_proxy:'http://proxy.example:8080',no_proxy:'internal.example',AI_NEWS_HUB_ADMIN_TOKEN:'PRIVATE_ADMIN',GITHUB_TOKEN:'PRIVATE_GITHUB'});
  assert.equal(statSync(path).mode&0o777,0o600);
  const result=spawnSync(process.execPath,['--env-file='+path,'-e','console.log(JSON.stringify(process.env))'],{env:{},encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  const env=JSON.parse(result.stdout);
  assert.equal(env.HTTPS_PROXY,'http://user:pass@proxy.example:8080');
  assert.equal(env.https_proxy,env.HTTPS_PROXY);
  assert.equal(env.HTTP_PROXY,'http://proxy.example:8080');
  assert.equal(env.NO_PROXY,env.no_proxy);
  for(const host of ['internal.example','localhost','127.0.0.1','::1'])assert.ok(env.NO_PROXY.split(',').includes(host));
  assert.ok(!readFileSync(path,'utf8').includes('PRIVATE_'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('HTTP proxy fallback, special characters and repeated configuration stay usable',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hub-network-'));
 try {
  const path=join(dir,'network.env');
  writeNetworkEnvironment(path,{HTTP_PROXY:'http://proxy.example:8080',NO_PROXY:'x$y,z"w,back\\slash'});
  const result=spawnSync(process.execPath,['--env-file='+path,'-e','console.log(JSON.stringify(process.env))'],{env:{},encoding:'utf8'});
  const env=JSON.parse(result.stdout);
  assert.equal(env.HTTPS_PROXY,env.HTTP_PROXY);
  assert.ok(env.NO_PROXY.includes('x$y'));
  assert.ok(env.NO_PROXY.includes('z"w'));
  assert.ok(env.NO_PROXY.includes('back\\slash'));
  writeNetworkEnvironment(path,{HTTPS_PROXY:'http://new.example:8080'});
  assert.ok(!readFileSync(path,'utf8').includes('proxy.example'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('invalid input preserves existing configuration and symlink targets',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hub-network-'));
 try {
  const path=join(dir,'network.env');writeFileSync(path,'original',{mode:0o600});
  for(const source of [{},{HTTP_PROXY:'socks5://proxy.example:1080'},{HTTP_PROXY:'http://proxy.example\nGITHUB_TOKEN=secret'},{HTTP_PROXY:'invalid'},{HTTP_PROXY:'http://proxy.example:8080',NO_PROXY:'x\nEVIL=1'}]){
   assert.throws(()=>writeNetworkEnvironment(path,source));assert.equal(readFileSync(path,'utf8'),'original');
  }
  const link=join(dir,'link.env');symlinkSync(path,link);
  assert.throws(()=>writeNetworkEnvironment(link,{HTTP_PROXY:'http://proxy.example:8080'}));
  assert.equal(readFileSync(path,'utf8'),'original');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('CLI copies the caller environment without echoing proxy credentials',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hub-network-cli-'));
 try {
  const env={PATH:process.env.PATH,AI_NEWS_HUB_DATA_DIR:dir,HTTPS_PROXY:'http://user:PRIVATE_PROXY_CREDENTIAL@proxy.example:8080'};
  const result=spawnSync(process.execPath,['scripts/configure-network.mjs'],{env,encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
  assert.ok(!result.stdout.includes('PRIVATE_PROXY_CREDENTIAL'));
  assert.ok(!result.stderr.includes('PRIVATE_PROXY_CREDENTIAL'));
  assert.equal(statSync(join(dir,'network.env')).mode&0o777,0o600);
  assert.ok(readFileSync(join(dir,'network.env'),'utf8').includes('PRIVATE_PROXY_CREDENTIAL'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
