import { escapeHtml, getConfig, json, NewsletterError, nowMs, readBody, requireCanonical, sendMail, unsubscribeToken } from './runtime.js';
import type { MailPayload, NewsletterConfig, NewsletterContext } from './runtime.js';

const RETRY_WINDOW = 23 * 60 * 60 * 1000;
const LEASE = 60 * 1000;
const topicId = (id: string) => /^(?:t-[a-f0-9]{24}|legacy)$/.test(id);
type Obj = Record<string, unknown>;
interface Item { key: string; summary: string; analysis: string; quote: string; source: string; published: string; event: string; fetched: string }
interface Edition { id: string; name: string; day: string; approved: string; collected: string; items: Item[] }
interface Snapshot { day: string; editions: Edition[] }
interface Delivery { id: string; subscriber_id: string; payload_json: string; created_at: number; attempts: number }
const object = (value: unknown): Obj => { if (!value || typeof value !== 'object' || Array.isArray(value)) throw new NewsletterError('invalid_public_data',502); return value as Obj; };
const string = (value: unknown, max = 20000): string => { if (typeof value !== 'string' || !value || value.length > max) throw new NewsletterError('invalid_public_data',502); return value; };
const timestamp = (value: unknown, nullable = false): string => { if (nullable && value === null) return ''; const text = string(value,64); if (!/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) throw new NewsletterError('invalid_public_data',502); return text; };
const shanghaiDay = (time: number) => new Date(time + 8 * 60 * 60 * 1000).toISOString().slice(0,10);

