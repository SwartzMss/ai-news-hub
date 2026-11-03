import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {join} from 'node:path';
import type {DatabaseSync} from 'node:sqlite';
import type {RuntimeSettings,SettingsUpdate,SettingsView} from '../../../../packages/shared/src/settings.js';
import {legacyRuntimeConfig,type Config} from '../config.js';
import {AppError,HttpError} from '../errors.js';
import {privateFile} from './private-file.js';
import {settingsInput} from './schema.js';

type Row={revision:number;config_json:string;github_secret:string|null};
export class SettingsStore {
  private key:Buffer;
  constructor(private db:DatabaseSync,seed:Config) {
    const existing=db.prepare('SELECT * FROM app_settings WHERE id=1').get() as Row|undefined;
    const encoded=privateFile(join(seed.dataDir,'settings.key'),()=>randomBytes(32).toString('hex'),!!existing?.github_secret);
    if(!/^[a-f0-9]{64}$/.test(encoded))throw new AppError('settings_key_invalid');
    this.key=Buffer.from(encoded,'hex');
    if(!existing){
      const imported=legacyRuntimeConfig(seed.legacyEnv);
      const defaults:RuntimeSettings={logLevel:imported.logLevel,codex:{binary:imported.codexBin,model:imported.model??''},execution:{timeoutMs:imported.runTimeoutMs,concurrency:imported.concurrency,maxQueue:imported.maxQueue},github:{enabled:!!imported.publication,repository:imported.publication?.repository??'',branch:imported.publication?.branch??''}};
      db.prepare('INSERT INTO app_settings(id,revision,config_json,github_secret,updated_at) VALUES(1,1,?,?,?)').run(JSON.stringify(defaults),imported.publication?this.encrypt(imported.publication.token):null,new Date().toISOString());
    }
    // Fail startup on corrupt settings or the wrong encryption key.
    const current=this.view();settingsInput({revision:current.revision,logLevel:current.logLevel,codex:current.codex,execution:current.execution,github:{enabled:current.github.enabled,repository:current.github.repository,branch:current.github.branch}});
    if(this.row().github_secret)this.decrypt(this.row().github_secret!);
    this.publication();
  }
  private row():Row{return this.db.prepare('SELECT * FROM app_settings WHERE id=1').get() as Row;}
  runtime():RuntimeSettings{return JSON.parse(this.row().config_json) as RuntimeSettings;}
  view():SettingsView {const row=this.row(),settings=JSON.parse(row.config_json) as RuntimeSettings;return {...settings,revision:Number(row.revision),github:{...settings.github,tokenConfigured:!!row.github_secret}};}
  publication():{repository:string;branch:string;token:string}|undefined {
    const row=this.row(),settings=JSON.parse(row.config_json) as RuntimeSettings;
    if(!settings.github.enabled)return undefined;
    if(!row.github_secret || !settings.github.repository || !settings.github.branch)throw new AppError('invalid_publication_config');
    return {repository:settings.github.repository,branch:settings.github.branch,token:this.decrypt(row.github_secret)};
  }
  update(raw:unknown):SettingsView {
    const input:SettingsUpdate=settingsInput(raw),row=this.row();
    if(input.revision!==row.revision)throw new HttpError(409,'settings_changed');
    const secret=input.github.token?this.encrypt(input.github.token):input.github.clearToken?null:row.github_secret;
    if(input.github.enabled&&(!input.github.repository||!input.github.branch||!secret))throw new HttpError(400,'invalid_publication_config');
    const settings:RuntimeSettings={logLevel:input.logLevel,codex:input.codex,execution:input.execution,github:{enabled:input.github.enabled,repository:input.github.repository,branch:input.github.branch}};
    const result=this.db.prepare('UPDATE app_settings SET config_json=?,github_secret=?,revision=revision+1,updated_at=? WHERE id=1 AND revision=?').run(JSON.stringify(settings),secret,new Date().toISOString(),input.revision);
    if(!result.changes)throw new HttpError(409,'settings_changed');
    return this.view();
  }
  private encrypt(value:string):string {
    const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key,nonce);cipher.setAAD(Buffer.from('ai-news-hub:github-token:v1'));
    const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
    return ['v1',nonce.toString('base64'),cipher.getAuthTag().toString('base64'),ciphertext.toString('base64')].join('.');
  }
  private decrypt(value:string):string {
    try{const [version,nonce,tag,ciphertext,...extra]=value.split('.');if(version!=='v1'||extra.length)throw Error();
      const decipher=createDecipheriv('aes-256-gcm',this.key,Buffer.from(nonce,'base64'));decipher.setAAD(Buffer.from('ai-news-hub:github-token:v1'));decipher.setAuthTag(Buffer.from(tag,'base64'));
      return Buffer.concat([decipher.update(Buffer.from(ciphertext,'base64')),decipher.final()]).toString('utf8');
    }catch{throw new AppError('settings_secret_invalid');}
  }
}
