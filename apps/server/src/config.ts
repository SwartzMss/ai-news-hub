import {isAbsolute,normalize} from 'node:path';
import {AppError} from './errors.js';
export const LOG_LEVELS=['fatal','error','warn','info','debug','trace','silent'] as const;
export interface Config {
  host:'127.0.0.1'|'::1';port:number;dataDir:string;
  /** Used only when the corresponding database records do not exist. */
  legacyEnv?:NodeJS.ProcessEnv;
}
export interface LegacyRuntime {
  logLevel:(typeof LOG_LEVELS)[number];codexBin:string;model?:string;
  runTimeoutMs:number;concurrency:number;maxQueue:number;
  publication?:{repository:string;branch:string;token:string};
}
export function loadConfig(env:NodeJS.ProcessEnv=process.env):Config {
  const host=env.AI_NEWS_HUB_HOST??'127.0.0.1',port=env.AI_NEWS_HUB_PORT??'3000',dataDir=env.AI_NEWS_HUB_DATA_DIR??'/var/lib/ai-news-hub';
  if((host!=='127.0.0.1'&&host!=='::1')||!/^\d+$/.test(port)||Number(port)<1||Number(port)>65535||!isAbsolute(dataDir))throw new AppError('invalid_config');
  const legacyEnv=Object.fromEntries(Object.entries(env).filter(([key])=>key.startsWith('AI_NEWS_HUB_')&&!['AI_NEWS_HUB_HOST','AI_NEWS_HUB_PORT','AI_NEWS_HUB_DATA_DIR'].includes(key)));
  return {host,port:Number(port),dataDir:normalize(dataDir),legacyEnv};
}
export function legacyAdminToken(env:NodeJS.ProcessEnv={}):string|undefined {
  const token=env.AI_NEWS_HUB_ADMIN_TOKEN||undefined;
  if(token&&!/^[A-Za-z0-9_-]{32,256}$/.test(token))throw new AppError('invalid_config');
  return token;
}
export function legacyRuntimeConfig(env:NodeJS.ProcessEnv={}):LegacyRuntime {
  const logLevel=env.AI_NEWS_HUB_LOG_LEVEL??'info',codexBin=env.AI_NEWS_HUB_CODEX_BIN??'codex',model=env.AI_NEWS_HUB_MODEL||undefined;
  const numeric=(name:string,fallback:number,min:number,max:number)=>{const value=env[name]??String(fallback);if(!/^\d+$/.test(value)||Number(value)<min||Number(value)>max)throw new AppError('invalid_config');return Number(value);};
  if(!LOG_LEVELS.includes(logLevel as LegacyRuntime['logLevel'])||!codexBin||/\s|\0/.test(codexBin)||model&&(model.length>128||/[\r\n\0]/.test(model)))throw new AppError('invalid_config');
  const repository=env.AI_NEWS_HUB_GITHUB_REPOSITORY||undefined,branch=env.AI_NEWS_HUB_GITHUB_BRANCH||undefined,token=env.AI_NEWS_HUB_GITHUB_TOKEN||undefined;
  if(repository||branch||token){
    if(!repository||!branch||!token||!/^[/A-Za-z0-9_.-]+$/.test(repository)||!/^([A-Za-z0-9][A-Za-z0-9_.-]{0,99})\/([A-Za-z0-9][A-Za-z0-9_.-]{0,99})$/.test(repository)||!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch)||branch.includes('..')||branch.includes('//')||branch.endsWith('/')||branch.endsWith('.')||branch.split('/').some(x=>x.endsWith('.lock'))||!/^[A-Za-z0-9_]{20,255}$/.test(token))throw new AppError('invalid_publication_config');
  }
  return {logLevel:logLevel as LegacyRuntime['logLevel'],codexBin,model,runTimeoutMs:numeric('AI_NEWS_HUB_RUN_TIMEOUT_MS',600000,1000,3600000),concurrency:numeric('AI_NEWS_HUB_CONCURRENCY',1,1,4),maxQueue:numeric('AI_NEWS_HUB_MAX_QUEUE',20,1,100),publication:repository&&branch&&token?{repository,branch,token}:undefined};
}
