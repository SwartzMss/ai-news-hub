import test from 'node:test';
import assert from 'node:assert/strict';
import {sendDigest} from '../dist/newsletter/digest.js';
import {fixture} from './fixtures/newsletter.mjs';

const day='2026-11-07';
const ids=[1,2,3].map(n=>'t-'+String(n).repeat(24));
function index() {
  const topics=ids.map((id,i)=>({id,name:'主题 '+i,reportCount:1,latest:{topic:{id,name:'主题 '+i},report_date:day,approved_at:day+'T01:00:00Z',collected_at:day+'T00:00:00Z',items:[{key:String(i+1).repeat(32),id:'item-'+i,fact_summary:'A & B <script> "fact"',analysis:'<img onerror=alert(1)>',evidence_quote:'Quoted <b>source</b>',source:{name:'官方 <source>',published_at:null,event_at:day+'T00:00:00Z',fetched_at:day+'T00:00:00Z'}}]}}));
  return {schema_version:1,demo:false,topics,reports:topics.map(t=>t.latest),articles:topics.flatMap(t=>t.latest.items)};
}
function subscribe(f,status='active') {
  const id=crypto.randomUUID();f.db.prepare('INSERT INTO newsletter_subscribers(id,email,status,created_at,updated_at) VALUES(?,?,?,?,?)').run(id,id+'@example.com',status,0,0);return id;
}
function context(f,fetcher,options={}) {return f.context('send',{headers:{authorization:'Bearer '+f.env.NEWSLETTER_SEND_SECRET},fetcher,...options});}
const stats=response=>response.json();

test('digest authorizes before DB or network and validates body',async()=>{
  const f=fixture();try{
    f.env.NEWSLETTER_DB={prepare(){throw Error('DB must not be touched');}};
    const result=await sendDigest(f.context('send',{fetcher:()=>{throw Error('network must not be touched');}}));assert.equal(result.status,401);
    const bad=await sendDigest(context(f,()=>{throw Error();},{body:'x'.repeat(2049)}));assert.equal(bad.status,413);
    assert.equal((await sendDigest(context(f,()=>{throw Error();},{body:{day:'2000-01-01'}}))).status,400);
  }finally{f.close();}
});

test('waits for every topic on Shanghai date; rejects demo and unsafe public data',async()=>{
  const f=fixture();try{
    subscribe(f);f.env.NEWSLETTER_TOPIC_IDS=ids.join(',');let data=index(),requests=0;
    const fetcher=async url=>{assert.equal(url,'https://news.example/data/index.json');requests++;return Response.json(data);};
    data.topics[2].latest.report_date='2026-11-06';assert.equal((await stats(await sendDigest(context(f,fetcher)))).waiting,true);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_deliveries').get().n,0);
    data=index();data.topics.pop();assert.equal((await stats(await sendDigest(context(f,fetcher)))).waiting,true);
    for(const mutate of [d=>d.demo=true,d=>d.topics[0].id='../bad',d=>d.topics[0].latest.report_date='2026-11-08',d=>d.topics[0].latest.items[0].key='../bad',d=>d.topics[0].latest.approved_at='2099-01-01T00:00:00Z']){
      data=index();mutate(data);assert.equal((await sendDigest(context(f,fetcher))).status,502);
    }
    assert.equal(requests,7);
  }finally{f.close();}
});

test('one escaped aggregate, publication metadata, signed one-click optout and no response PII',async()=>{
  const f=fixture();try{
    const id=subscribe(f);subscribe(f,'pending');subscribe(f,'unsubscribed');const mails=[];
    const fetcher=async(url,options)=>{if(url.endsWith('/data/index.json'))return Response.json(index());mails.push({url,options,payload:JSON.parse(options.body)});return Response.json({id:'provider-1'});};
    const response=await sendDigest(context(f,fetcher));const body=await stats(response);assert.deepEqual(body,{sent:1,failed:0,pending:0,uncertain:0});assert.equal(mails.length,1);
    const {payload,options}=mails[0];assert.equal(payload.to[0],id+'@example.com');assert.equal((payload.html.match(/<h2>/g)||[]).length,3);
    assert.ok(payload.html.includes('&lt;script&gt;'));assert.ok(!payload.html.includes('<script>'));assert.ok(!payload.html.includes('<img '));
    assert.ok(payload.text.includes('日报日期 2026-11-07'));assert.ok(payload.text.includes('来源：官方 <source>'));assert.ok(!payload.text.includes('未知'));assert.ok(!payload.text.includes('人工批准时间'));
    assert.ok(payload.html.includes('/topics/'+ids[0]+'/news/'));assert.equal(payload.headers['List-Unsubscribe-Post'],'List-Unsubscribe=One-Click');assert.match(payload.headers['List-Unsubscribe'],/^<https:\/\/news.example\/api\/newsletter\/unsubscribe\?token=/);
    assert.ok(options.headers['idempotency-key'].startsWith('newsletter/'));assert.ok(!JSON.stringify(body).includes(id));assert.ok(!JSON.stringify(body).includes('@'));
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).sent,0);assert.equal(mails.length,1);
  }finally{f.close();}
});

test('immutable retry payload and provider key survive lost responses and site/config changes',async()=>{
  const f=fixture();try{
    subscribe(f);let lookups=0;const attempts=[];
    const fetcher=async(url,options)=>{if(url.endsWith('/data/index.json')){lookups++;return Response.json(index());}attempts.push({body:options.body,key:options.headers['idempotency-key']});if(attempts.length===1)throw Error('lost response with private data');return Response.json({id:'accepted'});};
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).failed,1);
    f.env.NEWSLETTER_FROM='Changed <new@example.com>';f.env.NEWSLETTER_TOKEN_SECRET='new-secret-'.repeat(4);
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).sent,1);assert.deepEqual(attempts[0],attempts[1]);assert.equal(lookups,1);
  }finally{f.close();}
});

