import test from 'node:test';
import assert from 'node:assert/strict';

test('source URL policy rejects credentials, private literals, local names and non-HTTPS', async () => {
 const { sourceUrl, publicAddress } = await import('../dist/apps/server/src/news/sources.js');
 for (const url of ['http://example.com/a','https://127.0.0.1/','https://[::1]/','https://2130706433/','https://localhost/','https://x.local/','https://u:p@example.com/','https://example.com:8443/','file:///etc/passwd','https://example.com/\\foo','https://example.com/%0a']) assert.throws(()=>sourceUrl(url),{code:'invalid_source_url'},url);
 assert.equal(sourceUrl('https://example.com/a?utm_source=x&b=2#part'),'https://example.com/a?b=2');
 for(const ip of ['0.0.0.0','10.0.0.1','100.64.0.1','127.0.0.1','169.254.169.254','172.16.0.1','192.168.1.1','192.0.0.1','198.18.0.1','224.0.0.1','::','::1','::ffff:127.0.0.1','2001:db8::1','fc00::1','fe80::1','ff02::1']) assert.equal(publicAddress(ip),false,ip);
 assert.equal(publicAddress('1.1.1.1'),true); assert.equal(publicAddress('2606:4700:4700::1111'),true);
});
test('only fetched visible page text can substantiate a Codex quote; dates come from source metadata', async () => {
 const { verifySource } = await import('../dist/apps/server/src/news/sources.js');
 const fetcher=async()=>new Response('<html><head><title>Official release announcement</title><meta property="article:published_time" content="2026-11-02T10:00:00Z"></head><body><script>Secret invented announcement</script><p>Released <strong>an AI model</strong> today &amp; shared weights.</p></body></html>',{headers:{'content-type':'text/html; charset=utf-8'}});
 const candidate=await verifySource('https://example.com/release',fetcher,new AbortController().signal);
 assert.ok(candidate.excerpt.includes('Released an AI model today & shared weights.'));
 assert.ok(!candidate.excerpt.includes('Secret invented')); assert.equal(candidate.publishedAt,'2026-11-02T10:00:00.000Z'); assert.equal(candidate.eventAt,null);
});
test('redirects, bad content types, oversized documents, cancellation and timezone-free dates fail closed', async () => {
 const { verifySource } = await import('../dist/apps/server/src/news/sources.js');
 for(const [response,code] of [[new Response('',{status:302,headers:{location:'http://127.0.0.1/'}}),'source_http_failed'],[new Response('{}',{headers:{'content-type':'application/json'}}),'source_content_type'],[new Response('x'.repeat(2*1024*1024+1),{headers:{'content-type':'text/html'}}),'source_too_large']]) await assert.rejects(verifySource('https://example.com/a',async()=>response,new AbortController().signal),{code});
 const cancelled=new AbortController(); cancelled.abort(); await assert.rejects(verifySource('https://example.com/a',async()=>{throw Error('must not fetch');},cancelled.signal),{code:'source_cancelled'});
 const c=await verifySource('https://example.com/a',async()=>new Response('<title>Official release announcement</title><meta property="article:published_time" content="2026-11-02"><p>Real announcement text.</p>',{headers:{'content-type':'text/html'}}),new AbortController().signal); assert.equal(c.publishedAt,null);
});
test('DNS resolution rejects mixed public/private answers and is cancellable before the resolver finishes', async () => {
 const {resolveSourceAddress}=await import('../dist/apps/server/src/news/sources.js');
 await assert.rejects(resolveSourceAddress('example.com',new AbortController().signal,async()=>[{address:'1.1.1.1',family:4},{address:'127.0.0.1',family:4}]),{code:'invalid_source_address'});
 const controller=new AbortController();
 const result=resolveSourceAddress('example.com',controller.signal,()=>new Promise(()=>{}));
 controller.abort(new Error('cancel DNS')); await assert.rejects(result,/cancel DNS/);
});
