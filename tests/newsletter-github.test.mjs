import test from 'node:test';
import assert from 'node:assert/strict';
import {GitHubNewsletterGateway,NewsletterGatewayError} from '../dist/apps/server/src/newsletter/github.js';

test('newsletter gateway uses fixed workflow and main ref and returns exact run details',async()=>{
  const requests=[];
  const fetcher=async(url,init)=>{
    requests.push({url,method:init.method,headers:init.headers,body:init.body});
    if(url.endsWith('dispatches?return_run_details=true'))return Response.json({workflow_run_id:42,run_url:'https://api.github.com/repos/SwartzMss/ai-news-hub/actions/runs/42',html_url:'https://github.com/SwartzMss/ai-news-hub/actions/runs/42'});
    if(url.endsWith('/actions/runs/42'))return Response.json({id:42,status:'completed',conclusion:'success'});
    return Response.json({workflow_runs:[{id:42,display_title:'Newsletter newsletter-20261110-0900'}]});
  };
  const gateway=new GitHubNewsletterGateway(()=> 'fixture-secret',fetcher);
  const signal=new AbortController().signal;
  const input={dispatchId:'newsletter-20261110-0900',scheduledAt:'2026-11-10T09:00:00+08:00',triggerReason:'scheduled',ref:'main'};
  const result=await gateway.dispatch(input,signal);
  assert.equal(result.workflowRunId,42);
  assert.equal(requests[0].url,'https://api.github.com/repos/SwartzMss/ai-news-hub/actions/workflows/newsletter.yml/dispatches?return_run_details=true');
  assert.deepEqual(JSON.parse(requests[0].body),{ref:'main',inputs:{dispatch_id:input.dispatchId,scheduled_at:input.scheduledAt,trigger_reason:'scheduled'}});
  assert.equal(requests[0].headers.authorization,'Bearer fixture-secret');
  assert.equal(await gateway.findRun(input.dispatchId,signal).then(x=>x.workflowRunId),42);
  assert.deepEqual(await gateway.getRun(42,signal),{status:'completed',conclusion:'success'});
});
test('newsletter dispatch treats a 204 response as uncertain',async()=>{
  const gateway=new GitHubNewsletterGateway(()=> 'fixture-secret',async()=>new Response(null,{status:204}));
  await assert.rejects(gateway.dispatch({dispatchId:'x',scheduledAt:'2026-11-10T09:00:00+08:00',triggerReason:'manual',ref:'main'},new AbortController().signal),error=>error instanceof NewsletterGatewayError&&!error.definitive);
});
