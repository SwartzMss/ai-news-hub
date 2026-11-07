import test from 'node:test';
import assert from 'node:assert/strict';
import {onRequest} from '../dist/functions/api/newsletter/[[path]].js';
import {fixture} from './fixtures/newsletter.mjs';

test('Pages routes work without JavaScript and mail link scanners cannot confirm a subscription',async()=>{
  const f=fixture();try{
    const mails=[];
    const fetcher=async(_url,init)=>{mails.push(JSON.parse(init.body));return Response.json({id:'fake-confirmation'});};
    const response=await onRequest(f.context('subscribe',{headers:{accept:'text/html','content-type':'application/x-www-form-urlencoded'},body:'email=reader%40example.com&website=',fetcher}));
    assert.equal(response.status,202);assert.match(response.headers.get('content-type'),/text\/html/);assert.match(await response.text(),/请检查确认邮件/);
    const confirm=mails[0].text.match(/https:\/\/\S+/)[0];
    const form=await onRequest(f.context(confirm,{method:'GET',headers:{accept:'text/html'}}));assert.equal(form.status,200);assert.equal(form.headers.get('referrer-policy'),'strict-origin');
    assert.equal(f.db.prepare('SELECT status FROM newsletter_subscribers').get().status,'pending');
    const token=new URL(confirm).searchParams.get('token');
    const confirmed=await onRequest(f.context('confirm',{headers:{accept:'text/html','content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token}).toString()}));
    assert.equal(confirmed.status,200);assert.match(await confirmed.text(),/订阅已确认/);
    assert.equal(f.db.prepare('SELECT status FROM newsletter_subscribers').get().status,'active');
    assert.equal((await onRequest(f.context('confirm',{body:{token}}))).status,400);
  }finally{f.close();}
});

test('Pages routes fail closed on preview/disabled deployments and return safe errors',async()=>{
  const f=fixture();try{
    const preview=await onRequest(f.context('https://preview.example/api/newsletter/subscribe',{body:{email:'a@example.com'}}));assert.equal(preview.status,503);
    const bad=await onRequest(f.context('subscribe',{body:{email:'bad'}}));assert.equal(bad.status,400);assert.deepEqual(await bad.json(),{error:'invalid_email'});
    const get=await onRequest(f.context('subscribe',{method:'GET'}));assert.equal(get.status,404);
    f.env.NEWSLETTER_ENABLED='0';const disabled=await onRequest(f.context('subscribe',{body:{email:'reader@example.com'}}));assert.equal(disabled.status,503);assert.equal(disabled.headers.get('cache-control'),'no-store');
    assert.equal(f.db.prepare('SELECT COUNT(*) n FROM newsletter_subscribers').get().n,0);
  }finally{f.close();}
});
