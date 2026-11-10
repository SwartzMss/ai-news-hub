import {useCallback,useState} from 'react';
import {errorText,type Client} from './api';
import {usePolling} from './usePolling';
import {PageHeading} from './ui';

interface Dispatch {
  dispatch_id:string;trigger_reason:'scheduled'|'retry'|'manual';scheduled_at:string;
  status:'pending'|'dispatching'|'queued'|'in_progress'|'succeeded'|'failed'|'dispatch_unknown';
  attempt:number;workflow_run_id:number|null;html_url:string|null;error_code:string|null;finished_at:string|null;
}
interface NewsletterState {schedule:{enabled:boolean;timezone:string;time:string;next_run_at:string|null};dispatches:Dispatch[]}
const statusText:Record<Dispatch['status'],string>={pending:'待触发',dispatching:'提交中',queued:'已排队',in_progress:'运行中',succeeded:'工作流成功',failed:'失败',dispatch_unknown:'触发结果待确认'};
const reasonText:Record<Dispatch['trigger_reason'],string>={scheduled:'定时',retry:'窗口重试',manual:'手动'};
function time(value:string|null){return value?new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):'—';}

export function Newsletter({api}:{api:Client}){
  const [revision,setRevision]=useState(0),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const load=useCallback((signal:AbortSignal)=>api<NewsletterState>('/newsletter',signal),[api,revision]);
  const {data,error}=usePolling(load,5000);
  async function change(enabled:boolean){setBusy(true);setMessage('');try{await api('/newsletter/schedule',AbortSignal.timeout(10000),{enabled},'PUT');setRevision(n=>n+1);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  async function manual(){if(!window.confirm('立即触发邮件发送工作流？订阅系统会按当天快照和幂等记录处理。'))return;
    setBusy(true);setMessage('');try{await api('/newsletter/dispatch',AbortSignal.timeout(15000),{});setRevision(n=>n+1);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  async function resolve(id:string){if(!window.confirm('请先在 GitHub Actions 确认此 dispatch 未运行。确认解除待核对状态？'))return;
    setBusy(true);setMessage('');try{await api(`/newsletter/dispatches/${encodeURIComponent(id)}/resolve`,AbortSignal.timeout(10000),{confirmNotStarted:true});setRevision(n=>n+1);}catch(e){setMessage(errorText(e));}finally{setBusy(false);}}
  const active=data?.dispatches.some(d=>['pending','dispatching','queued','in_progress','dispatch_unknown'].includes(d.status));
  return <div className="newsletter-page">
    <PageHeading title="邮件发送" description="由本机后台按北京时间安排 GitHub 工作流；邮件投递仍由 Cloudflare 与 Resend 处理。"/>
    {(message||!!error)&&<p role="alert" className="error">{message||(error?errorText(error):'')}</p>}
    <section className="newsletter-card" aria-label="发送计划"><div><h2>每日计划</h2><p>北京时间 09:00 起，每 15 分钟检查一次，最后一次为 10:00。</p></div>
      <dl><div><dt>状态</dt><dd>{data?.schedule.enabled?'已启用':'已暂停'}</dd></div><div><dt>下次计划</dt><dd>{time(data?.schedule.next_run_at??null)}</dd></div><div><dt>上次执行</dt><dd>{time(data?.dispatches[0]?.scheduled_at??null)}</dd></div></dl>
      <div className="newsletter-actions"><button disabled={busy||!data} onClick={()=>void change(!data!.schedule.enabled)}>{data?.schedule.enabled?'暂停计划':'启用计划'}</button><button disabled={busy||!!active} onClick={()=>void manual()}>立即触发</button></div>
      <p className="newsletter-note">工作流成功只表示发送脚本运行成功；实际 sent、failed、pending、waiting 数量请在 GitHub Run 日志或 D1 / Resend 查看。</p>
    </section>
    <section className="newsletter-history"><h2>执行记录</h2>{!data?.dispatches.length?<p>暂无记录。</p>:<div className="newsletter-table-scroll"><table><thead><tr><th>计划时间</th><th>来源</th><th>状态</th><th>GitHub Run</th><th>错误</th></tr></thead><tbody>{data.dispatches.map(d=><tr key={d.dispatch_id}><td>{time(d.scheduled_at)}<small>{d.dispatch_id}</small></td><td>{reasonText[d.trigger_reason]}</td><td>{statusText[d.status]}</td><td>{d.html_url?<a href={d.html_url} target="_blank" rel="noopener noreferrer">#{d.workflow_run_id} ↗</a>:'—'}</td><td>{d.error_code??'—'}{d.status==='dispatch_unknown'&&<button disabled={busy} onClick={()=>void resolve(d.dispatch_id)}>确认未运行后解除</button>}</td></tr>)}</tbody></table></div>}</section>
  </div>;
}
