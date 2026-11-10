import type {FastifyInstance} from 'fastify';
import type {NewsletterScheduler} from './scheduler.js';

export function registerNewsletterRoutes(app:FastifyInstance,scheduler:NewsletterScheduler){
  app.get('/newsletter',async()=>scheduler.state());
  app.put<{Body:{enabled:boolean}}>('/newsletter/schedule',{schema:{body:{type:'object',required:['enabled'],additionalProperties:false,properties:{enabled:{type:'boolean'}}}}},async request=>({schedule:scheduler.configure(request.body.enabled)}));
  app.post('/newsletter/dispatch',{schema:{body:{type:'object',additionalProperties:false}}},async(_request,reply)=>{const dispatch=await scheduler.manual();reply.code(202);return {dispatch};});
  app.post<{Params:{dispatchId:string};Body:{confirmNotStarted:true}}>('/newsletter/dispatches/:dispatchId/resolve',{schema:{params:{type:'object',required:['dispatchId'],properties:{dispatchId:{type:'string',minLength:1,maxLength:128}},additionalProperties:false},body:{type:'object',required:['confirmNotStarted'],properties:{confirmNotStarted:{const:true}},additionalProperties:false}}},async request=>({dispatch:scheduler.resolveUnknown(request.params.dispatchId)}));
}
