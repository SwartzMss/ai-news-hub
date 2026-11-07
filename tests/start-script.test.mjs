import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,statSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'hub-start-'));
 for(const dir of ['scripts','bin','dist/apps/server/src'])mkdirSync(join(root,dir),{recursive:true});
 copyFileSync('scripts/start.sh',join(root,'scripts/start.sh'));
 writeFileSync(join(root,'dist/apps/server/src/main.js'),'fixture');
 writeFileSync(join(root,'bin/node'),'#!/bin/bash\nprintf "arg:%s\\n" "$@"\necho stdout-marker\necho stderr-marker >&2\nexit 7\n',{mode:0o700});
 return {root,run(args=[]){return spawnSync('/bin/bash',[join(root,'scripts/start.sh'),...args],{cwd:'/',env:{...process.env,PATH:join(root,'bin')+':'+process.env.PATH},encoding:'utf8'});},close(){rmSync(root,{recursive:true,force:true});}};
}
test('startup creates private project logs from another working directory and preserves exit status',()=>{
 const f=fixture();try{
  const first=f.run();assert.equal(first.status,7);assert.equal(first.stdout,'');
  const path=join(f.root,'logs/backend.log'),text=readFileSync(path,'utf8');
  assert.match(text,/arg:--env-file-if-exists=\.env/);assert.match(text,/stdout-marker/);assert.match(text,/stderr-marker/);
  assert.equal(statSync(path).mode&0o777,0o600);
  assert.equal(f.run().status,7);assert.equal(readFileSync(path,'utf8'),text+text);
 }finally{f.close();}
});
test('startup supports custom relative log directories with spaces and systemd environment mode',()=>{
 const f=fixture();try{
  assert.equal(f.run(['--log-dir','custom logs','--no-env-file']).status,7);
  const text=readFileSync(join(f.root,'custom logs/backend.log'),'utf8');
  assert.doesNotMatch(text,/env-file/);assert.match(text,/arg:dist\/apps\/server\/src\/main.js/);
 }finally{f.close();}
});
test('startup rejects incomplete or unknown options and reports missing builds before starting Node',()=>{
 const f=fixture();try{
  assert.equal(f.run(['--log-dir']).status,2);assert.equal(f.run(['--unknown']).status,2);
  rmSync(join(f.root,'dist'),{recursive:true});const result=f.run();assert.equal(result.status,1);assert.match(result.stderr,/build missing/);
 }finally{f.close();}
});
