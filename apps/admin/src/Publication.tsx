import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { Icon } from "./ui";
interface State {
  approval?: { approval_kind?: "manual" | "automatic" } | null;
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
    repository: string | null;
    branch: string | null;
  }[];
}
export function Publication({
  api,
  reportId,
  onDeleted,
}: {
  api: Client;
  reportId: string;
  onDeleted?: () => void;
}) {
  const base = `/news/reports/${encodeURIComponent(reportId)}`;
  const load = useCallback(
    (signal: AbortSignal) => api<State>(base + "/publication", signal),
    [api, base],
  );
  const state = usePolling(load);
  const [current, setCurrent] = useState<State>();
  const data = current ?? state.data;
  const currentTargetPublished =
    !!data?.target &&
    data.publications.some(
      (p) =>
        p.status === "succeeded" &&
        p.repository === data.target?.repository &&
        p.branch === data.target?.branch,
    );

  const [confirmed, setConfirmed] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const [deleteConfirmed, setDeleteConfirmed] = useState(false);
  const [deleted, setDeleted] = useState(false);
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
      if (kind === "publish" && currentTargetPublished) {
        // This is a read-only refresh, even if server configuration changed since rendering.
        setCurrent(await load(controller.signal));
        return;
      }
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
  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    try {
      await api(base, controller.signal, {confirm:true}, "DELETE");
      setDeleted(true);
      onDeleted?.();
    } catch (cause) { if (!controller.signal.aborted) setError(cause); }
    finally { pending.current = false; if (!controller.signal.aborted) setBusy(false); }
  }
  if (deleted) return <p role="status">日报已删除</p>;
  return (
    <section className="panel approval-panel">
      <div className="approval-title">
        <span className="section-symbol">
          <Icon name="shield" size={19} />
        </span>
        <h2>发布记录</h2>
      </div>
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
              : currentTargetPublished
                ? "当前目标已归档到 GitHub"
                : data.approval?.approval_kind === "automatic"
                  ? "已按任务配置自动授权，等待归档"
                  : "已人工批准，当前目标尚未归档"}{" "}
          </p>
          {data.target ? (
            <p>
              {data.target.repository} · {data.target.branch}
            </p>
          ) : (
            <p>
              尚未配置 GitHub 目标，归档功能关闭。
              <a href="#/settings/github">配置 GitHub 归档</a>
            </p>
          )}
          {data.status === "validated" ? (
            <>
              <label className="approval-check">
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
              {currentTargetPublished ? "刷新归档记录" : "归档到 GitHub"}
            </button>
          )}
          <p className="muted">
            批准不会自动归档；失败后可显式重试，同一内容不产生重复 Commit。
          </p>
          <div className="delete-confirm">
            {deleteConfirmed ? <>
              <p>删除此日报及所有对应的 GitHub 归档？公开站与 RSS 在重新构建后更新。执行历史和 Git 提交历史保留。</p>
              <button disabled={busy} onClick={() => void remove()}>确认删除日报和归档</button>
              <button className="quiet" disabled={busy} onClick={() => setDeleteConfirmed(false)}>取消删除</button>
            </> : <button className="quiet" disabled={busy} onClick={() => setDeleteConfirmed(true)}>删除日报</button>}
          </div>
          {data.publications.map((p) => (
            <div key={p.id}>
              <p className="muted">
                归档目标：{p.repository ?? "历史目标未知"} ·{" "}
                {p.branch ?? "未知分支"}
              </p>
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
