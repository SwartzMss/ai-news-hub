import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import {HttpError} from '../errors.js';
import {nextOccurrence} from '../tasks/configuration.js';
import type {NewsletterGateway,DispatchInput,WorkflowRunLink} from './github.js';
import {NewsletterGatewayError} from './github.js';

type Reason='scheduled'|'retry'|'manual';
type Status='pending'|'dispatching'|'queued'|'in_progress'|'succeeded'|'failed'|'dispatch_unknown';
export interface NewsletterDispatch {
  dispatch_id:string;trigger_reason:Reason;scheduled_at:string;status:Status;attempt:number;
  dispatched_at:string|null;workflow_run_id:number|null;run_url:string|null;html_url:string|null;
  last_checked_at:string|null;error_code:string|null;finished_at:string|null;created_at:string;updated_at:string;
}
const daily={topic:'newsletter',prompts:['newsletter'],autoPublish:false,schedule:{kind:'daily' as const,time:'09:00'},timezone:'Asia/Shanghai'};
const nextDay=(after:Date)=>nextOccurrence(daily,after)!;
const local=(at:Date)=>new Date(at.getTime()+8*3600000).toISOString();
const dispatchId=(slot:Date)=>`newsletter-${local(slot).slice(0,10).replaceAll('-','')}-${local(slot).slice(11,16).replace(':','')}`;
function afterSlot(slot:Date):string {
  return local(slot).slice(11,16)==='10:00'?nextDay(slot):new Date(slot.getTime()+15*60000).toISOString();
}
function attempt(slot:Date):number{return Number(local(slot).slice(11,13))===10?4:Number(local(slot).slice(14,16))/15;}
const code=(error:unknown)=>error instanceof NewsletterGatewayError?error.code:'github_unavailable';
const definite=(error:unknown)=>error instanceof NewsletterGatewayError&&error.definitive;

