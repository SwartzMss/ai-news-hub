#!/usr/bin/env node
import {accessSync,constants,readFileSync,lstatSync,statSync,realpathSync,mkdirSync,mkdtempSync,writeFileSync,renameSync,rmSync,chownSync,chmodSync} from 'node:fs';
import {basename,dirname,join,isAbsolute,resolve} from 'node:path';
import {tmpdir,userInfo} from 'node:os';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';

const serviceName='ai-news-hub.service';
function pathExists(path){try{lstatSync(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
const scriptPath=fileURLToPath(import.meta.url);
const help=`Install the Linux system service and enable startup on the next boot.

Usage: sudo /absolute/path/to/node scripts/install-service.mjs --user USER --codex /absolute/path/to/codex

Options:
  --user USER             Existing non-root service account (default: sudo caller)
  --node PATH             Node.js 22 executable named node (default: this Node executable)
  --codex PATH            Codex executable named codex (default: search current PATH)
  --env-file PATH         systemd environment file (default: project .env)
  --extra-env-file PATH   Additional private environment file (default: project network.env when present)
  --codex-home PATH       Codex login/config directory (default: account HOME/.codex)
  --log-dir PATH          Backend logs directory (default: project logs/)
  --dry-run               Print the unit without installing or enabling anything
  --replace               Replace an existing unit; does not restart it
  --help                  Show this help

Installation never starts, stops or restarts an existing backend. Stop any manual
backend before using systemctl start. Existing SQLite and Codex login data are reused.
`;
function pathValue(value){
 if(typeof value!=='string'||!isAbsolute(value)||/[\x00-\x1f\x7f]/.test(value))throw Error('Service paths must be absolute and contain no control characters');
 if(/[\\"]/.test(value)||value!==value.trim())throw Error('Service paths cannot contain quotes, backslashes or trailing whitespace');
 return value;
}
function quote(value,exec=false){
 const safe=pathValue(value).replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"');
 return '"'+(exec?safe.replaceAll('$','$$'):safe)+'"';
}
export function renderService(plan){
 if(!/^[A-Za-z_][A-Za-z0-9_-]*\$?$/.test(plan.user)||!/^[A-Za-z_][A-Za-z0-9_-]*\$?$/.test(plan.group)||plan.user==='root'||plan.uid===0)throw Error('Use an existing non-root service account');
 if(basename(plan.node)!=='node'||basename(plan.codex)!=='codex')throw Error('Executable names must be node and codex; custom Codex paths belong in the website settings');
 for(const key of ['home','repo','node','codex','codexHome','envFile','logDir'])pathValue(plan[key]);
 if(plan.extraEnvFile)pathValue(plan.extraEnvFile);
 if([plan.envFile,plan.extraEnvFile].filter(Boolean).some(path=>/[?*\[\]]/.test(path)))throw Error('Environment file paths cannot contain wildcard characters');
 const bins=[...new Set([dirname(plan.node),dirname(plan.codex),'/usr/local/bin','/usr/bin','/bin'])];
 if(bins.some(path=>path.includes(':')))throw Error('Executable directories cannot contain a PATH separator');
 const env=(name,value)=>'Environment="'+name+'='+value.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
 return `[Unit]
Description=AI News Hub Backend
Wants=network-online.target
After=network-online.target
StartLimitIntervalSec=60
StartLimitBurst=3

[Service]
Type=exec
User=${plan.user}
Group=${plan.group}
WorkingDirectory=${plan.repo.replaceAll('%','%%')}
${env('NODE_ENV','production')}
${env('HOME',plan.home)}
${env('CODEX_HOME',plan.codexHome)}
${env('PATH',bins.join(':'))}
EnvironmentFile=${quote(plan.envFile)}
${plan.extraEnvFile?'EnvironmentFile='+quote(plan.extraEnvFile)+'\n':''}ExecStart=/usr/bin/bash ${quote(join(plan.repo,'scripts/start.sh'),true)} --no-env-file --log-dir ${quote(plan.logDir,true)}
Restart=on-failure
RestartSec=5
KillMode=control-group
TimeoutStopSec=15
UMask=0077
NoNewPrivileges=true
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
`;
}

export function validateExecutables(plan){
 const bins=[...new Set([dirname(plan.node),dirname(plan.codex),'/usr/local/bin','/usr/bin','/bin'])];
 for(const name of ['node','codex']){
  const selected=plan[name];accessSync(selected,constants.X_OK);
  const actual=bins.map(dir=>join(dir,name)).find(path=>{try{accessSync(path,constants.X_OK);return statSync(path).isFile();}catch{return false;}});
  if(!actual||realpathSync(actual)!==realpathSync(selected))throw Error('Selected '+name+' is shadowed on the service PATH; select the matching executable or set an absolute Codex binary in website settings');
 }
}

/** unitDir/run/getuid are injectable only for isolated installer tests. */
export function installService(plan,{unitDir='/etc/systemd/system',run=execFileSync,getuid=()=>process.getuid(),replace=false}={}){
 if(getuid()!==0)throw Error('Installing a system service requires sudo');
 const target=join(unitDir,serviceName),unit=renderService(plan);
 if(pathExists(target)&&!replace)throw Error('Service unit already exists; inspect it first, then use --replace to update');
 validateExecutables(plan);
 const temp=mkdtempSync(join(tmpdir(),'ai-news-hub-unit-'));
 try{
  const source=join(temp,serviceName);writeFileSync(source,unit,{mode:0o600});
  const nodeVersion=run('/usr/sbin/runuser',['-u',plan.user,'--',plan.node,'--version'],{encoding:'utf8'}).toString().trim();
  if(!/^v22\.(?:\d+)\.\d+$/.test(nodeVersion)||Number(nodeVersion.split('.')[1])<19)throw Error('Service account requires Node.js 22.19.0 or newer 22.x');
  for(const [flag,path] of [['-x',plan.codex],['-r',join(plan.repo,'dist/apps/server/src/main.js')],['-r',join(plan.repo,'dist/admin/index.html')],['-r',join(plan.repo,'scripts/start.sh')],['-r',plan.codexHome],['-w',plan.codexHome],['-x',plan.codexHome]])run('/usr/sbin/runuser',['-u',plan.user,'--','/usr/bin/test',flag,path],{stdio:'pipe'});
  run('/usr/bin/systemd-analyze',['verify',source],{stdio:'inherit'});
  if(pathExists(plan.logDir)){
   const info=lstatSync(plan.logDir);
   if(!info.isDirectory()||info.uid!==plan.uid||(info.mode&0o077)!==0)throw Error('Existing log directory must belong to the service account, have mode 0700 and cannot be a symlink');
  }else{mkdirSync(plan.logDir,{recursive:true,mode:0o700});chownSync(plan.logDir,plan.uid,plan.gid);}
  run('/usr/sbin/runuser',['-u',plan.user,'--','/usr/bin/test','-w',plan.logDir],{stdio:'pipe'});
  const staged=join(unitDir,'.ai-news-hub-'+process.pid+'.tmp');
  try{writeFileSync(staged,unit,{flag:'wx',mode:0o644});chmodSync(staged,0o644);renameSync(staged,target);}finally{rmSync(staged,{force:true});}
  try{
   run('/usr/bin/systemctl',['daemon-reload'],{stdio:'inherit'});
   run('/usr/bin/systemctl',['enable',serviceName],{stdio:'inherit'});
  }catch(error){throw Error('Unit remains installed at '+target+' but systemd reload/enable failed; inspect systemctl status and rerun with --replace after resolving the error',{cause:error});}
  return target;
 }finally{rmSync(temp,{recursive:true,force:true});}
}

function findCodex(){
 for(const dir of (process.env.PATH??'').split(':')){if(!dir)continue;const path=resolve(dir,'codex');try{accessSync(path,constants.X_OK);return path;}catch{}}
 throw Error('Codex not found; pass --codex /absolute/path/to/codex');
}
function main(){
 if(process.platform!=='linux')throw Error('The system service installer requires Linux');
 const {values}=parseArgs({options:{user:{type:'string'},node:{type:'string'},codex:{type:'string'},'env-file':{type:'string'},'extra-env-file':{type:'string'},'codex-home':{type:'string'},'log-dir':{type:'string'},'dry-run':{type:'boolean'},replace:{type:'boolean'},help:{type:'boolean'}}});
 if(values.help){console.log(help);return;}
 const user=values.user??process.env.SUDO_USER??userInfo().username;
 const fields=execFileSync('/usr/bin/getent',['passwd',user],{encoding:'utf8'}).trim().split(':');
 if(fields.length!==7||fields[0]!==user)throw Error('Service account does not exist');
 const group=execFileSync('/usr/bin/id',['-gn',user],{encoding:'utf8'}).trim();
 const repo=resolve(dirname(scriptPath),'..'),home=fields[5];
 const networkEnvFile=join(repo,'network.env');
 const extraEnvFile=values['extra-env-file']??(pathExists(networkEnvFile)?networkEnvFile:undefined);
 const plan={user,group,uid:Number(fields[2]),gid:Number(fields[3]),home,repo,node:values.node??process.execPath,codex:values.codex??findCodex(),codexHome:values['codex-home']??join(home,'.codex'),envFile:values['env-file']??join(repo,'.env'),extraEnvFile,logDir:values['log-dir']??join(repo,'logs')};
 const unit=renderService(plan);
 validateExecutables(plan);
 for(const path of [plan.node,plan.codex]){accessSync(path,constants.X_OK);if(!statSync(path).isFile())throw Error('Node and Codex must be executable files');}
 for(const path of [plan.envFile,...(plan.extraEnvFile?[plan.extraEnvFile]:[]),join(repo,'dist/apps/server/src/main.js'),join(repo,'dist/admin/index.html')]){if(!statSync(path).isFile())throw Error('Environment files and production builds must exist before installation');}
 if(values['dry-run']){process.stdout.write(unit);return;}
 if(readFileSync('/proc/1/comm','utf8').trim()!=='systemd')throw Error('systemd must be the system service manager');
 const target=installService(plan,{replace:values.replace});
 console.log('Installed '+target+' and enabled startup on the next boot.');
 console.log('Current backend processes were left running. After stopping a manual instance, use: sudo systemctl start '+serviceName);
 console.log('Logs: '+join(plan.logDir,'backend.log'));
}
if(process.argv[1]&&resolve(process.argv[1])===scriptPath){try{main();}catch(error){console.error('Service installation failed: '+(error instanceof Error?error.message:'unknown error'));process.exitCode=1;}}
