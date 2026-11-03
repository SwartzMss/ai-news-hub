import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, errorText, type Client } from './api';

export function Research({ api, taskId, runId, disabled, onSubmitted }: {
  api: Client; taskId: string; runId?: string; disabled: boolean; onSubmitted: (runId: string) => void;
}) {
  const [topic,setTopic] = useState('');
  const [input,setInput] = useState('');
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState<unknown>();
  const pending = useRef(false);
  const request = useRef<{idempotencyKey:string;input:string;topic?:string;finalize?:boolean} | undefined>(undefined);
  const controller = useMemo(()=>new AbortController(),[]);
  useEffect(()=>()=>controller.abort(),[controller]);
  async function submit(finalize = false) {
    if (pending.current || disabled) return;
    if (!request.current && (!input.trim() || !runId && !topic.trim())) return;
    request.current ??= {idempotencyKey:'admin-'+crypto.randomUUID(),input,...(runId ? {finalize} : {topic})};
    pending.current = true; setBusy(true); setError(undefined);
    try {
      const result = await api<{run:{id:string}}>(runId ? `/runs/${encodeURIComponent(runId)}/turns` : `/tasks/${encodeURIComponent(taskId)}/runs`,controller.signal,request.current);
      if (controller.signal.aborted) return;
      request.current = undefined; setInput(''); onSubmitted(result.run.id);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause);
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500) request.current = undefined;
    } finally { pending.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  const locked = busy || !!request.current;
  return <section className="panel research">
    <h2>{runId ? '继续研究' : '按主题开始研究'}</h2>
    <p className="muted">{runId ? '补充筛选条件、要求核实来源，或生成待审核日报。每一轮继续同一个 Thread。' : '由 Codex 搜索原始来源。你可以在后续多轮 prompt 中补查和调整。'}</p>
    <form onSubmit={event=>{event.preventDefault();void submit();}}>
      {!runId && <><label htmlFor="research-topic">研究主题</label><input id="research-topic" maxLength={200} required value={topic} disabled={locked || disabled} onChange={e=>setTopic(e.target.value)} placeholder="例如：AI 开源模型"/></>}
      <label htmlFor="research-prompt">{runId ? '下一轮 prompt' : '初始 prompt'}</label>
      <textarea id="research-prompt" rows={4} maxLength={8000} required disabled={locked || disabled} value={input} onChange={e=>setInput(e.target.value)} placeholder={runId ? '例如：只保留最近三天的官方公告，补充原文依据' : '例如：搜索最近三天的 AI 新闻，优先原始公告，先列出候选与来源'}/>
      {error ? <p role="alert" className="error">{errorText(error)}</p> : null}
      {request.current && !busy ? <><p className="notice">上次请求结果尚未确认。重试会复用原请求，避免重复消耗额度；本页暂时锁定输入。</p><button type="button" disabled={disabled} onClick={()=>void submit()}>重试原请求</button></> : <div className="research-actions">
        <button disabled={busy || disabled || !input.trim() || !runId && !topic.trim()}>{busy ? '正在提交…' : runId ? '继续研究' : '开始研究'}</button>
        {runId && <button type="button" className="quiet" disabled={busy || disabled || !input.trim()} onClick={()=>void submit(true)}>生成待审核日报</button>}
      </div>}
    </form>
    <p className="muted">每轮调用会消耗 Codex 额度。生成日报后，本 Run 的结果固定；审核通过后才能归档。</p>
  </section>;
}
