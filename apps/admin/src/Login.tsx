import {useEffect,useMemo,useState} from 'react';
import type {AuthStatus} from '../../../packages/shared/src/settings';
import {ApiError,client,errorText} from './api';
export function Login({onConnected,error:sessionError}:{onConnected:(token:string)=>void;error?:unknown}) {
 const [status,setStatus]=useState<AuthStatus>(),[error,setError]=useState<unknown>(),[input,setInput]=useState(''),[confirm,setConfirm]=useState(''),[busy,setBusy]=useState(false),[attempt,setAttempt]=useState(0);
 const controller=useMemo(()=>new AbortController(),[]);useEffect(()=>()=>controller.abort(),[controller]);
 useEffect(()=>{
  const pending=new AbortController();setStatus(undefined);setError(undefined);
  void client('',()=>{})<AuthStatus>('/auth/status',pending.signal).then(value=>{if(!['setup','password','token'].includes(value.mode)||typeof value.initialized!=='boolean'||value.mode==='setup'&&typeof value.setupToken!=='string')throw new ApiError(502,'invalid_response');if(!pending.signal.aborted)setStatus(value);}).catch(cause=>{if(!pending.signal.aborted)setError(cause);});
  return ()=>pending.abort();
 },[attempt]);
 const setup=status?.mode==='setup',legacy=status?.mode==='token';
 async function connect(event:React.FormEvent){
  event.preventDefault();if(busy||!status)return;setError(undefined);
  if(setup&&input!==confirm){setError(new ApiError(400,'password_mismatch'));return;}
  setBusy(true);
  try {
   const result=await client('',()=>{})<{token:string}>(setup?'/auth/setup':'/auth/login',controller.signal,setup?{setupToken:status.setupToken,password:input}:{password:legacy?input.trim():input});
   if(!result.token)throw new ApiError(502,'invalid_response');
   if(!controller.signal.aborted)onConnected(result.token);
  }catch(cause){if(!controller.signal.aborted)setError(cause);}finally{if(!controller.signal.aborted)setBusy(false);}
 }
 return <main className="login"><div className="eyebrow">任务与执行</div><h1>{setup?'初始化管理员':'连接你的新闻后台'}</h1>
  <p className="muted">{setup?'设置你的管理员密码，即可开始使用。':'查看任务、执行记录与待审核日报。'}</p>
  {!status?<><p role="status">正在读取登录状态…</p>{error?<button onClick={()=>setAttempt(n=>n+1)}>重新连接</button>:null}</>:<form onSubmit={connect}>
   <label htmlFor="credential">{setup?'设置密码':legacy?'管理 Token':'管理员密码'}</label><input id="credential" type="password" value={input} onChange={e=>setInput(e.target.value)} autoComplete={setup?'new-password':'current-password'} minLength={setup?12:undefined} maxLength={legacy?256:128} required disabled={busy}/>
   {setup&&<><label htmlFor="confirm-password">确认密码</label><input id="confirm-password" type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} autoComplete="new-password" minLength={12} maxLength={128} required disabled={busy}/></>}
   <button disabled={busy}>{busy?'正在连接…':setup?'初始化并进入后台':'连接后台'}</button>
  </form>}
  {error||sessionError?<p role="alert" className="error">{errorText(error??sessionError)}</p>:null}
  <p className="muted">{setup?'密码至少 12 个字符，确认后即可进入后台。':legacy?'旧 Token 可继续登录，请在系统设置中改设管理员密码。':'会话仅保存在当前页面内存，刷新后重新登录。'}</p>
 </main>;
}
