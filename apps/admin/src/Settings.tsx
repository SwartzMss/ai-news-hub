import {useEffect,useMemo,useRef,useState} from 'react';
import type {SettingsUpdate,SettingsView} from '../../../packages/shared/src/settings';
import {ApiError,errorText,type Client} from './api';
export function Settings({api,onCredentialChanged}:{api:Client;onCredentialChanged:(token:string)=>void}) {
 const [data,setData]=useState<SettingsView>(),[error,setError]=useState<unknown>(),[saved,setSaved]=useState(false),[busy,setBusy]=useState(false),[token,setToken]=useState(''),[clearToken,setClearToken]=useState(false);
 const [current,setCurrent]=useState(''),[password,setPassword]=useState(''),[confirm,setConfirm]=useState(''),[passwordBusy,setPasswordBusy]=useState(false);
 const pending=useRef(false),passwordPending=useRef(false),controller=useMemo(()=>new AbortController(),[]);
 useEffect(()=>()=>controller.abort(),[controller]);
 useEffect(()=>{const c=new AbortController();void api<SettingsView>('/settings',c.signal).then(value=>{if(!c.signal.aborted)setData(value);}).catch(cause=>{if(!c.signal.aborted)setError(cause);});return()=>c.abort();},[api]);
 async function save(event:React.FormEvent){
  event.preventDefault();if(!data||pending.current)return;pending.current=true;setBusy(true);setSaved(false);setError(undefined);
  const body:SettingsUpdate={revision:data.revision,logLevel:data.logLevel,codex:data.codex,execution:data.execution,github:{enabled:data.github.enabled,repository:data.github.repository,branch:data.github.branch,...(token?{token}:clearToken?{clearToken:true}:{})}};
  try{const result=await api<SettingsView>('/settings',controller.signal,body,'PUT');if(!controller.signal.aborted){setData(result);setToken('');setClearToken(false);setSaved(true);}}catch(cause){if(!controller.signal.aborted)setError(cause);}finally{pending.current=false;if(!controller.signal.aborted)setBusy(false);}
 }
 async function rotate(event:React.FormEvent){
  event.preventDefault();if(passwordPending.current)return;setError(undefined);setSaved(false);
  if(password!==confirm){setError(new ApiError(400,'password_mismatch'));return;}
  passwordPending.current=true;setPasswordBusy(true);
  try{const result=await api<{token:string}>('/auth/password',controller.signal,{currentPassword:current,newPassword:password});if(!controller.signal.aborted)onCredentialChanged(result.token);}catch(cause){if(!controller.signal.aborted)setError(cause);}finally{passwordPending.current=false;if(!controller.signal.aborted)setPasswordBusy(false);}
 }
 const disabled=busy||passwordBusy;
 return <><div className="eyebrow">管理配置</div><h1>系统设置</h1><p className="muted">设置保存到数据库，无需维护环境变量。任务或归档执行中请等待完成再保存。</p>
  {error?<p role="alert" className="error">{errorText(error)}</p>:null}{saved?<p role="status" className="notice">设置已保存并生效。</p>:null}
  {!data?<p>正在读取设置…</p>:<form className="settings-form" onSubmit={save}>
   <fieldset className="panel" disabled={disabled}><legend>Codex 与执行</legend>
    <label htmlFor="codex-binary">Codex 可执行文件</label><input id="codex-binary" value={data.codex.binary} onChange={e=>setData({...data,codex:{...data.codex,binary:e.target.value}})} required/>
    <label htmlFor="codex-model">模型</label><input id="codex-model" value={data.codex.model} onChange={e=>setData({...data,codex:{...data.codex,model:e.target.value}})} maxLength={128} placeholder="留空沿用 Codex 配置"/>
    <p className="muted">Codex 账户登录仍由服务主机管理；这里设置路径和模型。</p>
    <label htmlFor="run-timeout">每轮超时（毫秒）</label><input id="run-timeout" type="number" min={1000} max={3600000} value={data.execution.timeoutMs} onChange={e=>setData({...data,execution:{...data.execution,timeoutMs:Number(e.target.value)}})} required/>
    <label htmlFor="concurrency">并发数</label><input id="concurrency" type="number" min={1} max={4} value={data.execution.concurrency} onChange={e=>setData({...data,execution:{...data.execution,concurrency:Number(e.target.value)}})} required/>
    <label htmlFor="queue-size">最大等待队列</label><input id="queue-size" type="number" min={1} max={100} value={data.execution.maxQueue} onChange={e=>setData({...data,execution:{...data.execution,maxQueue:Number(e.target.value)}})} required/>
    <label htmlFor="log-level">日志级别</label><select id="log-level" value={data.logLevel} onChange={e=>setData({...data,logLevel:e.target.value as SettingsView['logLevel']})}>{['fatal','error','warn','info','debug','trace','silent'].map(v=><option key={v}>{v}</option>)}</select>
   </fieldset>
   <fieldset className="panel" disabled={disabled}><legend>GitHub 归档</legend>
    <label className="check"><input type="checkbox" checked={data.github.enabled} onChange={e=>setData({...data,github:{...data.github,enabled:e.target.checked}})}/>启用 GitHub 归档</label>
    <label htmlFor="github-repository">GitHub 仓库</label><input id="github-repository" value={data.github.repository} onChange={e=>setData({...data,github:{...data.github,repository:e.target.value}})} placeholder="owner/repository" required={data.github.enabled}/>
    <label htmlFor="github-branch">GitHub 分支</label><input id="github-branch" value={data.github.branch} onChange={e=>setData({...data,github:{...data.github,branch:e.target.value}})} placeholder="reports" required={data.github.enabled}/>
    <label htmlFor="github-token">GitHub Token</label><input id="github-token" type="password" value={token} onChange={e=>{setToken(e.target.value);setClearToken(false);}} autoComplete="off" disabled={clearToken}/>
    <p className="muted">{data.github.tokenConfigured?'已配置；留空保留原 Token。':'尚未配置 Token。'}只授予目标仓库所需的内容读写权限。</p>
    <label className="check"><input type="checkbox" checked={clearToken} onChange={e=>{setClearToken(e.target.checked);setToken('');}}/>清除已存 Token</label>
    <p className="muted">保存配置不会批准或发布日报，归档仍需单独操作。</p>
   </fieldset>
   <button disabled={disabled}>保存设置</button>
  </form>}
  <section className="panel settings-form"><h2>管理员密码</h2><form onSubmit={rotate}>
   <label htmlFor="current-password">当前密码或旧 Token</label><input id="current-password" type="password" autoComplete="current-password" required value={current} onChange={e=>setCurrent(e.target.value)} disabled={disabled}/>
   <label htmlFor="new-password">新管理员密码</label><input id="new-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={password} onChange={e=>setPassword(e.target.value)} disabled={disabled}/>
   <label htmlFor="repeat-password">确认新密码</label><input id="repeat-password" type="password" autoComplete="new-password" minLength={12} maxLength={128} required value={confirm} onChange={e=>setConfirm(e.target.value)} disabled={disabled}/>
   <p className="muted">更新密码会使其他会话及旧 Token 失效，当前页面使用新会话。</p><button disabled={disabled}>更新管理员密码</button>
  </form></section>
 </>;
}