test('concurrent invocations claim each recipient once and reserve at most eight',async()=>{
  const f=fixture();try{
    for(let i=0;i<9;i++)subscribe(f);let sends=0;
    const fetcher=async url=>{if(url.endsWith('/data/index.json'))return Response.json(index());sends++;await new Promise(resolve=>setTimeout(resolve,2));return Response.json({id:'ok-'+sends});};
    const results=await Promise.all([sendDigest(context(f,fetcher)),sendDigest(context(f,fetcher))]);
    for(const response of results)assert.equal(response.status,200);
    assert.equal(sends,8);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_deliveries').get().n,8);
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).sent,1);assert.equal(sends,9);
  }finally{f.close();}
});

test('optout after reservation stops subsequent provider requests',async()=>{
  const f=fixture();try{
    subscribe(f);subscribe(f);let sends=0;
    const fetcher=async url=>{if(url.endsWith('/data/index.json'))return Response.json(index());sends++;f.db.prepare("UPDATE newsletter_subscribers SET status='unsubscribed'").run();return Response.json({id:'ok'});};
    const body=await stats(await sendDigest(context(f,fetcher)));assert.equal(sends,1);assert.equal(body.sent,1);assert.equal(body.pending,0);
  }finally{f.close();}
});

test('expired leases can retry, but ambiguous delivery beyond 23 hours becomes uncertain',async()=>{
  const f=fixture();try{
    subscribe(f);let sends=0;
    const fetcher=async url=>{if(url.endsWith('/data/index.json'))return Response.json(index());sends++;throw Error('timeout');};
    await sendDigest(context(f,fetcher));const now=Date.parse('2026-11-07T01:30:00Z');
    f.db.prepare("UPDATE newsletter_deliveries SET status='sending',lease_until=?").run(now+60000);
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).failed,0);assert.equal(sends,1);
    f.db.prepare('UPDATE newsletter_deliveries SET lease_until=?').run(now-1);
    assert.equal((await stats(await sendDigest(context(f,fetcher)))).failed,1);assert.equal(sends,2);
    f.db.prepare('UPDATE newsletter_deliveries SET created_at=?').run(now-23*60*60*1000);
    const final=await stats(await sendDigest(context(f,fetcher)));assert.equal(final.uncertain,1);assert.equal(sends,2);assert.equal(final.pending,0);
  }finally{f.close();}
});

test('public fetch uses redirect rejection and bounded response, provider rate limit stops page',async()=>{
  const f=fixture();try{
    subscribe(f);subscribe(f);let sends=0;
    const fetcher=async(url,options)=>{assert.equal(options.redirect,'manual');assert.ok(options.signal);if(url.endsWith('/data/index.json'))return new Response('x'.repeat(2*1024*1024+1));throw Error();};
    assert.equal((await sendDigest(context(f,fetcher))).status,502);
    const limited=async url=>{if(url.endsWith('/data/index.json'))return Response.json(index());sends++;return new Response('',{status:429});};
    const result=await stats(await sendDigest(context(f,limited)));assert.equal(result.failed,1);assert.equal(sends,1);assert.equal(result.pending,2);
  }finally{f.close();}
});


test('subscriber opting out during provider pacing is rechecked before sending',async()=>{
  const f=fixture();try{
    subscribe(f);subscribe(f);let sends=0,pauses=0;
    const fetcher=async url=>{if(url.endsWith('/data/index.json'))return Response.json(index());sends++;return Response.json({id:'ok'});};
    const pause=async ms=>{assert.equal(ms,600);pauses++;f.db.prepare("UPDATE newsletter_subscribers SET status='unsubscribed'").run();};
    const body=await stats(await sendDigest(context(f,fetcher,{pause})));assert.equal(sends,1);assert.equal(pauses,1);assert.equal(body.pending,0);
  }finally{f.close();}
});


test('a full cold-start batch fits the Cloudflare Free query and subrequest limits',async()=>{
  const f=fixture();try{
    for(let i=0;i<9;i++)subscribe(f);let requests=0;
    const fetcher=async url=>{requests++;return Response.json(url.endsWith('/data/index.json')?index():{id:'provider-'+requests});};
    const body=await stats(await sendDigest(context(f,fetcher)));
    assert.equal(body.sent,8);assert.equal(body.pending,1);
    assert.ok(f.queryCount<=50,'D1 query limit');
    assert.ok(f.queryCount+requests<=50,'combined subrequest budget');
  }finally{f.close();}
});


test('Workers-compatible public fetch rejects redirect responses before reserving deliveries',async()=>{
 const f=fixture();try{
  subscribe(f);let calls=0,redirect;
  const response=await sendDigest(context(f,async(url,init)=>{
   calls++;redirect=init.redirect;assert.equal(url,'https://news.example/data/index.json');
   if(init.redirect==='error')throw new TypeError('Invalid redirect value');
   assert.equal(init.redirect,'manual');return new Response(null,{status:302,headers:{location:'https://untrusted.example/index.json'}});
  }));
  assert.equal(response.status,502);assert.deepEqual(await response.json(),{error:'public_data_unavailable'});
  assert.equal(calls,1);assert.equal(redirect,'manual');assert.equal(f.db.prepare('SELECT COUNT(*) n FROM newsletter_deliveries').get().n,0);
 }finally{f.close();}
});
