import type {FastifyInstance,FastifyRequest} from 'fastify';
import {HttpError} from '../errors.js';
import type {AuthStore} from './store.js';

const password={type:'string',minLength:1,maxLength:256};
const body=(properties:Record<string,unknown>)=>({body:{type:'object',additionalProperties:false,required:Object.keys(properties),properties}});
function localOrigin(request:FastifyRequest):void {
  const host=request.headers.host??'';
  if(!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?$/.test(host))throw new HttpError(403,'origin_forbidden');
  const origin=request.headers.origin;
  if(origin!==undefined && origin!==`${request.protocol}://${host}`)throw new HttpError(403,'origin_forbidden');
  if(request.headers['sec-fetch-site']==='cross-site')throw new HttpError(403,'origin_forbidden');
}
export function registerAuthRoutes(app:FastifyInstance,store:AuthStore):void {
  app.addHook('onRequest',async(request,reply)=>{reply.header('cache-control','no-store');localOrigin(request);});
  app.get('/auth/status',async()=>store.status(true));
  app.post<{Body:{setupToken:string;password:string}}>('/auth/setup',{schema:body({setupToken:{type:'string',minLength:1,maxLength:128},password})},async(request,reply)=>{const result=await store.setup(request.body.setupToken,request.body.password);reply.code(201);return result;});
  app.post<{Body:{password:string}}>('/auth/login',{schema:body({password})},async request=>store.login(request.body.password));
}
export function registerCredentialRoutes(app:FastifyInstance,store:AuthStore):void {
  app.post('/auth/logout',{schema:body({})},async request=>{store.logout(request.headers.authorization!.slice(7));return {ok:true};});
  app.post<{Body:{currentPassword:string;newPassword:string}}>('/auth/password',{schema:body({currentPassword:password,newPassword:password})},async request=>store.changePassword(request.body.currentPassword,request.body.newPassword));
}
