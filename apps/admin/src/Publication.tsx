import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
interface State {
  contentHash: string;
  status: string;
  configured: boolean;
  target: { repository: string; branch: string } | null;
  publications: {
    id: string;
    status: string;
    commit_sha: string | null;
    remote_url: string | null;
    error_code: string | null;
    attempts: number;
  }[];
}
export function Publication({
  api,
  reportId,
}: {
  api: Client;
  reportId: string;
}) {
  const base = `/news/reports/${encodeURIComponent(reportId)}`;
  const load = useCallback(
    (signal: AbortSignal) => api<State>(base + "/publication", signal),
    [api, base],
  );
  const state = usePolling(load);
  const [current, setCurrent] = useState<State>();
  const data = current ?? state.data;
  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const pending = useRef(false);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  useEffect(() => {
    setCurrent(undefined);
  }, [state.data]);
  async function action(kind: "approve" | "publish") {
    if (pending.current || !data) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api(
        base + "/" + kind,
        controller.signal,
        kind === "approve"
          ? { contentHash: data.contentHash, confirm: true }
          : {},
      );
      setCurrent(await load(controller.signal));
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>人工审核与 GitHub 归档</h2>
      {state.error ? (
        <p className="error" role="alert">
          {errorText(state.error)}
        </p>
      ) : null}
      {error ? (
        <p className="error" role="alert">
          {errorText(error)}
        </p>
      ) : null}
      {!data ? (
        <p>正在读取发布状态…</p>
      ) : (
        <>
          <p className="notice">
            {data.status === "validated"
              ? "待人工批准"
              : data.status === "published"
                ? "已归档到 GitHub"
                : "已人工批准，尚未归档"}{" "}
            · 原始来源仍标记 source_only，不代表独立事实证实。
          </p>
          {data.target ? (
            <p>
              {data.target.repository} · {data.target.branch}
            </p>
          ) : (
            <p>尚未配置 GitHub 目标，归档功能关闭。</p>
          )}
          {data.status === "validated" ? (
            <>
              <label>
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />{" "}
                我已核对来源、时间、摘要与推断，允许发布此版本。
              </label>
              <p>
                <button
                  disabled={!confirmed || busy}
                  onClick={() => action("approve")}
                >
                  批准此版本
                </button>
              </p>
            </>
          ) : (
            <button
              disabled={
                !data.configured ||
                busy ||
                data.publications.some((p) => p.status === "publishing")
              }
              onClick={() => action("publish")}
            >
              {data.status === "published" ? "核对归档记录" : "归档到 GitHub"}
            </button>
          )}
          <p className="muted">
            批准不会自动归档；失败后可显式重试，同一内容不产生重复 Commit。
          </p>
          {data.publications.map((p) => (
            <div key={p.id}>
              <p>
                发布状态：{p.status} · 尝试 {p.attempts} 次
              </p>
              {p.error_code && (
                <p className="error">{p.error_code} · 可重试归档</p>
              )}
              {p.commit_sha && (
                <a
                  className="commit-link"
                  href={p.remote_url ?? undefined}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {p.commit_sha}
                </a>
              )}
            </div>
          ))}
        </>
      )}
    </section>
  );
}