async function authorize(ctx: NewsletterContext, config: NewsletterConfig) {
  const supplied = ctx.request.headers.get('authorization') ?? '';
  // HMAC verification compares fixed-size digests inside WebCrypto, avoiding a
  // variable-time JavaScript comparison of the authorization secret.
  const key = await crypto.subtle.importKey('raw',new TextEncoder().encode(config.sendSecret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);
  const expected = await crypto.subtle.sign('HMAC',key,new TextEncoder().encode('Bearer '+config.sendSecret));
  if (supplied.length > 1024 || !await crypto.subtle.verify('HMAC',key,expected,new TextEncoder().encode(supplied))) throw new NewsletterError('unauthorized',401);
}

async function publicSnapshot(ctx: NewsletterContext, config: NewsletterConfig, day: string, now: number): Promise<Snapshot | null> {
  const controller = new AbortController(), timer = setTimeout(()=>controller.abort(),10000);
  let value: Obj;
  try {
    // Workers rejects redirect:error before I/O; manual plus the status check forbids redirects.
    const response = await (ctx.fetcher ?? fetch)(config.origin+'/data/index.json',{redirect:'manual',signal:controller.signal,headers:{accept:'application/json'}});
    if (!response.ok) { await response.body?.cancel(); throw Error(); }
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let size = 0;
    if (reader) for (;;) { const part=await reader.read(); if(part.done)break; size+=part.value.byteLength; if(size>2*1024*1024){await reader.cancel();throw Error();} chunks.push(part.value); }
    const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
    value=object(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new NewsletterError('public_data_unavailable',502); } finally { clearTimeout(timer); }
  if(value.schema_version!==1 || value.demo!==false || !Array.isArray(value.topics) || !Array.isArray(value.reports) || !Array.isArray(value.articles) || value.topics.length>100) throw new NewsletterError('invalid_public_data',502);
  const topics = new Map<string,Obj>();
  for(const raw of value.topics){const t=object(raw),id=string(t.id,64);if(!topicId(id)||topics.has(id))throw new NewsletterError('invalid_public_data',502);topics.set(id,t);}
  const ids=config.topicIds ?? [...topics.keys()].sort();
  if(!ids.length)return null;
  const editions: Edition[]=[];
  for(const id of ids){
    const t=topics.get(id);if(!t)return null;
    const r=object(t.latest), reportDay=string(r.report_date,10);
    const reportTime=Date.parse(reportDay+'T00:00:00Z');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(reportDay)||!Number.isFinite(reportTime)||new Date(reportTime).toISOString().slice(0,10)!==reportDay||reportDay>day)throw new NewsletterError('invalid_public_data',502);
    if(reportDay<day)return null;
    if(object(r.topic).id!==id || !Array.isArray(r.items) || !r.items.length || r.items.length>200)throw new NewsletterError('invalid_public_data',502);
    const approved=timestamp(r.approved_at),collected=timestamp(r.collected_at);
    if(Date.parse(approved)>now||Date.parse(collected)>now)throw new NewsletterError('invalid_public_data',502);
    const keys=new Set<string>();
    const items=r.items.map(raw=>{
      const item=object(raw),key=string(item.key,32),source=object(item.source);
      if(!/^[a-f0-9]{32}$/.test(key)||keys.has(key))throw new NewsletterError('invalid_public_data',502);keys.add(key);
      return {key,summary:string(item.fact_summary),analysis:item.analysis===null||item.analysis===undefined?'':string(item.analysis),quote:string(item.evidence_quote),source:string(source.name,500),published:timestamp(source.published_at,true),event:timestamp(source.event_at,true),fetched:timestamp(source.fetched_at,true)};
    });
    editions.push({id,name:string(t.name,500),day:reportDay,approved,collected,items});
  }
  return {day,editions};
}

async function mail(config: NewsletterConfig, snapshot: Snapshot, subscriber: {id:string;email:string}): Promise<MailPayload> {
  const unsubscribe=config.origin+'/api/newsletter/unsubscribe?token='+encodeURIComponent(await unsubscribeToken(subscriber.id,config.tokenSecret));
  const parts=[`AI News Hub · ${snapshot.day} 每日汇总`]; let html=`<h1>${escapeHtml(parts[0])}</h1>`;
  for(const edition of snapshot.editions){
    const heading=`${edition.name} · 日报日期 ${edition.day}`;
    const editionLink=`${config.origin}/topics/${edition.id}/archive/${edition.day}/`;
    html+=`<h2><a href="${escapeHtml(editionLink)}">${escapeHtml(heading)}</a></h2>`;parts.push(heading,editionLink);
    for(const item of edition.items){
      const link=`${config.origin}/topics/${edition.id}/news/${item.key}/`;
      const source=`来源：${item.source}${item.published ? `；发布时间：${item.published}` : ''}`;
      const sentences=/^([\s\S]*?(?:[。！？]|\.(?=\s)))([\s\S]*)$/.exec(item.summary);
      const title=sentences?.[1] ?? item.summary, details=sentences?.[2].trim() ?? '';
      html+=`<article><h3><a href="${escapeHtml(link)}">${escapeHtml(title)}</a></h3>${details ? `<p>${escapeHtml(details)}</p>` : ''}${item.analysis ? `<p>分析（推断）：${escapeHtml(item.analysis)}</p>` : ''}<blockquote>${escapeHtml(item.quote)}</blockquote><p>${escapeHtml(source)}</p></article>`;
      parts.push(item.summary,...(item.analysis ? [`分析（推断）：${item.analysis}`] : []),`依据引文：${item.quote}`,source,link);
    }
  }
  html+=`<p><a href="${escapeHtml(unsubscribe)}">退订每日邮件</a></p>`;parts.push('退订每日邮件：'+unsubscribe);
  return {from:config.from,to:[subscriber.email],subject:`AI News Hub · ${snapshot.day} 每日汇总`,html,text:parts.join('\n\n'),headers:{'List-Unsubscribe':`<${unsubscribe}>`,'List-Unsubscribe-Post':'List-Unsubscribe=One-Click'}};
}

export async function sendDigest(ctx: NewsletterContext): Promise<Response> {
  try {
    const config=getConfig(ctx.env);requireCanonical(ctx,config);
    if(ctx.request.method!=='POST')return json({error:'method_not_allowed'},405);
    await authorize(ctx,config);
    // No date override: callers cannot reserve old/future daily editions.
    if(ctx.request.body){const body=await readBody(ctx.request);if(Object.keys(body).length)throw new NewsletterError('invalid_request');}
    const now=nowMs(ctx),day=shanghaiDay(now),db=config.db;
    // Never retry potentially accepted provider requests beyond its 24h key TTL.
    await db.prepare("UPDATE newsletter_deliveries SET status='uncertain',lease_until=NULL,error_code='retry_window_expired',updated_at=? WHERE status IN ('pending','failed','sending') AND attempts>0 AND created_at<=? AND (lease_until IS NULL OR lease_until<=?)").bind(now,now-RETRY_WINDOW,now).run();
    let stored=await db.prepare('SELECT snapshot_json FROM newsletter_digests WHERE day=?').bind(day).first<{snapshot_json:string}>();
    if(!stored){
      const snapshot=await publicSnapshot(ctx,config,day,now);
      if(!snapshot)return json({sent:0,failed:0,pending:0,waiting:true});
      await db.prepare('INSERT OR IGNORE INTO newsletter_digests(day,snapshot_json,created_at) VALUES(?,?,?)').bind(day,JSON.stringify(snapshot),now).run();
      stored=await db.prepare('SELECT snapshot_json FROM newsletter_digests WHERE day=?').bind(day).first<{snapshot_json:string}>();
    }
    if(!stored)throw new NewsletterError('storage_unavailable',503);
    const snapshot=JSON.parse(stored.snapshot_json) as Snapshot;
    // Reserve only a bounded page and only for currently confirmed readers.
    const subscribers=await db.prepare("SELECT id,email FROM newsletter_subscribers s WHERE status='active' AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.subscriber_id=s.id AND d.day=?) ORDER BY s.id LIMIT 8").bind(day).all<{id:string;email:string}>();
    for(const subscriber of subscribers.results){
      const payload=await mail(config,snapshot,subscriber);
      await db.prepare("INSERT OR IGNORE INTO newsletter_deliveries(id,subscriber_id,day,payload_json,status,created_at,updated_at) SELECT ?,?,?,?,'pending',?,? WHERE EXISTS (SELECT 1 FROM newsletter_subscribers WHERE id=? AND status='active')").bind(crypto.randomUUID(),subscriber.id,day,JSON.stringify(payload),now,now,subscriber.id).run();
    }
    const candidates=await db.prepare("SELECT d.id,d.subscriber_id,d.payload_json,d.created_at,d.attempts FROM newsletter_deliveries d JOIN newsletter_subscribers s ON s.id=d.subscriber_id WHERE d.day=? AND s.status='active' AND (d.status IN ('pending','failed') OR (d.status='sending' AND d.lease_until<=?)) AND (d.attempts=0 OR d.created_at>?) ORDER BY d.created_at,d.id LIMIT 8").bind(day,now,now-RETRY_WINDOW).all<Delivery>();
    let sent=0,failed=0,providerRequests=0;
    for(const delivery of candidates.results){
      const attemptTime=nowMs(ctx);
      const claim=await db.prepare("UPDATE newsletter_deliveries SET status='sending',attempts=attempts+1,lease_until=?,updated_at=? WHERE id=? AND (status IN ('pending','failed') OR (status='sending' AND lease_until<=?)) AND (attempts=0 OR created_at>?) AND EXISTS (SELECT 1 FROM newsletter_subscribers WHERE id=subscriber_id AND status='active')").bind(attemptTime+LEASE,attemptTime,delivery.id,attemptTime,attemptTime-RETRY_WINDOW).run();
      if(!claim.meta.changes)continue;
      if(providerRequests) await (ctx.pause ?? (ms=>new Promise(resolve=>setTimeout(resolve,ms))))(600);
      // A reader can opt out after reservation; check again immediately before I/O.
      const active=await db.prepare("SELECT id FROM newsletter_subscribers WHERE id=? AND status='active'").bind(delivery.subscriber_id).first();
      if(!active){await db.prepare("UPDATE newsletter_deliveries SET status='failed',lease_until=NULL,error_code='subscriber_inactive',updated_at=? WHERE id=? AND status='sending'").bind(attemptTime,delivery.id).run();continue;}
      try {
        providerRequests++;
        const provider=await sendMail(config,JSON.parse(delivery.payload_json) as MailPayload,'newsletter/'+delivery.id,ctx.fetcher);
        await db.prepare("UPDATE newsletter_deliveries SET status='sent',provider_id=?,lease_until=NULL,error_code=NULL,updated_at=? WHERE id=? AND status='sending'").bind(provider,nowMs(ctx),delivery.id).run();sent++;
      } catch(error){
        const code=error instanceof NewsletterError?error.code:'mail_unavailable';
        await db.prepare("UPDATE newsletter_deliveries SET status='failed',lease_until=NULL,error_code=?,updated_at=? WHERE id=? AND status='sending'").bind(code,nowMs(ctx),delivery.id).run();failed++;
        // Stop this page when the provider asks us to slow down.
        if(code==='mail_http_429')break;
      }
    }
    const pending=await db.prepare("SELECT COUNT(*) AS count FROM newsletter_subscribers s WHERE s.status='active' AND NOT EXISTS (SELECT 1 FROM newsletter_deliveries d WHERE d.subscriber_id=s.id AND d.day=? AND d.status IN ('sent','uncertain'))").bind(day).first<{count:number}>();
    const uncertain=await db.prepare("SELECT COUNT(*) AS count FROM newsletter_deliveries WHERE day=? AND status='uncertain'").bind(day).first<{count:number}>();
    return json({sent,failed,pending:pending?.count??0,uncertain:uncertain?.count??0});
  }catch(error){return json({error:error instanceof NewsletterError?error.code:'newsletter_unavailable'},error instanceof NewsletterError?error.status:503);}
}
