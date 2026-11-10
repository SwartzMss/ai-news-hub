import {githubHttpClient,githubText,type GitHubFetch} from '../publish/http.js';

const repository='SwartzMss/ai-news-hub';
const api=`https://api.github.com/repos/${repository}`;
const web=`https://github.com/${repository}`;
export interface WorkflowRunLink {workflowRunId:number;runUrl:string;htmlUrl:string}
export interface WorkflowRunStatus {status:'queued'|'in_progress'|'completed';conclusion:string|null}
export interface DispatchInput {dispatchId:string;scheduledAt:string;triggerReason:'scheduled'|'retry'|'manual';ref:'main'}
export interface NewsletterGateway {
  dispatch(input:DispatchInput,signal:AbortSignal):Promise<WorkflowRunLink>;
  getRun(id:number,signal:AbortSignal):Promise<WorkflowRunStatus>;
  findRun(dispatchId:string,signal:AbortSignal):Promise<WorkflowRunLink|null>;
  close?():Promise<void>;
}
export class NewsletterGatewayError extends Error {
  constructor(readonly code:string,readonly definitive:boolean){super(code);}
}
function link(id:number):WorkflowRunLink {
  if(!Number.isSafeInteger(id)||id<1)throw new NewsletterGatewayError('github_invalid_response',false);
  return {workflowRunId:id,runUrl:`${api}/actions/runs/${id}`,htmlUrl:`${web}/actions/runs/${id}`};
}
export class GitHubNewsletterGateway implements NewsletterGateway {
  private http;
  constructor(private token:()=>string|undefined,fetcher?:GitHubFetch){this.http=fetcher?{fetcher,close:async()=>{}}:githubHttpClient();}
  async close(){await this.http.close();}
  private async request(path:string,signal:AbortSignal,body?:unknown):Promise<unknown>{
    const secret=this.token();
    if(!secret)throw new NewsletterGatewayError('newsletter_token_missing',true);
    const combined=AbortSignal.any([signal,AbortSignal.timeout(10000)]);
    let response:Awaited<ReturnType<GitHubFetch>>;
    try{
      response=await this.http.fetcher(`${api}/${path}`,{method:body?'POST':'GET',redirect:'error',signal:combined,
        headers:{authorization:`Bearer ${secret}`,accept:'application/vnd.github+json','content-type':'application/json','x-github-api-version':'2026-03-10','user-agent':'AI-News-Hub/0.1'},
        ...(body?{body:JSON.stringify(body)}:{})});
    }catch{throw new NewsletterGatewayError(combined.aborted?'github_timeout':'github_unavailable',false);}
    if(!response.ok){await response.body?.cancel();throw new NewsletterGatewayError(`github_http_${response.status}`,!body||[400,401,403,404,422].includes(response.status));}
    if(body&&response.status!==200){await response.body?.cancel();throw new NewsletterGatewayError('github_dispatch_unconfirmed',false);}
    try{return JSON.parse(await githubText(response));}catch{throw new NewsletterGatewayError('github_invalid_response',false);}
  }
  async dispatch(input:DispatchInput,signal:AbortSignal):Promise<WorkflowRunLink>{
    const data=await this.request('actions/workflows/newsletter.yml/dispatches?return_run_details=true',signal,{ref:'main',inputs:{dispatch_id:input.dispatchId,scheduled_at:input.scheduledAt,trigger_reason:input.triggerReason}}) as {workflow_run_id?:number};
    return link(data?.workflow_run_id??NaN);
  }
  async getRun(id:number,signal:AbortSignal):Promise<WorkflowRunStatus>{
    const data=await this.request(`actions/runs/${id}`,signal) as {id?:number;status?:string;conclusion?:string|null};
    if(data?.id!==id||!['pending','requested','waiting','queued','in_progress','completed'].includes(String(data.status)))throw new NewsletterGatewayError('github_invalid_response',false);
    return {status:['pending','requested','waiting'].includes(String(data.status))?'queued':data.status as WorkflowRunStatus['status'],conclusion:data.conclusion??null};
  }
  async findRun(dispatchId:string,signal:AbortSignal):Promise<WorkflowRunLink|null>{
    const data=await this.request('actions/workflows/newsletter.yml/runs?event=workflow_dispatch&per_page=100',signal) as {workflow_runs?:{id?:number;display_title?:string}[]};
    if(!Array.isArray(data?.workflow_runs))throw new NewsletterGatewayError('github_invalid_response',false);
    const matches=data.workflow_runs.filter(row=>row.display_title===`Newsletter ${dispatchId}`);
    if(matches.length>1)throw new NewsletterGatewayError('github_run_ambiguous',false);
    return matches.length?link(matches[0]!.id!):null;
  }
}
