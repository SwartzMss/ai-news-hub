import test from 'node:test';
import assert from 'node:assert/strict';
import {verifySource,SourceValidationError,sourceFailureDiagnostic} from '../dist/apps/server/src/news/sources.js';
import {AppError} from '../dist/apps/server/src/errors.js';
const url='https://example.com/release',html='<html><head><title>Official release announcement</title></head><body><p>Official release announcement text.</p></body></html>';
const success=()=>new Response(html,{headers:{'content-type':'text/html'}});
const transient=()=>new TypeError('secret internal error text',{cause:Object.assign(new Error('sensitive hostname or token'),{code:'ECONNRESET'})});
test('transient connection errors retry once with the same constrained fetch options',async()=>{
 const calls=[];const fetcher=async(raw,options)=>{calls.push({raw,options});if(calls.length===1)throw transient();return success();};
 const source=await verifySource(url,fetcher,new AbortController().signal);assert.equal(source.canonicalUrl,url);assert.equal(calls.length,2);
 for(const call of calls){assert.equal(call.options.redirect,'manual');assert.equal(call.options.method,'GET');assert.equal(call.options.headers.accept,'text/html');assert.ok(call.options.signal);}
});
test('retry limit is two and diagnostics retain only allowlisted error fields',async()=>{
 let count=0;await assert.rejects(verifySource(url,async()=>{count++;throw transient();},new AbortController().signal),error=>{
  assert.ok(error instanceof SourceValidationError);assert.equal(error.code,'source_fetch_failed');
  assert.deepEqual(sourceFailureDiagnostic(error),{url,code:'source_fetch_failed',attempts:2,networkCode:'ECONNRESET'});
  assert.ok(!JSON.stringify(error).includes('sensitive'));assert.ok(!JSON.stringify(error).includes('secret'));return true;
 });assert.equal(count,2);assert.equal(sourceFailureDiagnostic(new Error('raw')),undefined);
});
test('transient HTTP responses retry, while long Retry-After never adds an unbounded wait',async()=>{
 for(const status of [429,502,503,504]){let count=0;const result=await verifySource(url,async()=>++count===1?new Response('',{status,headers:{'retry-after':'0'}}):success(),new AbortController().signal);assert.equal(result.canonicalUrl,url);assert.equal(count,2);}
 let count=0;await assert.rejects(verifySource(url,async()=>{count++;return new Response('',{status:429,headers:{'retry-after':'3600'}});},new AbortController().signal),error=>{assert.deepEqual(error.diagnostic,{url,code:'source_http_failed',attempts:1,httpStatus:429});return true;});assert.equal(count,1);
});
test('permanent HTTP, redirect, PDF, charset, decoding, DNS validation and unknown errors never retry',async()=>{
 for(const [makeResponse,code] of [
  [()=>new Response('',{status:403}),'source_http_failed'],[()=>new Response('',{status:404}),'source_http_failed'],[()=>new Response('',{status:302,headers:{location:'https://other.example.com/'}}),'source_http_failed'],
  [()=>new Response('pdf',{headers:{'content-type':'application/pdf'}}),'source_content_type'],[()=>new Response(html,{headers:{'content-type':'text/html;charset=gbk'}}),'source_content_type'],[()=>new Response(new Uint8Array([0xff]),{headers:{'content-type':'text/html'}}),'source_fetch_failed'],
 ]){let count=0;await assert.rejects(verifySource(url,async()=>{count++;return makeResponse();},new AbortController().signal),{code});assert.equal(count,1);}
 for(const error of [new AppError('invalid_source_address'),new AppError('raw-secret'),Object.assign(new Error('raw-secret'),{code:'NOT_ALLOWLISTED'})]){let count=0;await assert.rejects(verifySource(url,async()=>{count++;throw error;},new AbortController().signal),cause=>{assert.equal(cause.diagnostic.attempts,1);assert.equal(cause.diagnostic.networkCode,undefined);assert.ok(!JSON.stringify(cause).includes('raw-secret'));return true;});assert.equal(count,1);}
 let count=0;await assert.rejects(verifySource('https://127.0.0.1/',async()=>{count++;return success();},new AbortController().signal),{code:'invalid_source_url'});assert.equal(count,0);
});
test('parent abort stops retry backoff without a second attempt',async()=>{
 const controller=new AbortController();let count=0;
 const pending=verifySource(url,async()=>{count++;setTimeout(()=>controller.abort(),10);throw transient();},controller.signal);
 await assert.rejects(pending,error=>{assert.equal(error.code,'source_cancelled');assert.equal(error.diagnostic.attempts,1);return true;});assert.equal(count,1);
 const already=new AbortController();already.abort();await assert.rejects(verifySource(url,async()=>{throw Error('must not fetch');},already.signal),error=>{assert.equal(error.diagnostic.attempts,0);return error.code==='source_cancelled';});
});
test('parent cancellation wins when the second fetch fails',async()=>{
 const controller=new AbortController();let count=0;
 await assert.rejects(verifySource(url,async()=>{count++;if(count===2)controller.abort();throw transient();},controller.signal),error=>{assert.equal(error.code,'source_cancelled');assert.equal(error.diagnostic.attempts,2);return true;});assert.equal(count,2);
});
test('per-attempt deadline failure retries once and reports source_timeout',async(context)=>{
 context.mock.method(AbortSignal,'timeout',()=>{const controller=new AbortController();setTimeout(()=>controller.abort(new DOMException('deadline','TimeoutError')),1);return controller.signal;});
 let count=0;
 await assert.rejects(verifySource(url,async(_raw,options)=>{count++;return new Promise((_resolve,reject)=>{options.signal.addEventListener('abort',()=>reject(options.signal.reason),{once:true});});},new AbortController().signal),error=>{assert.equal(error.code,'source_timeout');assert.equal(error.diagnostic.attempts,2);return true;});assert.equal(count,2);
});
