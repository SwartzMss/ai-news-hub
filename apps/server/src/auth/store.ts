import {createHash,randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
import {join} from 'node:path';
import {unlinkSync} from 'node:fs';
import type {DatabaseSync} from 'node:sqlite';
import type {AuthStatus} from '../../../../packages/shared/src/settings.js';
import {AppError,HttpError} from '../errors.js';
import {privateFile} from '../settings/private-file.js';

const derive=promisify(scrypt), digest=(value:string)=>createHash('sha256').update(value).digest('hex');
type Credentials={kind:'password'|'token';secret_hash:string;salt:string|null};
export class AuthStore {
  readonly setupPath:string;
  private setupHash?:string;
  private attempts=0;
  private failureWindow=Date.now();
  constructor(private db:DatabaseSync,dataDir:string,readLegacyToken?:()=>string|undefined) {
    this.setupPath=join(dataDir,'setup-code');
    if(!this.credentials()){
      const legacyToken=readLegacyToken?.();
      if(legacyToken)db.prepare("INSERT INTO admin_credentials(id,kind,secret_hash,updated_at) VALUES(1,'token',?,?)").run(digest(legacyToken),new Date().toISOString());
    }
    if(!this.credentials())this.setupHash=digest(privateFile(this.setupPath,()=>randomBytes(24).toString('hex')));
    db.prepare('DELETE FROM admin_sessions WHERE expires_at<=?').run(new Date().toISOString());
  }
  private credentials():Credentials|undefined{return this.db.prepare('SELECT * FROM admin_credentials WHERE id=1').get() as Credentials|undefined;}
  status():AuthStatus{const c=this.credentials();return {initialized:!!c,mode:c?.kind??'setup'};}
  authorize(token?:string):boolean {
    if(!token || !/^[A-Za-z0-9_-]{32,256}$/.test(token))return false;
    const hash=digest(token),c=this.credentials();
    if(c?.kind==='token'&&this.equal(hash,c.secret_hash))return true;
    return !!this.db.prepare('SELECT token_hash FROM admin_sessions WHERE token_hash=? AND expires_at>?').get(hash,new Date().toISOString());
  }
  private limit():void {if(Date.now()-this.failureWindow>=60000){this.attempts=0;this.failureWindow=Date.now();}if(this.attempts>=5)throw new HttpError(429,'auth_rate_limited');this.attempts++;}
  private equal(a:string,b:string):boolean{return a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));}
  private async matches(value:string,c:Credentials):Promise<boolean>{return c.kind==='token'?this.equal(digest(value),c.secret_hash):this.equal((await derive(value,c.salt!,64) as Buffer).toString('hex'),c.secret_hash);}
  private async password(value:string):Promise<{salt:string;hash:string}>{
    if(typeof value!=='string'||value.length<12||value.length>128)throw new HttpError(400,'invalid_password');
    const salt=randomBytes(16).toString('hex');return {salt,hash:(await derive(value,salt,64) as Buffer).toString('hex')};
  }
  private session():{token:string;expiresAt:string} {
    const token=randomBytes(32).toString('hex'),expiresAt=new Date(Date.now()+12*60*60*1000).toISOString();
    this.db.prepare('INSERT INTO admin_sessions(token_hash,expires_at,created_at) VALUES(?,?,?)').run(digest(token),expiresAt,new Date().toISOString());
    return {token,expiresAt};
  }
  async setup(code:string,password:string) {
    if(this.credentials())throw new HttpError(409,'admin_already_initialized');this.limit();
    if(!this.setupHash||!this.equal(digest(code),this.setupHash))throw new HttpError(401,'invalid_setup_code');
    const stored=await this.password(password);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.credentials())throw new HttpError(409,'admin_already_initialized');
      this.db.prepare("INSERT INTO admin_credentials(id,kind,secret_hash,salt,updated_at) VALUES(1,'password',?,?,?)").run(stored.hash,stored.salt,new Date().toISOString());
      const session=this.session();this.db.exec('COMMIT');this.setupHash=undefined;
      try{unlinkSync(this.setupPath);}catch{/* Code is invalidated by the committed credential even if cleanup fails. */}
      return session;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  async login(password:string) {
    const c=this.credentials();if(!c)throw new HttpError(503,'management_disabled');this.limit();
    if(!await this.matches(password,c))throw new HttpError(401,'unauthorized');
    // A concurrent password change must not authenticate a previously read hash.
    if(this.credentials()?.secret_hash!==c.secret_hash)throw new HttpError(401,'unauthorized');
    return this.session();
  }
  logout(token:string):void {this.db.prepare('DELETE FROM admin_sessions WHERE token_hash=?').run(digest(token));}
  async changePassword(currentPassword:string,newPassword:string) {
    const c=this.credentials();if(!c)throw new AppError('management_disabled');this.limit();
    if(!await this.matches(currentPassword,c))throw new HttpError(400,'incorrect_password');
    const stored=await this.password(newPassword);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(this.credentials()?.secret_hash!==c.secret_hash)throw new HttpError(409,'credential_changed');
      this.db.prepare("UPDATE admin_credentials SET kind='password',secret_hash=?,salt=?,updated_at=? WHERE id=1").run(stored.hash,stored.salt,new Date().toISOString());
      this.db.exec('DELETE FROM admin_sessions');const session=this.session();this.db.exec('COMMIT');return session;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
}
