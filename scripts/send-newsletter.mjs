// Called only by the trusted production workflow. Never print response bodies,
// configuration values, subscriber addresses, or authorization credentials.
const site = process.env.NEWSLETTER_SITE_URL;
const secret = process.env.NEWSLETTER_SEND_SECRET;
if (!site || !secret) {
  console.log('Newsletter dispatch disabled: production configuration is incomplete.');
  process.exit(0);
}
let origin;
try {
  const url = new URL(site);
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password || secret.length < 32) throw Error();
  origin = url.origin;
} catch {
  console.error('Invalid newsletter production configuration.');
  process.exit(1);
}
const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
let sent=0,failed=0;
for (let page=0;page<25;page++) {
  let response,body;
  try {
    response=await fetch(origin+'/api/newsletter/send',{method:'POST',redirect:'error',signal:AbortSignal.timeout(60000),headers:{authorization:'Bearer '+secret,'content-type':'application/json'},body:'{}'});
    // The endpoint returns only counters. Bound reading even if misconfigured.
    const reader=response.body?.getReader();let text='';if(reader)for(;;){const part=await reader.read();if(part.done)break;text+=new TextDecoder().decode(part.value);if(text.length>4096){await reader.cancel();throw Error();}}
    body=JSON.parse(text);
  } catch {
    console.error('Newsletter dispatch interrupted; a later schedule can retry safely.');
    process.exit(1);
  }
  if (response.status===429 || response.status>=500) {
    if (page===24) {console.error('Newsletter dispatch retry limit reached.');process.exit(1);}
    await pause(Math.min(30000,2000*2**Math.min(page,4)));continue;
  }
  if (!response.ok || !body || typeof body!=='object' || !['sent','failed','pending'].every(key=>Number.isSafeInteger(body[key])&&body[key]>=0)) {
    console.error('Newsletter dispatch rejected or returned invalid counters.');process.exit(1);
  }
  sent+=body.sent;failed+=body.failed;
  console.log(`Newsletter dispatch: sent=${body.sent}, failed=${body.failed}, pending=${body.pending}, waiting=${body.waiting===true}.`);
  if(body.waiting || body.pending===0)break;
  if(body.sent+body.failed===0){console.log('Newsletter work is leased by another invocation; leaving it for the next schedule.');break;}
  // A page has at most 8 attempts, at most 200 per invocation. Failures use
  // exponential backoff; regular pages leave headroom under provider rate limits.
  await pause(body.failed ? Math.min(30000,2000*2**Math.min(page,4)) : 11000);
}
console.log(`Newsletter invocation finished: sent=${sent}, failed=${failed}.`);
