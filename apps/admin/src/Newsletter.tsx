import {useCallback,useEffect,useState} from 'react';
import {errorText,type Client} from './api';
import {usePolling} from './usePolling';
import {PageHeading} from './ui';

interface NewsletterState {schedule:{enabled:boolean;time:string}}

export function Newsletter({api}:{api:Client}){
  const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');
  const [draftTime,setDraftTime]=useState('09:00');
  const load=useCallback((signal:AbortSignal)=>api<NewsletterState>('/newsletter',signal),[api,revision]);
  const {data,error}=usePolling(load,5000);

  useEffect(()=>{if(data?.schedule.time)setDraftTime(data.schedule.time);},[data?.schedule.time]);

  async function save(enabled:boolean){
    if(!data||busy)return;
    if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(draftTime)){
      setMessage('请选择有效的发送时间。');
      return;
    }
    if(enabled===data.schedule.enabled&&draftTime===data.schedule.time)return;
    setBusy(true);
    setMessage('');
    try{
      await api('/newsletter/schedule',AbortSignal.timeout(10000),{enabled,time:draftTime},'PUT');
      setRevision(n=>n+1);
    }catch(e){setMessage(errorText(e));}
    finally{setBusy(false);}
  }

  return <div className="newsletter-page">
    <PageHeading title="邮件发送"/>
    {(message||!!error)&&<p role="alert" className="error">{message||(error?errorText(error):'')}</p>}
    <section className="newsletter-card" aria-label="邮件发送设置">
      <div className="newsletter-field">
        <label htmlFor="newsletter-start-time">发送时间（北京时间）</label>
        <input id="newsletter-start-time" type="time" step="60" value={draftTime} disabled={busy||!data}
          onChange={event=>setDraftTime(event.target.value)}
          onBlur={event=>{if(event.relatedTarget?.getAttribute('role')!=='switch')void save(data?.schedule.enabled??false);}}/>
      </div>
      <div className="newsletter-toggle-row">
        <span>每日发送</span>
        <button type="button" role="switch" aria-label="每日发送" aria-checked={data?.schedule.enabled??false}
          className="newsletter-switch" disabled={busy||!data||!draftTime}
          onClick={()=>void save(!data!.schedule.enabled)}><span aria-hidden="true"/></button>
      </div>
    </section>
  </div>;
}
