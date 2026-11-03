import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TaskRecord,
  RunRecord,
  TurnRecord,
  RunEvent,
} from "../../../packages/shared/src";
import { ApiError, client, errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { Publication } from "./Publication";
import { Report, type ReportRecord } from "./Report";
const active = (status: string) =>
  ["queued", "running", "waiting_approval"].includes(status);
const labels: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  waiting_approval: "需要审批",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  active: "已启用",
  paused: "已暂停",
};
const time = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
const pathFor = (task: string, run?: string) =>
  `#/tasks/${encodeURIComponent(task)}${run ? "/runs/" + encodeURIComponent(run) : ""}`;
function Badge({ status }: { status: string }) {
  return <span className={`badge ${status}`}>{labels[status] ?? status}</span>;
}
function ErrorNotice({ error }: { error?: unknown }) {
  return error ? (
    <p role="alert" className="error">
      {errorText(error)}
    </p>
  ) : null;
}

export function App() {
  const [token, setToken] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState<unknown>();
  const [connecting, setConnecting] = useState(false);
  const [hash, setHash] = useState(location.hash);
  const session = useRef(0);
  useEffect(() => {
    const change = () => setHash(location.hash);
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const expire = useCallback((cause: ApiError) => {
    session.current++;
    setToken("");
    setInput("");
    setError(cause);
  }, []);
  const api = useMemo(() => client(token, expire), [token, expire]);
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (connecting) return;
    setConnecting(true);
    setError(undefined);
    const generation = ++session.current;
    try {
      await client(input.trim(), () => {})("/tasks");
      if (generation === session.current) {
        setToken(input.trim());
        setInput("");
      }
    } catch (cause) {
      setError(cause);
    } finally {
      setConnecting(false);
    }
  }
  let taskId: string | undefined, runId: string | undefined;
  try {
    const match = /^#\/tasks\/([^/]+)(?:\/runs\/([^/]+))?$/.exec(hash);
    if (match) {
      taskId = decodeURIComponent(match[1]);
      runId = match[2] ? decodeURIComponent(match[2]) : undefined;
    }
  } catch {
    /* Invalid route displays overview. */
  }
  return (
    <>
      <header>
        <a className="brand" href="#">
          AI <span>News Hub</span>
        </a>
        <span className="header-label">本地管理后台</span>
        {token && (
          <button
            className="quiet"
            onClick={() => {
              session.current++;
              setToken("");
              setInput("");
              setError(undefined);
            }}
          >
            退出
          </button>
        )}
      </header>
      {!token ? (
        <main className="login">
          <div className="eyebrow">任务与执行</div>
          <h1>连接你的新闻后台</h1>
          <p className="muted">查看任务、执行记录与待审核日报。</p>
          <form onSubmit={connect}>
            <label htmlFor="token">管理 Token</label>
            <input
              id="token"
              type="password"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              autoComplete="off"
              required
            />
            <button disabled={connecting}>
              {connecting ? "连接中…" : "连接后台"}
            </button>
          </form>
          <ErrorNotice error={error} />
          <p className="muted">
            Token 仅保留在当前页面内存，刷新后需重新输入。
          </p>
        </main>
      ) : (
        <div className="layout">
          <aside>
            <div className="eyebrow">工作空间</div>
            <a href="#" className="nav-active">
              任务总览
            </a>
            <p>
              Task → Run
              <br />
              执行记录与生成结果
            </p>
            <div className="sidebar-note">
              日报仅供审核
              <br />
              不会自动公开发布
            </div>
          </aside>
          <main key={`${token}:${taskId ?? ""}:${runId ?? ""}`}>
            <nav className="breadcrumbs">
              <a href="#">任务总览</a>
              {taskId && (
                <>
                  {" "}
                  / <a href={pathFor(taskId)}>任务详情</a>
                </>
              )}
              {runId && " / Run 详情"}
            </nav>
            {!taskId ? (
              <Dashboard api={api} />
            ) : runId ? (
              <RunDetail api={api} taskId={taskId} runId={runId} />
            ) : (
              <TaskDetail api={api} taskId={taskId} />
            )}
          </main>
        </div>
      )}
    </>
  );
}
function Dashboard({ api }: { api: Client }) {
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { tasks } = await api<{ tasks: TaskRecord[] }>("/tasks", signal);
      return Promise.all(
        tasks.map(async (task) => ({
          task,
          runs: (
            await api<{ runs: RunRecord[] }>(
              `/tasks/${encodeURIComponent(task.id)}/runs?limit=1`,
              signal,
            )
          ).runs,
        })),
      );
    },
    [api],
  );
  const { data, error } = usePolling(load);
  return (
    <>
      <div className="eyebrow">任务管理</div>
      <h1>任务总览</h1>
      <p className="muted">手动启动、追踪执行，检查每一份结果。</p>
      <ErrorNotice error={error} />
      {!data && !error && <p role="status">正在读取任务…</p>}
      {data && (
        <>
          <div className="stats">
            <div>
              <strong>{data.length}</strong>已配置任务
            </div>
            <div>
              <strong>
                {data.filter((x) => active(x.runs[0]?.status)).length}
              </strong>
              等待 / 执行中
            </div>
            <div>
              <strong>
                {
                  data.filter((x) =>
                    ["failed", "interrupted"].includes(x.runs[0]?.status),
                  ).length
                }
              </strong>
              最近执行异常
            </div>
          </div>
          <div className="section-heading">
            <h2>全部任务</h2>
            <span className="muted">每 2 秒更新</span>
          </div>
          {!data.length && <p>尚未配置任务。</p>}
          <div className="task-grid">
            {data.map(({ task, runs }) => (
              <article className="panel task-card" key={task.id}>
                <Badge status={task.status} />
                <h2>
                  <a href={pathFor(task.id)}>{task.name}</a>
                </h2>
                <p className="muted">
                  {task.channel} · {task.id}
                </p>
                {runs[0] ? (
                  <>
                    <Badge status={runs[0].status} />
                    <p>最后执行 {time(runs[0].created_at)}</p>
                    {runs[0].error_code && (
                      <p className="error">{runs[0].error_code}</p>
                    )}
                  </>
                ) : (
                  <p className="muted">尚无执行记录</p>
                )}
                <a href={pathFor(task.id)}>查看任务 →</a>
              </article>
            ))}
          </div>
        </>
      )}
    </>
  );
}
function TaskDetail({ api, taskId }: { api: Client; taskId: string }) {
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const key = useRef<string | undefined>(undefined);
  const pending = useRef(false);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const [task, runs] = await Promise.all([
        api<{
          task: TaskRecord & { schedule?: string | null; timezone?: string };
        }>(`/tasks/${encodeURIComponent(taskId)}`, signal),
        api<{ runs: RunRecord[] }>(
          `/tasks/${encodeURIComponent(taskId)}/runs?limit=20&offset=${page * 20}`,
          signal,
        ),
      ]);
      return { ...task, ...runs };
    },
    [api, taskId, page],
  );
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  const state = usePolling(load);
  async function start() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(undefined);
    key.current ??= "admin-" + crypto.randomUUID();
    try {
      const { run } = await api<{ run: RunRecord }>(
        `/tasks/${encodeURIComponent(taskId)}/runs`,
        controller.signal,
        { idempotencyKey: key.current },
      );
      if (controller.signal.aborted) return;
      location.hash = pathFor(taskId, run.id);
    } catch (cause) {
      if (controller.signal.aborted) return;
      setError(cause);
      if (
        cause instanceof ApiError &&
        cause.status >= 400 &&
        cause.status < 500
      )
        key.current = undefined;
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <ErrorNotice error={state.error ?? error} />
      {!state.data ? (
        <p>正在读取任务…</p>
      ) : (
        <>
          <div className="section-heading">
            <div>
              <div className="eyebrow">任务详情</div>
              <h1>{state.data.task.name}</h1>
            </div>
            <button
              onClick={start}
              disabled={
                busy ||
                state.data.task.status !== "active" ||
                state.data.runs.some((run) => active(run.status))
              }
            >
              {busy ? "正在提交…" : "手动执行"}
            </button>
          </div>
          <p className="notice">
            手动执行会调用 Codex 并消耗账户额度。配置只读，暂不执行定时调度。
          </p>
          <section className="panel">
            <h2>基本配置</h2>
            <dl>
              <dt>任务 ID</dt>
              <dd>{taskId}</dd>
              <dt>频道 / 状态</dt>
              <dd>
                {state.data.task.channel} · {labels[state.data.task.status]}
              </dd>
              <dt>计划 / 时区</dt>
              <dd>
                {state.data.task.schedule ?? "仅手动"} ·{" "}
                {state.data.task.timezone ?? "UTC"}
              </dd>
            </dl>
            <details>
              <summary>任务提示词</summary>
              <pre>{state.data.task.prompt}</pre>
            </details>
          </section>
          <h2>执行历史</h2>
          {!state.data.runs.length ? (
            <p>尚无执行记录，可手动执行此任务。</p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Run</th>
                    <th>状态</th>
                    <th>创建时间</th>
                    <th>异常</th>
                  </tr>
                </thead>
                <tbody>
                  {state.data.runs.map((run) => (
                    <tr key={run.id}>
                      <td>
                        <a href={pathFor(taskId, run.id)}>{run.id}</a>
                      </td>
                      <td>
                        <Badge status={run.status} />
                      </td>
                      <td>{time(run.created_at)}</td>
                      <td>{run.error_code ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <button
              className="quiet"
              disabled={!page}
              onClick={() => setPage(page - 1)}
            >
              上一页
            </button>
            <span>第 {page + 1} 页</span>
            <button
              className="quiet"
              disabled={state.data.runs.length < 20}
              onClick={() => setPage(page + 1)}
            >
              下一页
            </button>
          </div>
        </>
      )}
    </>
  );
}
function RunDetail({
  api,
  taskId,
  runId,
}: {
  api: Client;
  taskId: string;
  runId: string;
}) {
  const [after, setAfter] = useState(0);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const detail = await api<{ run: RunRecord; turns: TurnRecord[] }>(
        `/runs/${encodeURIComponent(runId)}`,
        signal,
      );
      if (detail.run.task_id !== taskId)
        throw new ApiError(404, "run_not_in_task");
      const events = await api<{ events: RunEvent[] }>(
        `/runs/${encodeURIComponent(runId)}/events?limit=100&after=${after}`,
        signal,
      );
      let report: ReportRecord | undefined;
      if (taskId === "news-github") {
        try {
          const { newsRun } = await api<{
            newsRun: { report_id: string | null };
          }>(`/news/runs/${encodeURIComponent(runId)}`, signal);
          if (newsRun.report_id)
            report = (
              await api<{ report: ReportRecord }>(
                `/news/reports/${encodeURIComponent(newsRun.report_id)}`,
                signal,
              )
            ).report;
        } catch (cause) {
          if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
        }
      }
      return { ...detail, ...events, report };
    },
    [api, taskId, runId, after],
  );
  const { data, error } = usePolling(load);
  return (
    <>
      <div className="eyebrow">执行记录</div>
      <h1>Run 详情</h1>
      <ErrorNotice error={error} />
      {!data ? (
        <p>正在读取执行记录…</p>
      ) : (
        <>
          <section className="panel">
            <Badge status={data.run.status} />
            <dl>
              <dt>Run</dt>
              <dd>{runId}</dd>
              <dt>Thread</dt>
              <dd>{data.run.thread_id ?? "尚未创建"}</dd>
              <dt>Turn</dt>
              <dd>{data.run.turn_id ?? "尚未创建"}</dd>
              <dt>创建 / 开始 / 结束</dt>
              <dd>
                {time(data.run.created_at)} / {time(data.run.started_at)} /{" "}
                {time(data.run.finished_at)}
              </dd>
            </dl>
            {data.run.error_code && (
              <p role="alert" className="error">
                {data.run.error_code === "auth_required"
                  ? "Codex 认证失效，请在服务账户下重新登录。"
                  : `执行异常：${data.run.error_code}`}
              </p>
            )}
          </section>
          <section className="panel">
            <h2>执行日志</h2>
            <p className="muted">按事件顺序展示，每页最多 100 条。</p>
            {data.events.length ? (
              <ol className="logs">
                {data.events.map((event) => (
                  <li key={event.id}>
                    <time>{time(event.created_at)}</time>{" "}
                    <strong>{event.kind}</strong>
                    <pre>{JSON.stringify(event.data, null, 2)}</pre>
                  </li>
                ))}
              </ol>
            ) : (
              <p>暂无执行日志。</p>
            )}
            <div className="pagination">
              <button
                className="quiet"
                disabled={!after}
                onClick={() => setAfter(0)}
              >
                回到首条
              </button>
              <button
                className="quiet"
                disabled={data.events.length < 100}
                onClick={() => setAfter(data.events.at(-1)!.id)}
              >
                后续日志
              </button>
            </div>
          </section>
          {data.report ? (
            <><Report report={data.report} /><Publication api={api} reportId={data.report.id} /></>
          ) : (
            <section className="panel">
              <h2>此 Run 尚无日报</h2>
              <p className="muted">
                样例任务仅返回文本；新闻任务需采集、分析并通过校验后才会生成待审核报告。
              </p>
            </section>
          )}
          <section className="panel">
            <h2>Turn 结果</h2>
            {data.turns.map((turn) => (
              <details key={turn.id}>
                <summary>
                  Turn {turn.sequence} · {labels[turn.status] ?? turn.status}
                </summary>
                <pre>{turn.output_text ?? "暂无输出"}</pre>
                {turn.error_code && <p className="error">{turn.error_code}</p>}
              </details>
            ))}
          </section>
        </>
      )}
    </>
  );
}
