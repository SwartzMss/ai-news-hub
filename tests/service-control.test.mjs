import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,copyFileSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
function fixture(state='loaded'){
 const dir=mkdtempSync(join(tmpdir(),'hub-control-')),repo=join(dir,'repo space'),bin=join(dir,'bin');
 mkdirSync(join(repo,'scripts'),{recursive:true});mkdirSync(bin);
 copyFileSync('scripts/service.sh',join(repo,'scripts/service.sh'));
 const log=join(dir,'calls'),stateFile=join(dir,'state');writeFileSync(stateFile,state);
 const mocks={
 systemctl:`#!/bin/bash
printf 'systemctl' >> "$CONTROL_LOG"; printf ' <%s>' "$@" >> "$CONTROL_LOG"; echo >> "$CONTROL_LOG"
if [[ "$1" == show ]]; then
 if [[ "$*" == *LoadState* ]]; then cat "$CONTROL_STATE"; else echo "\${CONTROL_FRAGMENT:-/etc/systemd/system/ai-news-hub.service}"; fi
fi
if [[ -n "\${CONTROL_FAIL:-}" && "$1" == "$CONTROL_FAIL" ]]; then exit 1; fi
`,
 sudo:'#!/bin/bash\nprintf "sudo" >> "$CONTROL_LOG"; printf " <%s>" "$@" >> "$CONTROL_LOG"; echo >> "$CONTROL_LOG"\nexec "$@"\n',
 node:'#!/bin/bash\nprintf "node" >> "$CONTROL_LOG"; printf " <%s>" "$@" >> "$CONTROL_LOG"; echo >> "$CONTROL_LOG"\nif [[ "${CONTROL_FAIL:-}" == install ]]; then exit 1; fi\n',
 codex:'#!/bin/bash\nexit 0\n',
 rm:'#!/bin/bash\nprintf "remove" >> "$CONTROL_LOG"; printf " <%s>" "$@" >> "$CONTROL_LOG"; echo >> "$CONTROL_LOG"\n',
 };
 for(const [name,body] of Object.entries(mocks))writeFileSync(join(bin,name),body,{mode:0o700});
 return {dir,repo,bin,run(action,extra={}){return spawnSync('/bin/bash',[join(repo,'scripts/service.sh'),action],{cwd:'/',env:{...process.env,PATH:bin+':/usr/bin:/bin',CONTROL_LOG:log,CONTROL_STATE:stateFile,...extra},encoding:'utf8'});},calls(){return existsSync(log)?readFileSync(log,'utf8'):'';},close(){rmSync(dir,{recursive:true,force:true});}};
}
test('start checks installed units and uses systemctl without reinstalling them',()=>{
 const f=fixture();try{const r=f.run('start');assert.equal(r.status,0,r.stderr);assert.match(f.calls(),/LoadState/);assert.match(f.calls(),/systemctl <start> <ai-news-hub.service>/);assert.doesNotMatch(f.calls(),/install-service/);}finally{f.close();}
});
test('missing services install with caller Node and Codex paths before start',()=>{
 const f=fixture('not-found');try{const r=f.run('start');assert.equal(r.status,0,r.stderr);const log=f.calls();assert.match(log,/install-service.mjs/);assert.ok(log.includes('<--codex> <'+join(f.bin,'codex')+'>'));assert.ok(log.indexOf('install-service.mjs')<log.indexOf('systemctl <start>'));}finally{f.close();}
});
test('failed installation never starts the service and masked units are not overwritten',()=>{
 const f=fixture('not-found');try{assert.equal(f.run('start',{CONTROL_FAIL:'install'}).status,1);assert.doesNotMatch(f.calls(),/systemctl <start>/);}finally{f.close();}
 const m=fixture('masked');try{m.run('start',{CONTROL_FAIL:'start'});assert.doesNotMatch(m.calls(),/install-service/);}finally{m.close();}
});
test('uninstall stops, disables and removes only the managed system unit before reload',()=>{
 const f=fixture();try{const r=f.run('uninstall');assert.equal(r.status,0,r.stderr);const log=f.calls();const stop=log.indexOf('systemctl <stop>'),disable=log.indexOf('systemctl <disable>'),remove=log.indexOf('remove <--force> <-->' );assert.ok(stop>=0&&disable>stop&&remove>disable);assert.match(log,/remove <--force> <--> <\/etc\/systemd\/system\/ai-news-hub.service>/);assert.ok(log.indexOf('systemctl <daemon-reload>')>remove);assert.doesNotMatch(log,/news.db|network.env|settings.key/);}finally{f.close();}
});
test('uninstall is idempotent and aborts before removing the unit when stopping fails',()=>{
 const f=fixture('not-found');try{assert.equal(f.run('uninstall').status,0);assert.doesNotMatch(f.calls(),/remove|systemctl <stop>|systemctl <disable>/);}finally{f.close();}
 const failed=fixture();try{assert.equal(failed.run('uninstall',{CONTROL_FAIL:'stop'}).status,1);assert.doesNotMatch(failed.calls(),/remove|systemctl <disable>/);}finally{failed.close();}
});

test('restart installs missing services and systemd query errors abort mutations',()=>{
 const f=fixture('not-found');try{assert.equal(f.run('restart').status,0);assert.match(f.calls(),/install-service.mjs/);assert.match(f.calls(),/systemctl <restart>/);}finally{f.close();}
 const failed=fixture();try{assert.equal(failed.run('start',{CONTROL_FAIL:'show'}).status,1);assert.doesNotMatch(failed.calls(),/install-service|systemctl <start>/);}finally{failed.close();}
});
test('uninstall refuses external unit paths and preserves units when disabling fails',()=>{
 const f=fixture();try{assert.equal(f.run('uninstall',{CONTROL_FRAGMENT:'/usr/lib/systemd/system/ai-news-hub.service'}).status,1);assert.doesNotMatch(f.calls(),/remove|systemctl <stop>/);}finally{f.close();}
 const failed=fixture();try{assert.equal(failed.run('uninstall',{CONTROL_FAIL:'disable'}).status,1);assert.doesNotMatch(failed.calls(),/remove|daemon-reload/);}finally{failed.close();}
});
