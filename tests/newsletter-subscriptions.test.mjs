import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures/newsletter.mjs';
import { handleSubscribe, handleConfirm, handleUnsubscribe } from '../dist/newsletter/subscriptions.js';
import { hash, unsubscribeToken } from '../dist/newsletter/runtime.js';

const NOW = Date.parse('2026-11-07T01:30:00Z');
const HOUR = 3600000;
function mailbox() {
  const messages = [];
  return {
    messages,
    fetcher: async (_url, options) => {
      messages.push({ payload: JSON.parse(options.body), key: options.headers['idempotency-key'] });
      return Response.json({ id: `mail-${messages.length}` });
    },
    token() { return new URL(messages.at(-1).payload.text.match(/https:\/\/\S+/)[0]).searchParams.get('token'); },
  };
}
function subscriber(f) { return f.db.prepare('SELECT * FROM newsletter_subscribers').get(); }
function context(f, path, options={}) { return f.context(`/api/newsletter/${path}`,options); }

// Tests exercise the actual SQLite predicates, not a mock interpretation of SQL.
test('subscription requires a deliberate confirmation POST and stores only token hash', async t => {
  const f = fixture(); t.after(() => f.close()); const mail = mailbox();
  const response = await handleSubscribe(context(f,'subscribe',{body:{email:' Reader@Example.com '},fetcher:mail.fetcher}));
  assert.equal(response.status,202);
  assert.equal(mail.messages.length,1);
  const token = mail.token();
  const row = subscriber(f);
  assert.equal(row.status,'pending'); assert.equal(row.email,'reader@example.com');
  assert.equal(row.confirmation_hash,await hash(token)); assert.notEqual(row.confirmation_hash,token);
  assert.equal(row.confirmation_expires_at,NOW+24*HOUR);
  assert.equal(mail.messages[0].key,`confirmation/${row.id}/${NOW}`);
  const preview = await handleConfirm(context(f,`confirm?token=${token}`,{method:'GET'}));
  assert.equal(preview.status,200); assert.match(await preview.text(),/<form method="post"/);
  assert.equal(subscriber(f).status,'pending');
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token}}))).status,200);
  assert.equal(subscriber(f).status,'active'); assert.equal(subscriber(f).confirmation_hash,null);
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token}}))).status,400);
  assert.equal(mail.messages.length,1);
});

test('cooldown, active subscriptions, honeypot and concurrent requests share a generic response', async t => {
  const f=fixture(); t.after(()=>f.close()); const mail=mailbox();
  const submit=body=>handleSubscribe(context(f,'subscribe',{body,fetcher:mail.fetcher}));
  const responses=await Promise.all([submit({email:'reader@example.com'}),submit({email:'reader@example.com'})]);
  assert.equal(mail.messages.length,1);
  const message=await responses[0].text(); assert.equal(await responses[1].text(),message);
  assert.equal(await (await submit({email:'reader@example.com',website:'spam'})).text(),message);
  const token=mail.token(); await handleConfirm(context(f,'confirm',{body:{token}}));
  assert.equal(await (await submit({email:'reader@example.com'})).text(),message);
  assert.equal(mail.messages.length,1);
});

test('IP rate limit permits five confirmations and resets after one hour', async t => {
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  for(let i=0;i<7;i++) assert.equal((await handleSubscribe(context(f,'subscribe',{body:{email:`reader${i}@example.com`},fetcher:mail.fetcher}))).status,202);
  assert.equal(mail.messages.length,5);
  const rate=f.db.prepare('SELECT * FROM newsletter_rate_limits').get();
  assert.equal(rate.hits,5); assert.ok(!rate.key.includes('127.0.0.1'));
  await handleSubscribe(context(f,'subscribe',{body:{email:'later@example.com'},fetcher:mail.fetcher,now:()=>new Date(NOW+HOUR)}));
  assert.equal(mail.messages.length,6);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_rate_limits').get().n,1);
});

test('confirmation expiry, origins and preview deployment are rejected', async t=>{
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  await assert.rejects(()=>handleSubscribe(context(f,'subscribe',{body:{email:'bad'},fetcher:mail.fetcher})),/invalid_email/);
  await assert.rejects(()=>handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},headers:{origin:'https://evil.example'},fetcher:mail.fetcher})),/invalid_origin/);
  const preview=context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher});
  preview.request=new Request('https://preview.example/api/newsletter/subscribe',preview.request);
  await assert.rejects(()=>handleSubscribe(preview),/newsletter_unavailable/);
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher}));const token=mail.token();
  await assert.rejects(()=>handleConfirm(context(f,'confirm',{body:{token},headers:{origin:'https://evil.example'}})),/invalid_origin/);
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token},now:()=>new Date(NOW+24*HOUR)}))).status,400);
  assert.equal(subscriber(f).status,'pending');
});

