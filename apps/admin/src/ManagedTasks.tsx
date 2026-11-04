import { createPortal } from "react-dom";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { TaskRecord, RunRecord } from "../../../packages/shared/src";
import { ApiError, errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { active, PageHeading, pathFor } from "./ui";

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
function closeTaskMenu(button: HTMLButtonElement) {
  const menu = button.closest("details");
  menu?.removeAttribute("open");
  menu?.querySelector("summary")?.focus();
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
                disabled={config.prompts.length >= 19}
                onClick={() => update({ prompts: [...config.prompts, ""] })}
              >
                添加一轮
              </button>
              <p className="field-help">
                以上为研究轮次。完成后系统会额外执行“日报生成”，核验来源并保存结果。
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
  const [revision, refresh] = useState(0),
    [editing, setEditing] = useState<ManagedTask | "new">(),
    [busy, setBusy] = useState<string>(),
    [error, setError] = useState<unknown>(),
    [deleting, setDeleting] = useState<string>();
  const load = useCallback(
    async (signal: AbortSignal) => {
      const { tasks } = await api<{ tasks: ManagedTask[] }>("/tasks", signal);
      return Promise.all(
        tasks
          .filter((t) => !taskId || t.id === taskId)
          .map(async (task) => {
            const base = `/tasks/${encodeURIComponent(task.id)}/runs`;
            const { runs } = await api<{ runs: RunRecord[] }>(
              `${base}?limit=1`,
              signal,
            );
            const current = runs[0];
            return { task, runs, current };
          }),
      );
    },
    [api, taskId, revision],
  );
  const startKeys = useRef(new Map<string, string>());
  const state = usePolling(load);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  async function action(
    task: ManagedTask,
    kind: "start" | "stop" | "pause" | "delete",
  ) {
    if (busy) return;
    setBusy(task.id);
    setError(undefined);
    try {
      const base = `/tasks/${encodeURIComponent(task.id)}`;
      if (kind === "delete") {
        await api(base, controller.signal, undefined, "DELETE");
        if (taskId) location.hash = "#";
      } else if (kind === "pause")
        await api(
          base,
          controller.signal,
          {
            name: task.name,
            ...task.configuration,
            status: task.status === "active" ? "paused" : "active",
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
  const selected = state.data?.[0];
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
      {!state.data ? (
        <p>正在读取任务…</p>
      ) : (
        <div className="managed-task-list">
          {state.data
            .filter((row) => row.task.configuration || taskId)
            .map(({ task, current }) => {
              const running = active(current?.status) || !!current?.publishing;
              const scheduled = task.configuration?.schedule.kind !== "manual";
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
                          : shortTime(
                              task.next_run_at,
                              task.configuration?.timezone,
                            )}
                      </dd>
                    </div>
                    <div>
                      <dt>研究 Prompt</dt>
                      <dd>{task.configuration?.prompts.length ?? 1} 轮</dd>
                    </div>
                    <div>
                      <dt>自动发布</dt>
                      <dd>
                        {task.configuration?.autoPublish ? "开启" : "关闭"}
                      </dd>
                    </div>
                  </dl>
                  <div className="managed-task-footer">
                    <div className="task-actions">
                      <button
                        disabled={!!busy}
                        onClick={() =>
                          void action(task, running ? "stop" : "start")
                        }
                      >
                        {running ? "停止执行" : "立即运行"}
                      </button>
                      <details className="task-more">
                        <summary>更多</summary>
                        <div className="task-more-options">
                          <button
                            className="quiet"
                            disabled={!!busy || running}
                            onClick={(event) => {
                              closeTaskMenu(event.currentTarget);
                              setEditing(task);
                            }}
                          >
                            编辑
                          </button>
                          {scheduled && (
                            <button
                              className="quiet"
                              disabled={!!busy || running}
                              onClick={(event) => {
                                closeTaskMenu(event.currentTarget);
                                void action(task, "pause");
                              }}
                            >
                              {task.status === "active"
                                ? "暂停定时"
                                : "启用定时"}
                            </button>
                          )}
                          <button
                            className="quiet danger-action"
                            disabled={!!busy || running}
                            onClick={(event) => {
                              closeTaskMenu(event.currentTarget);
                              setDeleting(task.id);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </details>
                    </div>
                    <a href={`#/runs?taskId=${encodeURIComponent(task.id)}`}>
                      运行记录
                    </a>
                  </div>
                  {deleting === task.id && (
                    <div className="delete-confirm" role="alert">
                      <p>删除此任务？执行与发布历史会保留。</p>
                      <button
                        className="quiet"
                        onClick={() => setDeleting(undefined)}
                      >
                        取消
                      </button>
                      <button
                        disabled={!!busy}
                        onClick={() => void action(task, "delete")}
                      >
                        确认删除
                      </button>
                    </div>
                  )}
                </article>
              );
            })}
        </div>
      )}
      {!taskId &&
        state.data &&
        !state.data.some((row) => row.task.configuration) && (
          <p className="muted">还没有任务，点击“新增任务”开始配置。</p>
        )}
    </>
  );
}
