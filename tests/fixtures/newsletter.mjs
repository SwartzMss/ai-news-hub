import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
export function fixture() {
  const db=new DatabaseSync(':memory:');db.exec('PRAGMA foreign_keys=ON');db.exec(readFileSync(new URL('../../newsletter/migrations/0001.sql',import.meta.url),'utf8'));
  let queries=0;
  class Statement {
    constructor(sql,params=[]){this.sql=sql;this.params=params;}
    bind(...params){return new Statement(this.sql,params);}
    execute(){queries++;const result=db.prepare(this.sql).run(...this.params);return {meta:{changes:Number(result.changes)}};}
    async run(){return this.execute();}
    async first(){queries++;return db.prepare(this.sql).get(...this.params)??null;}
    async all(){queries++;return {results:db.prepare(this.sql).all(...this.params)};}
  }
  const adapter={prepare(sql){return new Statement(sql);},async batch(statements){db.exec('BEGIN');try{const results=statements.map(s=>s.execute());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}};
  const env={NEWSLETTER_ENABLED:'1',NEWSLETTER_DB:adapter,SITE_URL:'https://news.example',NEWSLETTER_FROM:'AI News Hub <news@mail.example.com>',RESEND_API_KEY:'re_test_not_a_real_api_key',NEWSLETTER_TOKEN_SECRET:'test-signing-key-'.repeat(4),NEWSLETTER_SEND_SECRET:'test-cron-secret-'.repeat(4)};
  return {db,env,get queryCount(){return queries;},context(path,options={}){
    const method=options.method??'POST',headers=new Headers({origin:env.SITE_URL,accept:'application/json',...(method==='GET'?{}:{'content-type':'application/json'})});
    new Headers(options.headers).forEach((value,key)=>headers.set(key,value));
    const body=method==='GET'||method==='HEAD'?undefined:typeof options.body==='string'?options.body:JSON.stringify(options.body??{});
    return {env,pause:options.pause??(async()=>{}),request:new Request(new URL(path.startsWith('/')||path.startsWith('https:')?path:'/api/newsletter/'+path,env.SITE_URL),{method,headers,...(body===undefined?{}:{body})}),now:options.now??(()=>new Date('2026-11-07T01:30:00Z')),...(options.fetcher?{fetcher:options.fetcher}:{})};
  },close(){db.close();}};
}
