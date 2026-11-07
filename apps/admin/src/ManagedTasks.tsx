import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskRecord, RunRecord } from "../../../packages/shared/src";
import { ApiError, errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { active, Badge, PageHeading, pathFor } from "./ui";

type Plan = {
  kind: "manual" | "once" | "interval" | "daily" | "weekly";
  at?: string;
  minutes?: number;
  time?: string;
  weekday?: number;
};
export type Configuration = {
  topic: string;
  prompts: string[];
  autoPublish: boolean;
  schedule: Plan;
  timezone: string;
};
export type ManagedTask = TaskRecord & {
  configuration?: Configuration;
  next_run_at?: string | null;
};
const initial: Configuration = {
  topic: "",
  prompts: [""],
  autoPublish: false,
  schedule: { kind: "manual" },
  timezone: "Asia/Shanghai",
};
export function scheduleLabel(config?: Configuration) {
  const p = config?.schedule;
  if (!p || p.kind === "manual") return "手动执行";
  if (p.kind === "once") return `单次：${shortTime(p.at, config?.timezone)}`;
  if (p.kind === "interval") return `每 ${p.minutes} 分钟`;
  return `${p.kind === "daily" ? "每天" : `每周${["日", "一", "二", "三", "四", "五", "六"][p.weekday ?? 0]}`} ${p.time}`;
}
function shortTime(value?: string | null, timezone = "Asia/Shanghai") {
  if (!value) return "未设置";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: timezone,
    month: "long",
    day: "numeric",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
function TaskEditor({
  api,
  task,
  onClose,
  onSaved,
}: {
  api: Client;
  task?: ManagedTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [config, setConfig] = useState<Configuration>(() =>
    structuredClone(task?.configuration ?? initial),
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>();
  const dialogRef = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLInputElement>("input")?.focus();
    return () => {
      if (dialog.close) dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);
  const update = (patch: Partial<Configuration>) =>
    setConfig((c) => ({ ...c, ...patch }));
  const plan = (patch: Partial<Plan>) =>
    update({ schedule: { ...config.schedule, ...patch } });
  function cleanSchedule(p: Plan): Plan {
    if (p.kind === "once") return { kind: p.kind, at: p.at };
    if (p.kind === "interval") return { kind: p.kind, minutes: p.minutes };
    if (p.kind === "daily") return { kind: p.kind, time: p.time };
    if (p.kind === "weekly")
      return { kind: p.kind, time: p.time, weekday: p.weekday };
    return { kind: "manual" };
  }
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(
        task ? `/tasks/${encodeURIComponent(task.id)}` : "/tasks",
        AbortSignal.timeout(15000),
        {
          name: config.topic,
          ...config,
          schedule: cleanSchedule(config.schedule),
          status: task?.status ?? "active",
        },
        task ? "PUT" : "POST",
      );
      onSaved();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <dialog
      ref={dialogRef}
      className="task-editor"
      aria-labelledby="task-editor-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <div className="task-editor-header">
        <h2 id="task-editor-title">{task ? "编辑任务" : "新增任务"}</h2>
        <button
          type="button"
          className="quiet"
          disabled={busy}
          onClick={onClose}
        >
          取消
        </button>
      </div>
      <form onSubmit={save}>
        <div className="task-editor-body">
          <fieldset disabled={busy} className="task-editor-fields">
            <label>
              任务主题
              <input
                required
                maxLength={200}
                value={config.topic}
                onChange={(e) => update({ topic: e.target.value })}
              />
            </label>
            <div className="prompt-sequence">
              <h3>多轮 Prompt</h3>
              {config.prompts.map((prompt, index) => (
                <div className="prompt-step" key={index}>
                  <label>
                    第 {index + 1} 轮
                    <textarea
                      required
                      maxLength={8000}
                      rows={3}
                      value={prompt}
                      onChange={(e) =>
                        update({
                          prompts: config.prompts.map((v, i) =>
                            i === index ? e.target.value : v,
                          ),
                        })
                      }
                    />
                  </label>
                  <div className="task-actions">
                    <button
                      type="button"
                      className="quiet"
                      disabled={index === 0}
                      onClick={() => {
                        const prompts = [...config.prompts];
                        [prompts[index - 1], prompts[index]] = [
                          prompts[index],
                          prompts[index - 1],
                        ];
                        update({ prompts });
                      }}
                    >
                      上移
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={index === config.prompts.length - 1}
                      onClick={() => {
                        const prompts = [...config.prompts];
                        [prompts[index + 1], prompts[index]] = [
                          prompts[index],
                          prompts[index + 1],
                        ];
                        update({ prompts });
                      }}
                    >
                      下移
                    </button>
                    <button
                      type="button"
                      className="quiet"
                      disabled={config.prompts.length === 1}
                      onClick={() =>
                        update({
                          prompts: config.prompts.filter((_, i) => i !== index),
                        })
                      }
                    >
                      删除本轮
                    </button>
                  </div>
                </div>
              ))}
              <button
                type="button"
                className="quiet"
                disabled={config.prompts.length >= 20}
                onClick={() => update({ prompts: [...config.prompts, ""] })}
              >
                添加一轮
              </button>
              <p className="field-help">
                按顺序执行你配置的 Prompt，最后一轮生成日报，不再额外追加轮次。
              </p>
            </div>
            <div className="form-grid">
              <label>
                执行计划
                <select
                  aria-label="执行计划"
                  value={config.schedule.kind}
                  onChange={(e) =>
                    update({
                      schedule: {
                        kind: e.target.value as Plan["kind"],
                        minutes: 60,
                        time: "09:00",
                        weekday: 1,
                      },
                    })
                  }
                >
                  <option value="manual">手动</option>
                  <option value="once">指定时间</option>
                  <option value="interval">固定间隔</option>
                  <option value="daily">每天</option>
                  <option value="weekly">每周</option>
                </select>
              </label>
              <label>
                时区
                <input
                  required
                  value={config.timezone}
                  onChange={(e) => update({ timezone: e.target.value })}
                />
              </label>
            </div>
            {config.schedule.kind === "once" && (
              <label>
                执行时间（浏览器本地时区）
                <input
                  type="datetime-local"
                  required
                  value={
                    config.schedule.at
                      ? new Date(
                          new Date(config.schedule.at).getTime() -
                            new Date(config.schedule.at).getTimezoneOffset() *
                              60000,
                        )
                          .toISOString()
                          .slice(0, 16)
                      : ""
                  }
                  onChange={(e) =>
                    plan({
                      at: e.target.value
                        ? new Date(e.target.value).toISOString()
                        : undefined,
                    })
                  }
                />
              </label>
            )}
            {config.schedule.kind === "interval" && (
              <label>
                间隔（分钟）
                <input
                  type="number"
                  min={1}
                  max={525600}
                  required
                  value={config.schedule.minutes ?? 60}
                  onChange={(e) => plan({ minutes: Number(e.target.value) })}
                />
              </label>
            )}
            {["daily", "weekly"].includes(config.schedule.kind) && (
              <label>
                执行时刻
                <input
                  type="time"
                  required
                  value={config.schedule.time ?? "09:00"}
                  onChange={(e) => plan({ time: e.target.value })}
                />
              </label>
            )}
            {config.schedule.kind === "weekly" && (
              <label>
                星期
                <select
                  value={config.schedule.weekday ?? 1}
                  onChange={(e) => plan({ weekday: Number(e.target.value) })}
                >
                  {["日", "一", "二", "三", "四", "五", "六"].map((d, i) => (
                    <option key={i} value={i}>
                      星期{d}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="check">
              <input
                type="checkbox"
                checked={config.autoPublish}
                onChange={(e) => update({ autoPublish: e.target.checked })}
              />
              自动发布到 GitHub
            </label>
            {error ? (
              <p className="error" role="alert">
                {errorText(error)}
              </p>
            ) : null}
          </fieldset>
        </div>
        <div className="task-editor-footer">
          <button type="submit" disabled={busy}>
            {busy ? "正在保存…" : "保存任务"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}
export function ManagedTasks({
  api,
  taskId,
}: {
  api: Client;
  taskId?: string;
}) {
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [planFilter, setPlanFilter] = useState("all");
  const [page, setPage] = useState(0);
  useEffect(() => {
    const normalized = search.trim().toLocaleLowerCase();
    if (normalized === query) return;
    const timer = setTimeout(() => {
      setQuery(normalized);
      setPage(0);
    }, 250);
    return () => clearTimeout(timer);
  }, [search, query]);
  const [revision, refresh] = useState(0),
    [editing, setEditing] = useState<ManagedTask | "new">(),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<unknown>(),
    [deleting, setDeleting] = useState<string>();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { tasks } = await api<{ tasks: ManagedTask[] }>("/tasks", signal);
      const configured = tasks.filter((t) =>
        taskId ? t.id === taskId : !!t.configuration,
      );
      const matching = configured.filter((t) => {
        const kind = t.configuration?.schedule.kind ?? "manual";
        const planMatches =
          planFilter === "all" ||
          (planFilter === "manual"
            ? kind === "manual"
            : kind !== "manual" &&
              t.status === (planFilter === "scheduled" ? "active" : "paused"));
        return (
          taskId ||
          (planMatches &&
            `${t.configuration?.topic ?? ""} ${t.name}`
              .toLocaleLowerCase()
              .includes(query))
        );
      });
      const lastPage = Math.max(0, Math.ceil(matching.length / 10) - 1);
      const currentPage = Math.min(page, lastPage);
      const visible = taskId
        ? matching
        : matching.slice(currentPage * 10, currentPage * 10 + 10);
      const rows = await Promise.all(
        visible.map(async (task) => {
          const { runs } = await api<{ runs: RunRecord[] }>(
            `/tasks/${encodeURIComponent(task.id)}/runs?limit=1`,
            signal,
          );
          return { task, current: runs[0] };
        }),
      );
      return {
        rows,
        total: configured.length,
        matched: matching.length,
        page: currentPage,
        requestedPage: page,
        lastPage,
      };
    },
    [api, taskId, revision, query, planFilter, page],
  );
  const startKeys = useRef(new Map<string, string>());
  const state = usePolling(load, 5000);
  useEffect(() => {
    if (
      state.data &&
      state.data.requestedPage === page &&
      state.data.page !== page
    )
      setPage(state.data.page);
  }, [state.data, page]);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  async function action(
    task: ManagedTask,
    kind: "start" | "stop" | "pause" | "delete" | "autoPublish",
  ) {
    if (busy) return;
    setBusy(task.id);
    setError(undefined);
    try {
      const base = `/tasks/${encodeURIComponent(task.id)}`;
      if (kind === "delete") {
        await api(base, controller.signal, undefined, "DELETE");
        if (taskId) location.hash = "#/tasks";
      } else if (kind === "pause" || kind === "autoPublish")
        await api(
          base,
          controller.signal,
          {
            name: task.name,
            ...task.configuration,
            autoPublish:
              kind === "autoPublish"
                ? !task.configuration?.autoPublish
                : task.configuration?.autoPublish,
            status:
              kind === "pause"
                ? task.status === "active"
                  ? "paused"
                  : "active"
                : task.status,
          },
          "PUT",
        );
      else {
        const result = await api<{ run?: RunRecord }>(
          base + (kind === "start" ? "/runs" : "/stop"),
          controller.signal,
          kind === "start"
            ? {
                idempotencyKey:
                  startKeys.current.get(task.id) ??
                  (() => {
                    const key = "admin-" + crypto.randomUUID();
                    startKeys.current.set(task.id, key);
                    return key;
                  })(),
              }
            : {},
        );
        if (taskId && result.run && kind === "start")
          location.hash = pathFor(task.id, result.run.id);
      }
      startKeys.current.delete(task.id);
      setDeleting(undefined);
      refresh((n) => n + 1);
    } catch (e) {
      if (e instanceof ApiError && e.status >= 400 && e.status < 500)
        startKeys.current.delete(task.id);
      setError(e);
    } finally {
      setBusy(undefined);
    }
  }
  const renderTasks = () =>
    state.data?.rows.map(({ task, current }) => {
      const running = active(current?.status) || !!current?.publishing;
      const scheduled = task.configuration?.schedule.kind !== "manual";
      const controls = (
        <div className="task-actions">
          <button
            disabled={!!busy}
            onClick={() => void action(task, running ? "stop" : "start")}
          >
            {running ? "停止执行" : "立即运行"}
          </button>
          <button
            className="quiet"
            disabled={!!busy || running}
            onClick={() => setEditing(task)}
          >
            编辑
          </button>
          {scheduled && (
            <button
              className="quiet"
              disabled={!!busy || running}
              onClick={() => void action(task, "pause")}
            >
              {task.status === "active" ? "暂停定时" : "启用定时"}
            </button>
          )}
          <button
            className="quiet danger-action"
            disabled={!!busy || running}
            onClick={() => setDeleting(task.id)}
          >
            删除
          </button>
        </div>
      );
      const autoPublish = (
        <label className="task-auto-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={`自动发布：${task.configuration?.topic ?? task.name}`}
            checked={!!task.configuration?.autoPublish}
            disabled={!!busy || running || !task.configuration}
            onChange={() => void action(task, "autoPublish")}
          />
          <span aria-hidden="true">
            {task.configuration?.autoPublish ? "开启" : "关闭"}
          </span>
        </label>
      );
      const confirmation = deleting === task.id && (
        <div className="delete-confirm" role="alert">
          <p>删除此任务？执行与发布历史会保留。</p>
          <button className="quiet" onClick={() => setDeleting(undefined)}>
            取消
          </button>
          <button disabled={!!busy} onClick={() => void action(task, "delete")}>
            确认删除
          </button>
        </div>
      );
      if (!taskId)
        return (
          <tr key={task.id}>
            <td>
              <a
                className="task-table-name"
                href={pathFor(task.id)}
                title={task.configuration?.topic ?? task.name}
              >
                {task.configuration?.topic ?? task.name}
              </a>
              <small className="task-table-secondary">
                {task.configuration?.prompts.length ?? 1} 轮 Prompt
              </small>
            </td>
            <td data-label="执行计划">
              {scheduleLabel(task.configuration)}
              <small className="task-table-secondary">
                <span>
                  {!scheduled
                    ? "手动任务"
                    : task.status === "active"
                      ? "定时已启用"
                      : "定时已暂停"}
                </span>{" "}
                ·{" "}
                {task.configuration?.timezone === "Asia/Shanghai"
                  ? "上海时间"
                  : task.configuration?.timezone}
              </small>
            </td>
            <td data-label="下次执行">
              {task.status === "paused" && scheduled
                ? "已暂停"
                : task.next_run_at
                  ? shortTime(task.next_run_at, task.configuration?.timezone)
                  : "—"}
            </td>
            <td data-label="最近状态">
              {running ? (
                <span className="task-running-state" role="status">
                  {current?.publishing
                    ? "正在发布"
                    : current?.status === "queued"
                      ? "排队中"
                      : "运行中"}
                </span>
              ) : current ? (
                <Badge status={current.status} />
              ) : (
                <span className="muted">未运行</span>
              )}
            </td>
            <td data-label="自动发布">{autoPublish}</td>
            <td className="task-table-actions">
              {controls}
              {confirmation}
            </td>
          </tr>
        );
      return (
        <article className="panel managed-task" key={task.id}>
          <div className="managed-task-heading">
            {!taskId && (
              <h2>
                <a href={pathFor(task.id)}>
                  {task.configuration?.topic ?? task.name}
                </a>
              </h2>
            )}
            <div className="task-state-group">
              <span className="task-schedule-state">
                {!scheduled
                  ? "手动任务"
                  : task.status === "active"
                    ? "定时已启用"
                    : "定时已暂停"}
              </span>
              {running ? (
                <span className="task-running-state" role="status">
                  {current?.publishing
                    ? "正在发布"
                    : current?.status === "queued"
                      ? "排队中"
                      : "运行中"}
                </span>
              ) : (
                <span className="muted">未运行</span>
              )}
            </div>
          </div>
          <dl className="managed-facts">
            <div>
              <dt>
                执行计划
                <span className="task-timezone">
                  {task.configuration?.timezone === "Asia/Shanghai"
                    ? "上海时间"
                    : task.configuration?.timezone}
                </span>
              </dt>
              <dd>{scheduleLabel(task.configuration)}</dd>
            </div>
            <div>
              <dt>下次执行</dt>
              <dd>
                {task.status === "paused"
                  ? "已暂停"
                  : shortTime(task.next_run_at, task.configuration?.timezone)}
              </dd>
            </div>
            <div>
              <dt>研究 Prompt</dt>
              <dd>{task.configuration?.prompts.length ?? 1} 轮</dd>
            </div>
            <div>
              <dt>自动发布</dt>
              <dd>{autoPublish}</dd>
            </div>
          </dl>
          <div className="managed-task-footer">{controls}</div>
          {confirmation}
        </article>
      );
    });
  const selected = state.data?.rows[0];
  return (
    <>
      <PageHeading
        title={
          taskId
            ? (selected?.task.configuration?.topic ??
              selected?.task.name ??
              "任务详情")
            : "任务总览"
        }
        action={
          <button
            disabled={
              !!taskId &&
              (!selected ||
                !!busy ||
                active(selected.current?.status) ||
                !!selected.current?.publishing)
            }
            onClick={() =>
              setEditing(taskId && selected ? selected.task : "new")
            }
          >
            {taskId ? "编辑任务" : "新增任务"}
          </button>
        }
      />
      {error || state.error ? (
        <p className="error" role="alert">
          {errorText(error ?? state.error)}
        </p>
      ) : null}
      {editing && (
        <TaskEditor
          key={editing === "new" ? "new" : editing.id}
          api={api}
          task={editing === "new" ? undefined : editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh((n) => n + 1);
          }}
        />
      )}
      {!taskId && (
        <div className="task-toolbar">
          <label className="task-search">
            <span className="sr-only">搜索任务</span>
            <input
              type="search"
              name="task-search"
              autoComplete="off"
              placeholder="搜索任务主题…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <label>
            <span className="sr-only">执行计划筛选</span>
            <select
              aria-label="执行计划筛选"
              value={planFilter}
              onChange={(e) => {
                setPlanFilter(e.target.value);
                setPage(0);
              }}
            >
              <option value="all">全部执行计划</option>
              <option value="manual">手动任务</option>
              <option value="scheduled">定时已启用</option>
              <option value="paused">定时已暂停</option>
            </select>
          </label>
          {state.data && (
            <span className="task-total">共 {state.data.total} 个任务</span>
          )}
        </div>
      )}
      {!state.data ? (
        !state.error && <p>正在读取任务…</p>
      ) : taskId ? (
        <div className="managed-task-list">{renderTasks()}</div>
      ) : state.data.rows.length ? (
        <div className="table-wrap task-table">
          <table>
            <caption className="sr-only">任务列表</caption>
            <thead>
              <tr>
                <th>任务主题</th>
                <th>执行计划</th>
                <th>下次执行</th>
                <th>最近状态</th>
                <th>自动发布</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>{renderTasks()}</tbody>
          </table>
        </div>
      ) : null}
      {!taskId && state.data && (
        <>
          {!state.data.rows.length && (
            <div className="panel task-list-empty">
              <h2>{state.data.total ? "没有匹配的任务" : "还没有任务"}</h2>
              <p>
                {state.data.total
                  ? "换个关键词，或清除筛选条件。"
                  : "新增一个研究任务，配置 Prompt 和执行计划。"}
              </p>
              {state.data.total > 0 && (
                <button
                  className="quiet"
                  onClick={() => {
                    setSearch("");
                    setQuery("");
                    setPlanFilter("all");
                    setPage(0);
                  }}
                >
                  清除筛选
                </button>
              )}
            </div>
          )}
          {(state.data.lastPage > 0 || query || planFilter !== "all") && (
            <div className="task-pagination">
              <p aria-live="polite">
                {state.data.matched
                  ? `显示 ${state.data.page * 10 + 1}–${Math.min((state.data.page + 1) * 10, state.data.matched)} / ${state.data.matched} 个任务`
                  : "0 个匹配任务"}
              </p>
              {state.data.lastPage > 0 && (
                <div>
                  <button
                    className="quiet"
                    disabled={state.data.page === 0}
                    onClick={() => setPage(state.data!.page - 1)}
                  >
                    上一页
                  </button>
                  <span>第 {state.data.page + 1} 页</span>
                  <button
                    className="quiet"
                    disabled={state.data.page >= state.data.lastPage}
                    onClick={() => setPage(state.data!.page + 1)}
                  >
                    下一页
                  </button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
