import test from 'node:test';
import assert from 'node:assert/strict';
import {getConfig,normalizeEmail,readBody,unsubscribeToken,verifyUnsubscribeToken,sendMail,page,requireCanonical} from '../dist/newsletter/runtime.js';
const env={NEWSLETTER_ENABLED:'1',NEWSLETTER_DB:{},SITE_URL:'https://news.example',NEWSLETTER_FROM:'News <news@example.com>',RESEND_API_KEY:'re_TEST_PRIVATE',NEWSLETTER_TOKEN_SECRET:'s'.repeat(32),NEWSLETTER_SEND_SECRET:'c'.repeat(32)};
test('newsletter configuration fails closed and email inputs reject header and recipient injection',()=>{
 const config=getConfig(env);assert.equal(config.origin,'https://news.example');
 for(const value of [{...env,NEWSLETTER_ENABLED:'0'},{...env,NEWSLETTER_DB:undefined},{...env,SITE_URL:'http://news.example'},{...env,SITE_URL:'https://user:pass@news.example/'},{...env,NEWSLETTER_FROM:'name\r\nBcc: victim@example.com'}])assert.throws(()=>getConfig(value));
 assert.equal(normalizeEmail(' User+News@Example.COM '),'user+news@example.com');
 for(const value of ['a@example.com,b@example.com','a@example.com\r\nBcc: x@y.com','a..b@example.com','.a@example.com','a.@example.com'])assert.throws(()=>normalizeEmail(value));
 assert.throws(()=>requireCanonical({request:new Request('https://preview.example/api/newsletter/subscribe')},config),/newsletter_unavailable/);
});
test('unsubscribe tokens are signed, purpose limited and not forgeable',async()=>{
 const id=crypto.randomUUID(),token=await unsubscribeToken(id,env.NEWSLETTER_TOKEN_SECRET);
 assert.equal(await verifyUnsubscribeToken(token,env.NEWSLETTER_TOKEN_SECRET),id);
 for(const value of [token+'x','broken',token.slice(0,-2)])await assert.rejects(verifyUnsubscribeToken(value,env.NEWSLETTER_TOKEN_SECRET),/invalid_token/);
 await assert.rejects(verifyUnsubscribeToken(token,'different'.repeat(8)),/invalid_token/);
});
test('public body parsing is bounded independently of a claimed Content-Length',async()=>{
 assert.deepEqual(await readBody(new Request('https://news.example/',{method:'POST',headers:{'content-type':'application/json'},body:'{"email":"a@example.com"}'})),{email:'a@example.com'});
 assert.deepEqual(await readBody(new Request('https://news.example/',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'token=abc'})),{token:'abc'});
 await assert.rejects(readBody(new Request('https://news.example/',{method:'POST',headers:{'content-type':'application/json'},body:'x'.repeat(2049)})),/request_too_large/);
});
test('mail transport bounds responses and hides provider bodies, using explicit deduplication keys',async()=>{
 const config=getConfig(env),payload={from:config.from,to:['reader@example.com'],subject:'日报',html:'<p>日报</p>',text:'日报'};
 const calls=[];assert.equal(await sendMail(config,payload,'same-key',async(url,init)=>{calls.push({url,init});return Response.json({id:'mail-id'});}),'mail-id');
 assert.equal(calls[0].url,'https://api.resend.com/emails');assert.equal(calls[0].init.redirect,'error');assert.equal(calls[0].init.headers['idempotency-key'],'same-key');
 await assert.rejects(sendMail(config,payload,'same-key',async()=>new Response('secret provider response',{status:429})),/^Error: mail_http_429$/);
 await assert.rejects(sendMail(config,payload,'same-key',async()=>new Response('x'.repeat(9000))),/mail_unavailable/);
 const response=page('<img src=x>','<script>bad</script>',{action:'/api/newsletter/confirm',token:'"><script>x</script>'});const html=await response.text();assert.ok(!html.includes('<script>'));assert.ok(html.includes('&lt;script&gt;'));
 assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'strict-origin');
});
