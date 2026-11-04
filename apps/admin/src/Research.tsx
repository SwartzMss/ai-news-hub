import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, errorText, type Client } from "./api";
import { Icon } from "./ui";

export function Research({
  api,
  taskId,
  runId,
  disabled,
  onSubmitted,
}: {
  api: Client;
  taskId: string;
  runId?: string;
  disabled: boolean;
  onSubmitted: (runId: string) => void;
}) {
  const [topic, setTopic] = useState("");
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const pending = useRef(false);
  const request = useRef<
    | {
        idempotencyKey: string;
        input: string;
        topic?: string;
        finalize?: boolean;
      }
    | undefined
  >(undefined);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  async function submit(finalize = false) {
    if (pending.current || disabled) return;
    if (!request.current && (!input.trim() || (!runId && !topic.trim())))
      return;
    request.current ??= {
      idempotencyKey: "admin-" + crypto.randomUUID(),
      input,
      ...(runId ? { finalize } : { topic }),
    };
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      const result = await api<{ run: { id: string } }>(
        runId
          ? `/runs/${encodeURIComponent(runId)}/turns`
          : `/tasks/${encodeURIComponent(taskId)}/runs`,
        controller.signal,
        request.current,
      );
      if (controller.signal.aborted) return;
      request.current = undefined;
      setInput("");
      onSubmitted(result.run.id);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause);
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500
      )
        request.current = undefined;
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  const locked = busy || !!request.current;
  return (
    <section
      className={`panel research ${runId ? "continuation-composer" : ""}`}
    >
      <div className="composer-heading">
        <span className="composer-symbol">
          <Icon name={runId ? "message" : "spark"} size={20} />
        </span>
        <div>
          <h2>{runId ? "继续研究" : "按主题开始研究"}</h2>
          <p>
            {runId
              ? "补充问题，或把当前结果整理成日报。"
              : "告诉 Codex 你关心的主题和研究要求。"}
          </p>
        </div>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        {!runId && (
          <div className="field">
            <label htmlFor="research-topic">研究主题</label>
            <input
              id="research-topic"
              maxLength={200}
              required
              value={topic}
              disabled={locked || disabled}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="例如：AI 开源模型的最新进展"
            />
          </div>
        )}
        <div className="field">
          <label htmlFor="research-prompt">
            {runId ? "下一轮 prompt" : "初始 prompt"}
          </label>
          <textarea
            id="research-prompt"
            rows={runId ? 4 : 5}
            maxLength={8000}
            required
            disabled={locked || disabled}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={
              runId
                ? "进一步筛选、补查原文，或说明最终日报的整理要求…"
                : "搜索最近三天的官方公告，优先原始来源。先列出候选新闻与链接，再逐步补查。"
            }
          />
          <span className="input-counter">
            {input.length.toLocaleString()} / 8,000
          </span>
        </div>
        {error ? (
          <p role="alert" className="error">
            {errorText(error)}
          </p>
        ) : null}
        {request.current && !busy ? (
          <>
            <p className="notice">
              上次请求结果尚未确认。重试会复用原请求，本页暂时锁定输入。
            </p>
            <button
              type="button"
              disabled={disabled}
              onClick={() => void submit()}
            >
              重试原请求
            </button>
          </>
        ) : (
          <div className="research-actions">
            <button
              disabled={
                busy || disabled || !input.trim() || (!runId && !topic.trim())
              }
            >
              <Icon name={runId ? "arrow" : "spark"} size={17} />
              {busy ? "正在提交…" : runId ? "继续研究" : "开始研究"}
            </button>
            {runId && (
              <button
                type="button"
                className="quiet"
                disabled={busy || disabled || !input.trim()}
                onClick={() => void submit(true)}
              >
                <Icon name="file" size={17} />
                生成待审核日报
              </button>
            )}
          </div>
        )}
      </form>
      <p className="composer-note">
        <Icon name="info" size={14} />
        <span>每轮使用 Codex 额度。生成日报后，核对内容再批准归档。</span>
      </p>
    </section>
  );
}