export class NewsletterScheduler {
  private active?:Promise<void>;
  private controller?:AbortController;
  private stopping=false;
  constructor(private db:DatabaseSync,private gateway:NewsletterGateway,private now:()=>Date=()=>new Date()){
    // A POST may have reached GitHub before shutdown. Never replay it without reconciliation.
    db.prepare("UPDATE newsletter_dispatches SET status='dispatch_unknown',error_code='backend_restarted',updated_at=? WHERE status='dispatching'").run(now().toISOString());
  }
  state(){
    const row=this.db.prepare('SELECT enabled,next_run_at,updated_at FROM newsletter_schedule WHERE id=1').get()!;
    return {schedule:{enabled:row.enabled===1,timezone:'Asia/Shanghai',time:'09:00',next_run_at:row.next_run_at as string|null,updated_at:String(row.updated_at)},
      dispatches:this.db.prepare('SELECT * FROM newsletter_dispatches ORDER BY created_at DESC,dispatch_id DESC LIMIT 50').all() as unknown as NewsletterDispatch[]};
  }
  configure(enabled:boolean,at=this.now()){
    const before=this.state().schedule;
    const next=enabled?(before.enabled?before.next_run_at:nextDay(at)):null;
    this.db.prepare('UPDATE newsletter_schedule SET enabled=?,next_run_at=?,updated_at=? WHERE id=1').run(enabled?1:0,next,at.toISOString());
    return this.state().schedule;
  }
  async manual(at=this.now()):Promise<NewsletterDispatch>{
    if(this.stopping)throw new HttpError(503,'newsletter_unavailable');
    const active=this.db.prepare("SELECT dispatch_id FROM newsletter_dispatches WHERE status IN ('pending','dispatching','queued','in_progress','dispatch_unknown') LIMIT 1").get();
    if(active)throw new HttpError(409,'newsletter_busy');
    const recent=this.db.prepare("SELECT created_at FROM newsletter_dispatches WHERE trigger_reason='manual' ORDER BY created_at DESC LIMIT 1").get();
    if(recent&&at.getTime()-Date.parse(String(recent.created_at))<5*60000)throw new HttpError(429,'newsletter_rate_limited');
    const id=`newsletter-manual-${randomUUID()}`;
    this.insert(id,'manual',at.toISOString(),0,'pending',null,at);
    await this.tick(at);
    return this.record(id);
  }
  resolveUnknown(id:string,at=this.now()):NewsletterDispatch{
    const result=this.db.prepare("UPDATE newsletter_dispatches SET status='failed',error_code='manually_confirmed_not_started',finished_at=?,updated_at=? WHERE dispatch_id=? AND status='dispatch_unknown'").run(at.toISOString(),at.toISOString(),id);
    if(result.changes!==1)throw new HttpError(409,'newsletter_not_unknown');
    return this.record(id);
  }
  record(id:string):NewsletterDispatch{
    const row=this.db.prepare('SELECT * FROM newsletter_dispatches WHERE dispatch_id=?').get(id);
    if(!row)throw new HttpError(404,'newsletter_dispatch_not_found');
    return row as unknown as NewsletterDispatch;
  }
  async tick(at=this.now()):Promise<void>{
    if(this.stopping||this.active)return this.active;
    const controller=new AbortController();this.controller=controller;
    const work=(async()=>{
      this.queueDue(at);
      const current=this.db.prepare("SELECT * FROM newsletter_dispatches WHERE status IN ('dispatch_unknown','dispatching','queued','in_progress') ORDER BY created_at,dispatch_id LIMIT 1").get() as unknown as NewsletterDispatch|undefined;
      if(current){
        if(current.last_checked_at&&at.getTime()-Date.parse(current.last_checked_at)<30000)return;
        if(current.status==='dispatch_unknown')await this.reconcile(current,at,controller.signal);
        else if(current.workflow_run_id)await this.poll(current,at,controller.signal);
        return;
      }
      const pending=this.db.prepare("SELECT * FROM newsletter_dispatches WHERE status='pending' ORDER BY scheduled_at,dispatch_id LIMIT 1").get() as unknown as NewsletterDispatch|undefined;
      if(pending)await this.dispatch(pending,at,controller.signal);
    })();
    this.active=work.finally(()=>{this.active=undefined;this.controller=undefined;});
    return this.active;
  }
  private insert(id:string,reason:Reason,slot:string,count:number,status:Status,error:string|null,at:Date){
    const stamp=at.toISOString();
    this.db.prepare('INSERT OR IGNORE INTO newsletter_dispatches(dispatch_id,trigger_reason,scheduled_at,status,attempt,error_code,finished_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id,reason,slot,status,count,error,status==='failed'?stamp:null,stamp,stamp);
  }
  private queueDue(at:Date){
    const schedule=this.state().schedule;if(!schedule.enabled)return;
    let next=schedule.next_run_at;
    let loops=0;
    while(next&&Date.parse(next)<=at.getTime()&&loops++<50){
      const slot=new Date(next),count=attempt(slot),missed=at.getTime()-slot.getTime()>10*60000;
      this.insert(dispatchId(slot),count?'retry':'scheduled',next,count,missed?'failed':'pending',missed?'schedule_missed':null,at);
      next=afterSlot(slot);
    }
    if(next&&Date.parse(next)<=at.getTime()){
      this.insert(`newsletter-backlog-${dispatchId(new Date(next))}`,'retry',next,4,'failed','misfire_backlog_truncated',at);
      next=nextDay(at);
    }
    if(next!==schedule.next_run_at)this.db.prepare('UPDATE newsletter_schedule SET next_run_at=?,updated_at=? WHERE id=1 AND enabled=1').run(next,at.toISOString());
  }
  private saveLink(id:string,link:WorkflowRunLink,at:Date){
    this.db.prepare("UPDATE newsletter_dispatches SET status='queued',workflow_run_id=?,run_url=?,html_url=?,dispatched_at=coalesce(dispatched_at,?),error_code=NULL,updated_at=? WHERE dispatch_id=?")
      .run(link.workflowRunId,link.runUrl,link.htmlUrl,at.toISOString(),at.toISOString(),id);
  }
  private async dispatch(row:NewsletterDispatch,at:Date,signal:AbortSignal){
    this.db.prepare("UPDATE newsletter_dispatches SET status='dispatching',updated_at=? WHERE dispatch_id=? AND status='pending'").run(at.toISOString(),row.dispatch_id);
    const input:DispatchInput={dispatchId:row.dispatch_id,scheduledAt:local(new Date(row.scheduled_at)).slice(0,19)+'+08:00',triggerReason:row.trigger_reason,ref:'main'};
    try{this.saveLink(row.dispatch_id,await this.gateway.dispatch(input,signal),at);}
    catch(error){const status=definite(error)?'failed':'dispatch_unknown';
      this.db.prepare('UPDATE newsletter_dispatches SET status=?,error_code=?,finished_at=?,updated_at=? WHERE dispatch_id=?')
        .run(status,code(error),status==='failed'?at.toISOString():null,at.toISOString(),row.dispatch_id);}
  }
  private async reconcile(row:NewsletterDispatch,at:Date,signal:AbortSignal){
    try{const match=await this.gateway.findRun(row.dispatch_id,signal);
      if(match)this.saveLink(row.dispatch_id,match,at);
      else this.db.prepare('UPDATE newsletter_dispatches SET last_checked_at=?,updated_at=? WHERE dispatch_id=?').run(at.toISOString(),at.toISOString(),row.dispatch_id);
    }catch(error){this.db.prepare('UPDATE newsletter_dispatches SET last_checked_at=?,error_code=?,updated_at=? WHERE dispatch_id=?').run(at.toISOString(),code(error),at.toISOString(),row.dispatch_id);}
  }
  private async poll(row:NewsletterDispatch,at:Date,signal:AbortSignal){
    try{const remote=await this.gateway.getRun(row.workflow_run_id!,signal);
      const status:Status=remote.status==='completed'?(remote.conclusion==='success'?'succeeded':'failed'):remote.status;
      this.db.prepare('UPDATE newsletter_dispatches SET status=?,last_checked_at=?,error_code=?,finished_at=?,updated_at=? WHERE dispatch_id=?')
        .run(status,at.toISOString(),status==='failed'?`workflow_${remote.conclusion??'unknown'}`:null,remote.status==='completed'?at.toISOString():null,at.toISOString(),row.dispatch_id);
    }catch(error){this.db.prepare('UPDATE newsletter_dispatches SET last_checked_at=?,error_code=?,updated_at=? WHERE dispatch_id=?').run(at.toISOString(),code(error),at.toISOString(),row.dispatch_id);}
  }
  async close(){this.stopping=true;this.controller?.abort();await this.active?.catch(()=>{});await this.gateway.close?.();}
}