test('provider errors stay generic and preserve reservation cooldown', async t=>{
  const f=fixture();t.after(()=>f.close());let sends=0;
  const fetcher=async()=>{sends++;return new Response('secret provider detail',{status:500});};
  const response=await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher}));
  assert.equal(response.status,202);assert.doesNotMatch(await response.text(),/secret|500/);
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher}));assert.equal(sends,1);
  assert.equal(subscriber(f).status,'pending');
});

test('GET unsubscribe is safe; one-click POST is idempotent; resubscribe requires a fresh token', async t=>{
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher}));
  const old=mail.token();await handleConfirm(context(f,'confirm',{body:{token:old}}));
  const token=await unsubscribeToken(subscriber(f).id,f.env.NEWSLETTER_TOKEN_SECRET);
  assert.equal((await handleUnsubscribe(context(f,`unsubscribe?token=${token}`,{method:'GET'}))).status,200);
  assert.equal(subscriber(f).status,'active');
  const oneClick=()=>context(f,`unsubscribe?token=${token}`,{body:'List-Unsubscribe=One-Click',headers:{'content-type':'application/x-www-form-urlencoded'}});
  // Use a native form body, as a mail provider does for RFC 8058.
  const unsubscribe=()=>{const ctx=oneClick();ctx.request=new Request(ctx.request.url,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'List-Unsubscribe=One-Click'});return handleUnsubscribe(ctx);};
  assert.equal((await unsubscribe()).status,200);assert.equal((await unsubscribe()).status,200);
  assert.equal(subscriber(f).status,'unsubscribed');
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher,now:()=>new Date(NOW+HOUR)}));
  assert.equal(subscriber(f).status,'pending');assert.notEqual(mail.token(),old);
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token:old},now:()=>new Date(NOW+HOUR)}))).status,400);
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token:mail.token()},now:()=>new Date(NOW+HOUR)}))).status,200);
  await assert.rejects(()=>handleUnsubscribe(context(f,'unsubscribe',{body:{token:token+'bad'}})),/invalid_token/);
});

test('subscriber cap preserves existing subscriber confirmation renewal', async t=>{
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  const insert=f.db.prepare("INSERT INTO newsletter_subscribers(id,email,status,created_at,updated_at) VALUES(?,?,'unsubscribed',?,?)");
  for(let i=0;i<5000;i++) insert.run(crypto.randomUUID(),`reader${i}@example.com`,NOW,NOW);
  await handleSubscribe(context(f,'subscribe',{body:{email:'extra@example.com'},fetcher:mail.fetcher}));assert.equal(mail.messages.length,0);
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader0@example.com'},fetcher:mail.fetcher}));assert.equal(mail.messages.length,1);
  assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_subscribers').get().n,5000);
});

test('form subscription works and unsubscribing a pending request invalidates its confirmation', async t=>{
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  await handleSubscribe(context(f,'subscribe',{body:'email=reader%40example.com&website=',headers:{'content-type':'application/x-www-form-urlencoded'},fetcher:mail.fetcher}));
  const token=mail.token();const unsubscribe=await unsubscribeToken(subscriber(f).id,f.env.NEWSLETTER_TOKEN_SECRET);
  await handleUnsubscribe(context(f,'unsubscribe',{body:{token:unsubscribe}}));
  assert.equal(subscriber(f).status,'unsubscribed');assert.equal(subscriber(f).confirmation_hash,null);
  assert.equal((await handleConfirm(context(f,'confirm',{body:{token}}))).status,400);
});

test('rate-limit table has a hard cap and expired rows are reclaimed', async t=>{
  const f=fixture();t.after(()=>f.close());const mail=mailbox();
  const insert=f.db.prepare('INSERT INTO newsletter_rate_limits(key,hits,expires_at) VALUES(?,?,?)');
  for(let i=0;i<10000;i++)insert.run(`old-${i}`,1,NOW+HOUR);
  assert.equal((await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher}))).status,202);
  assert.equal(mail.messages.length,0);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_rate_limits').get().n,10000);
  await handleSubscribe(context(f,'subscribe',{body:{email:'reader@example.com'},fetcher:mail.fetcher,now:()=>new Date(NOW+HOUR)}));
  assert.equal(mail.messages.length,1);assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM newsletter_rate_limits').get().n,1);
});
