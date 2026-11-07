import {handleSubscribe,handleConfirm,handleUnsubscribe} from '../../../newsletter/subscriptions.js';
import {sendDigest} from '../../../newsletter/digest.js';
import {getConfig,requireCanonical,json,page,NewsletterError,type NewsletterContext} from '../../../newsletter/runtime.js';
export async function onRequest(context: NewsletterContext): Promise<Response> {
  try {
    requireCanonical(context,getConfig(context.env));
    const action=new URL(context.request.url).pathname.replace(/\/$/,'').split('/').at(-1);
    if(action==='subscribe'&&context.request.method==='POST')return await handleSubscribe(context);
    if(action==='confirm'&&['GET','POST'].includes(context.request.method))return await handleConfirm(context);
    if(action==='unsubscribe'&&['GET','POST'].includes(context.request.method))return await handleUnsubscribe(context);
    if(action==='send'&&context.request.method==='POST')return await sendDigest(context);
    return json({error:'not_found'},404);
  }catch(error){const safe=error instanceof NewsletterError?error:new NewsletterError('newsletter_unavailable',503);return context.request.headers.get('accept')?.includes('text/html')?page(safe.code==='invalid_token'?'链接已失效':'暂时无法完成操作',safe.code==='invalid_token'?'链接已失效，请重新订阅。':'请稍后再试。',undefined,safe.status):json({error:safe.code},safe.status);}
}
