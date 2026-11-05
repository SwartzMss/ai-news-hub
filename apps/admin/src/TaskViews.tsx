import { ManagedTasks } from "./ManagedTasks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  TaskRecord,
  RunRecord,
  TurnRecord,
  RunEvent,
} from "../../../packages/shared/src";
import { ApiError, errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { Research } from "./Research";
import { Report, type ReportRecord } from "./Report";
import { Publication } from "./Publication";
import {
  active,
  Badge,
  EmptyState,
  Icon,
  labels,
  PageHeading,
  pathFor,
  time,
} from "./ui";
function Notice({ error }: { error?: unknown }) {
  return error ? (
    <p className="error" role="alert">
      {errorText(error)}
    </p>
  ) : null;
}

export function Dashboard({ api }: { api: Client }) {
  return <ManagedTasks api={api} />;
}

export function TaskDetail({ api, taskId }: { api: Client; taskId: string }) {
  if (!["sample-connectivity", "news-research", "news-github"].includes(taskId))
    return <ManagedTasks api={api} taskId={taskId} />;
  return <LegacyTaskDetail api={api} taskId={taskId} />;
}

function LegacyTaskDetail({ api, taskId }: { api: Client; taskId: string }) {
  const [page, setPage] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const key = useRef<string | undefined>(undefined),
    pending = useRef(false);
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
  const state = usePolling(load),
    research = taskId === "news-research";
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
      if (!controller.signal.aborted) location.hash = pathFor(taskId, run.id);
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause);
        if (
          cause instanceof ApiError &&
          cause.status >= 400 &&
          cause.status < 500
        )
          key.current = undefined;
      }
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <PageHeading
        title={state.data?.task.name ?? "任务详情"}
        description={
          research
            ? "定义你的问题，在同一次研究中逐步完善答案。"
            : "查看配置、检查接入并追踪执行历史。"
        }
        action={
          state.data &&
          !research && (
            <button
              onClick={start}
              disabled={
                busy ||
                state.data.task.status !== "active" ||
                state.data.runs.some((run) => active(run.status))
              }
            >
              <Icon name="plus" />
              {busy ? "正在提交…" : "手动执行"}
            </button>
          )
        }
      />
      <Notice error={state.error ?? error} />
      {research && (
        <div className="research-start-layout">
          <Research
            api={api}
            taskId={taskId}
            disabled={
              !state.data ||
              state.data.task.status !== "active" ||
              state.data.runs.some((run) => active(run.status))
            }
            onSubmitted={(id) => {
              location.hash = pathFor(taskId, id);
            }}
          />
          <aside className="context-card">
            <span className="context-icon">
              <Icon name="spark" size={23} />
            </span>
            <h2>研究从好问题开始</h2>
            <p>告诉 Codex 你关心什么，以及希望如何筛选信息。</p>
            <ul>
              <li>明确主题与时间范围</li>
              <li>优先官方公告和原始来源</li>
              <li>通过后续 prompt 补查、筛选</li>
            </ul>
            <div className="subtle-note">
              <Icon name="shield" size={16} />
              生成结果由你审核后归档。
            </div>
          </aside>
        </div>
      )}
      {!state.data ? (
        <p className="muted">正在读取任务…</p>
      ) : (
        <>
          <section className="task-facts">
            <div>
              <span>任务状态</span>
              <Badge status={state.data.task.status} />
            </div>
            <div>
              <span>发布频道</span>
              <strong>{state.data.task.channel}</strong>
            </div>
            <div>
              <span>执行方式</span>
              <strong>仅手动</strong>
            </div>
            <details>
              <summary>查看任务配置</summary>
              <dl>
                <dt>任务 ID</dt>
                <dd>{taskId}</dd>
                <dt>时区</dt>
                <dd>{state.data.task.timezone ?? "UTC"}</dd>
              </dl>
              <pre>{state.data.task.prompt}</pre>
            </details>
          </section>
          <section>
            <div className="section-heading">
              <h2>执行历史</h2>
              <span className="muted">每页 20 条</span>
            </div>
            {!state.data.runs.length ? (
              <div className="panel">
                <EmptyState title="还没有执行记录" icon="clock">
                  {research
                    ? "填写上方主题和初始 prompt，开始你的第一轮研究。"
                    : "点击手动执行，检查任务是否能正常完成。"}
                </EmptyState>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>研究记录</th>
                      <th>状态</th>
                      <th>创建时间</th>
                      <th>异常</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.runs.map((run) => (
                      <tr key={run.id}>
                        <td>
                          <a
                            className="run-link"
                            href={pathFor(taskId, run.id)}
                          >
                            <Icon name="message" size={16} />
                            {run.id}
                          </a>
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
              <span>第 {page + 1} 页</span>
              <div>
                <button
                  className="quiet"
                  disabled={!page}
                  onClick={() => setPage((n) => n - 1)}
                >
                  上一页
                </button>
                <button
                  className="quiet"
                  disabled={state.data.runs.length < 20}
                  onClick={() => setPage((n) => n + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </>
  );
}

export function RunDetail({
  api,
  taskId,
  runId,
}: {
  api: Client;
  taskId: string;
  runId: string;
}) {
  const managed = ![
    "news-research",
    "news-github",
    "sample-connectivity",
  ].includes(taskId);
  const [after, setAfter] = useState(0),
    [refresh, setRefresh] = useState(0),
    [tab, setTab] = useState<"result" | "conversation" | "logs" | "info">(
      managed ? "result" : "conversation",
    );
  const load = useCallback(
    async (signal: AbortSignal) => {
      const detail = await api<{
        run: RunRecord;
        turns: TurnRecord[];
        sourceFailures?: {
          url: string;
          code: string;
          httpStatus?: number;
          networkCode?: string;
          attempts: number;
        }[];
      }>(`/runs/${encodeURIComponent(runId)}`, signal);
      if (detail.run.task_id !== taskId)
        throw new ApiError(404, "run_not_in_task");
      const events = await api<{ events: RunEvent[] }>(
        `/runs/${encodeURIComponent(runId)}/events?limit=100&after=${after}`,
        signal,
      );
      let report: ReportRecord | undefined;
      if (taskId !== "sample-connectivity")
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
      return { ...detail, ...events, report };
    },
    [api, taskId, runId, after, refresh],
  );
  const { data, error } = usePolling(load),
    research = taskId === "news-research";
  const summary = !data
    ? ["正在读取记录", "请稍候…"]
    : data.run.publishing
      ? ["正在发布", "正在归档到 GitHub。"]
      : data.report
        ? [
            data.report.status === "published"
              ? "已发布到 GitHub"
              : "日报已生成",
            data.run.error_code
              ? "发布未完成，可在发布记录中重试。"
              : data.report.status === "published"
                ? "查看发布记录中的提交结果。"
                : "在发布记录中查看审核与归档状态。",
          ]
        : active(data.run.status)
          ? [
              research ? "研究进行中" : "任务执行中",
              "完成后可查看回复与执行日志。",
            ]
          : !research
            ? [
                `执行${labels[data.run.status] ?? data.run.status}`,
                "在会话中查看输出，或返回任务再次执行。",
              ]
            : !data.run.thread_id
              ? ["本次研究无法继续", "尚未创建 Thread，请检查错误并新建研究。"]
              : data.turns.length >= 20
                ? ["已达到 20 轮上限", "如需继续，请返回任务新建研究。"]
                : ["等待下一步研究", "可以补查、筛选，再整理为日报。"];
  const tabs = [
    ...(managed
      ? [{ id: "result", label: "最终结果", icon: "file" } as const]
      : []),
    {
      id: "conversation",
      label: managed ? "Prompt 记录" : "研究会话",
      icon: "message",
    },
    { id: "logs", label: "执行日志", icon: "activity" },
    { id: "info", label: "运行信息", icon: "info" },
  ] as const;
  return (
    <>
      <PageHeading
        title={managed ? "执行结果" : research ? "研究会话" : "执行详情"}

        action={data && <Badge status={data.run.status} />}
      />
      <Notice error={error} />
      {data?.run.error_code && (
        <p role="alert" className="error">
          {data.run.error_code === "auth_required"
            ? "Codex 认证失效，请在服务账户下重新登录。"
            : `执行异常：${data.run.error_code}`}
        </p>
      )}
      <div className="run-layout">
        <div className="run-main">
          <div className="tabs" role="tablist" aria-label="研究记录视图">
            {tabs.map((item) => (
              <button
                key={item.id}
                id={`tab-${item.id}`}
                role="tab"
                aria-selected={tab === item.id}
                tabIndex={tab === item.id ? 0 : -1}
                onKeyDown={(event) => {
                  const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
                  if (!keys.includes(event.key)) return;
                  event.preventDefault();
                  const index = tabs.findIndex((value) => value.id === tab);
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : (index +
                            (event.key === "ArrowRight" ? 1 : -1) +
                            tabs.length) %
                          tabs.length;
                  setTab(tabs[next].id);
                  document.getElementById(`tab-${tabs[next].id}`)?.focus();
                }}
                aria-controls={`panel-${item.id}`}
                onClick={() => setTab(item.id)}
              >
                <Icon name={item.icon} size={17} />
                {item.label}
              </button>
            ))}
          </div>
          {managed && (
            <div
              id="panel-result"
              role="tabpanel"
              aria-labelledby="tab-result"
              hidden={tab !== "result"}
            >
              {!data ? (
                <p>正在读取结果…</p>
              ) : data.report ? (
                <Report report={data.report} />
              ) : (
                <section className="panel">
                  <h2>
                    {active(data.run.status)
                      ? data.turns.at(-1)?.idempotency_key === "source-repair"
                        ? "正在修复来源"
                        : data.turns.at(-1)?.mode === "finalize"
                          ? "正在生成日报"
                          : "正在执行研究 Prompt"
                      : "尚无可审核日报"}
                  </h2>
                  <p className="result-explanation">
                    {data.run.error_code === "source_fetch_failed"
                      ? "这条历史执行在原文抓取步骤失败，未生成日报。新版本已移除后端抓取，可返回任务重新运行。"
                      : active(data.run.status)
                        ? "预设研究 Prompt 完成后，系统会额外整理并保存结构化日报。"
                        : "查看各阶段的输出和错误记录，核对后可返回任务重新执行。"}
                  </p>
                  {data.sourceFailures?.length ? (
                    <div className="source-failures">
                      <h3>来源校验记录</h3>
                      <ul>
                        {data.sourceFailures.map((failure, index) => (
                          <li key={index}>
                            <span className="source-failure-url">
                              {failure.url}
                            </span>
                            <p>
                              {failure.code}
                              {failure.httpStatus
                                ? ` · HTTP ${failure.httpStatus}`
                                : ""}
                              {failure.networkCode
                                ? ` · ${failure.networkCode}`
                                : ""}{" "}
                              · 已尝试 {failure.attempts} 次
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <button
                    className="quiet"
                    onClick={() => setTab("conversation")}
                  >
                    查看 Prompt 记录
                  </button>
                </section>
              )}
            </div>
          )}
          <div
            id="panel-conversation"
            role="tabpanel"
            aria-labelledby="tab-conversation"
            hidden={tab !== "conversation"}
          >
            <div className="conversation-list">
              {!data ? (
                <p className="loading-state">正在读取执行记录…</p>
              ) : (
                data.turns.map((turn) => (
                  <article className="conversation-turn" key={turn.id}>
                    <div className="turn-divider">
                      <span>
                        {managed && turn.mode === "finalize"
                          ? turn.idempotency_key === "source-repair"
                            ? "来源修复（系统步骤）"
                            : "日报生成（系统步骤）"
                          : managed
                            ? `研究第 ${turn.sequence} 轮`
                            : `第 ${turn.sequence} 轮`}
                      </span>
                      <Badge status={turn.status} />
                    </div>
                    <div className="message-row user-message">
                      <span className="message-avatar">你</span>
                      <div className="message-content">
                        <span className="message-author">你的要求</span>
                        <p className="message-text">{turn.input_text}</p>
                      </div>
                    </div>
                    <div className="message-row assistant-message">
                      <span className="message-avatar">
                        <Icon name="spark" size={17} />
                      </span>
                      <div className="message-content">
                        <span className="message-author">
                          Codex
                          <span>
                            {turn.mode === "finalize" ? "日报整理" : "研究回复"}
                          </span>
                        </span>
                        {turn.mode === "finalize" &&
                        turn.status === "succeeded" &&
                        data.report ? (
                          <p className="message-text">
                            日报已生成，可在“最终结果”查看来源与内容。
                          </p>
                        ) : (
                          <div>
                            {managed &&
                              turn.mode === "finalize" &&
                              turn.status === "failed" &&
                              turn.output_text && (
                                <p className="muted">
                                  以下生成内容未通过校验，仅供排查，不是可发布日报。
                                </p>
                              )}
                            <pre className="message-text">
                              {turn.output_text ??
                                (active(turn.status)
                                  ? "正在研究中…"
                                  : "暂无输出")}
                            </pre>
                          </div>
                        )}
                        {turn.error_code && (
                          <p className="inline-error">{turn.error_code}</p>
                        )}
                      </div>
                    </div>
                  </article>
                ))
              )}
            </div>
            {research && !data?.report && (
              <Research
                api={api}
                taskId={taskId}
                runId={runId}
                disabled={
                  !data ||
                  active(data.run.status) ||
                  !data.run.thread_id ||
                  data.turns.length >= 20
                }
                onSubmitted={() => setRefresh((n) => n + 1)}
              />
            )}
            {managed ? null : data?.report ? (
              <Report report={data.report} />
            ) : data && !research ? (
              <div className="panel">
                <EmptyState title="此 Run 尚无日报">
                  样例任务仅返回执行文本，日报通过新闻研究任务生成。
                </EmptyState>
              </div>
            ) : data ? (
              <p className="muted report-hint">
                此 Run 尚无日报。完成研究后，填写整理要求并生成待审核日报。
              </p>
            ) : null}
          </div>
          <div
            id="panel-logs"
            role="tabpanel"
            aria-labelledby="tab-logs"
            hidden={tab !== "logs"}
          >
            <section className="panel log-panel">
              <div className="section-heading">
                <h2>执行日志</h2>
                <span className="muted">每页最多 100 条</span>
              </div>
              {data?.events.length ? (
                <ol className="logs">
                  {data.events.map((event) => (
                    <li key={event.id}>
                      <div className="log-heading">
                        <strong>{event.kind}</strong>
                        <time>{time(event.created_at)}</time>
                      </div>
                      <pre>{JSON.stringify(event.data, null, 2)}</pre>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="muted">暂无执行日志。</p>
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
                  disabled={!data || data.events.length < 100}
                  onClick={() => setAfter(data!.events.at(-1)!.id)}
                >
                  后续日志
                </button>
              </div>
            </section>
          </div>
          <div
            id="panel-info"
            role="tabpanel"
            aria-labelledby="tab-info"
            hidden={tab !== "info"}
          >
            <section className="panel">
              <h2>运行信息</h2>
              {data && (
                <dl className="technical-info">
                  <dt>Run</dt>
                  <dd>{runId}</dd>
                  <dt>Thread</dt>
                  <dd>{data.run.thread_id ?? "尚未创建"}</dd>
                  <dt>Turn</dt>
                  <dd>{data.run.turn_id ?? "尚未创建"}</dd>
                  <dt>创建时间</dt>
                  <dd>{time(data.run.created_at)}</dd>
                  <dt>开始时间</dt>
                  <dd>{time(data.run.started_at)}</dd>
                  <dt>结束时间</dt>
                  <dd>{time(data.run.finished_at)}</dd>
                </dl>
              )}
              {data?.turns.map((turn) => (
                <details key={turn.id}>
                  <summary>
                    Turn {turn.sequence} · {labels[turn.status] ?? turn.status}
                  </summary>
                  <pre>{turn.output_text ?? "暂无输出"}</pre>
                </details>
              ))}
            </section>
          </div>
        </div>
        <aside className="run-rail">
          <section className="panel run-summary">
            <h2>{research ? "本次研究" : "本次执行"}</h2>
            <div className="summary-progress">
              <span className="summary-icon">
                <Icon name={data?.report ? "check" : "message"} size={22} />
              </span>
              <div>
                <strong>{summary[0]}</strong>
                <p>{summary[1]}</p>
              </div>
            </div>
            <dl>
              <dt>{managed ? "研究轮次" : "已执行轮次"}</dt>
              <dd>
                {managed
                  ? `${data?.turns.filter((turn) => turn.mode === "research").length ?? 0} / ${data?.run.configuration?.prompts.length ?? "—"}`
                  : `${data?.turns.length ?? "—"} / 20`}
              </dd>
              {managed && (
                <>
                  <dt>系统步骤</dt>
                  <dd>日报生成（额外执行）</dd>
                </>
              )}
              <dt>创建时间</dt>
              <dd>{time(data?.run.created_at)}</dd>
              <dt>当前状态</dt>
              <dd>{data ? labels[data.run.status] : "读取中"}</dd>
            </dl>
          </section>
          {data?.report ? (
            <Publication api={api} reportId={data.report.id} />
          ) : managed ? null : (
            <div className="rail-note">
              <Icon name="shield" size={19} />
              <p>
                来源值得多看一眼
                <small>内容与来源由 Codex 整理，可在生成后查看。</small>
              </p>
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
