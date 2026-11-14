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
  templateId?: string;
  templateVersion?: number;
  topic?: string;
  promptCount?: number;
  autoPublish: boolean;
  schedule: Plan;
  timezone: string;
};
export type ManagedTask = TaskRecord & {
  configuration?: Configuration;
  next_run_at?: string | null;
};

function scheduleTime(config?: Configuration): string {
  const plan = config?.schedule;
  return plan && "time" in plan && typeof plan.time === "string"
    ? plan.time
    : "08:00";
}
function scheduleEnabled(task: ManagedTask): boolean {
  return task.status === "active" && task.configuration?.schedule.kind === "daily";
}
function timezoneLabel(timezone?: string): string {
  return timezone === "Asia/Shanghai" ? "北京时间" : timezone ?? "北京时间";
}
function shortTime(value?: string | null, timezone = "Asia/Shanghai") {
  if (!value) return "待计算";
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
  task: ManagedTask;
  onClose: () => void;
  onSaved: () => void;
}) {
  const configuration = task.configuration!;
  const [time, setTime] = useState(() => scheduleTime(configuration));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current!;
    const opener = document.activeElement;
    const previousOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    dialog.querySelector<HTMLInputElement>('input[type="time"]')?.focus();
    return () => {
      if (dialog.close) dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await api(
        "/tasks/" + encodeURIComponent(task.id),
        AbortSignal.timeout(15000),
        {
          templateId: configuration.templateId,
          templateVersion: configuration.templateVersion,
          autoPublish: configuration.autoPublish,
          schedule: { kind: "daily", time },
          timezone: configuration.timezone || "Asia/Shanghai",
          status: task.status,
        },
        "PUT",
      );
      onSaved();
    } catch (cause) {
      setError(cause);
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
        <h2 id="task-editor-title">修改执行时间</h2>
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
              每日执行时刻（{timezoneLabel(configuration.timezone)}）
              <input
                type="time"
                required
                value={time}
                onChange={(event) => setTime(event.target.value)}
              />
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
            {busy ? "正在保存…" : "保存时间"}
          </button>
        </div>
      </form>
    </dialog>,
    document.body,
  );
}

type TaskAction = "start" | "stop" | "schedule" | "autoPublish";

export function ManagedTasks({
  api,
  taskId,
}: {
  api: Client;
  taskId?: string;
}) {
  const [revision, refresh] = useState(0);
  const [editing, setEditing] = useState<ManagedTask>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<unknown>();

  const load = useCallback(
    async (signal: AbortSignal) => {
      const { tasks } = await api<{ tasks: ManagedTask[] }>("/tasks", signal);
      const configured = tasks.filter(
        (task) =>
          !!task.configuration?.templateId &&
          Number.isSafeInteger(task.configuration.templateVersion) &&
          (!taskId || task.id === taskId),
      );
      const rows = await Promise.all(
        configured.map(async (task) => {
          const { runs } = await api<{ runs: RunRecord[] }>(
            "/tasks/" + encodeURIComponent(task.id) + "/runs?limit=1",
            signal,
          );
          return { task, current: runs[0] };
        }),
      );
      return { rows };
    },
    [api, taskId, revision],
  );

  const startKeys = useRef(new Map<string, string>());
  const state = usePolling(load, 5000);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);

  async function action(task: ManagedTask, kind: TaskAction) {
    if (busy) return;
    setBusy(task.id);
    setError(undefined);
    try {
      const base = "/tasks/" + encodeURIComponent(task.id);
      if (kind === "schedule" || kind === "autoPublish") {
        const configuration = task.configuration!;
        const enabled = scheduleEnabled(task);
        await api(
          base,
          controller.signal,
          {
            templateId: configuration.templateId,
            templateVersion: configuration.templateVersion,
            autoPublish:
              kind === "autoPublish"
                ? !configuration.autoPublish
                : configuration.autoPublish,
            schedule:
              kind === "schedule"
                ? { kind: "daily", time: scheduleTime(configuration) }
                : configuration.schedule,
            timezone: configuration.timezone || "Asia/Shanghai",
            status:
              kind === "schedule"
                ? enabled
                  ? "paused"
                  : "active"
                : task.status,
          },
          "PUT",
        );
      } else {
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
      refresh((value) => value + 1);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status >= 400 && cause.status < 500)
        startKeys.current.delete(task.id);
      setError(cause);
    } finally {
      setBusy(undefined);
    }
  }

  const renderTasks = () =>
    state.data?.rows.map(({ task, current }) => {
      const configuration = task.configuration!;
      const running = active(current?.status) || !!current?.publishing;
      const enabled = scheduleEnabled(task);
      const name = configuration.topic ?? task.name;
      const scheduleSwitch = (
        <label className="task-auto-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={"定时执行：" + name}
            checked={enabled}
            disabled={!!busy || running}
            onChange={() => void action(task, "schedule")}
          />
          <span aria-hidden="true">{enabled ? "开启" : "关闭"}</span>
        </label>
      );
      const autoPublishSwitch = (
        <label className="task-auto-switch">
          <input
            type="checkbox"
            role="switch"
            aria-label={"自动发布：" + name}
            checked={!!configuration.autoPublish}
            disabled={!!busy || running}
            onChange={() => void action(task, "autoPublish")}
          />
          <span aria-hidden="true">
            {configuration.autoPublish ? "开启" : "关闭"}
          </span>
        </label>
      );
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
            修改时间
          </button>
        </div>
      );
      const latestStatus = running ? (
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
      );

      if (!taskId) {
        return (
          <tr key={task.id}>
            <td>
              <a
                className="task-table-name"
                href={pathFor(task.id)}
                title={name}
              >
                {name}
              </a>
            </td>
            <td data-label="每日执行时刻">
              {scheduleTime(configuration)}
              <small className="task-table-secondary">
                {timezoneLabel(configuration.timezone)}
              </small>
            </td>
            <td data-label="下次执行">
              {enabled
                ? shortTime(task.next_run_at, configuration.timezone)
                : "已关闭"}
            </td>
            <td data-label="最近状态">{latestStatus}</td>
            <td data-label="定时执行">{scheduleSwitch}</td>
            <td data-label="自动发布">{autoPublishSwitch}</td>
            <td className="task-table-actions" data-label="操作">
              {controls}
            </td>
          </tr>
        );
      }

      return (
        <article className="panel managed-task" key={task.id}>
          <div className="managed-task-heading">
            <div className="task-state-group">
              <span className="task-schedule-state">
                {enabled ? "定时已开启" : "定时已关闭"}
              </span>
              {latestStatus}
            </div>
          </div>
          <dl className="managed-facts">
            <div>
              <dt>
                每日执行时刻
                <span className="task-timezone">
                  {timezoneLabel(configuration.timezone)}
                </span>
              </dt>
              <dd>{scheduleTime(configuration)}</dd>
            </div>
            <div>
              <dt>下次执行</dt>
              <dd>
                {enabled
                  ? shortTime(task.next_run_at, configuration.timezone)
                  : "已关闭"}
              </dd>
            </div>
            <div>
              <dt>定时执行</dt>
              <dd>{scheduleSwitch}</dd>
            </div>
            <div>
              <dt>自动发布到 GitHub</dt>
              <dd>{autoPublishSwitch}</dd>
            </div>
          </dl>
          <div className="managed-task-footer">{controls}</div>
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
      />
      {error || state.error ? (
        <p className="error" role="alert">
          {errorText(error ?? state.error)}
        </p>
      ) : null}
      {editing && (
        <TaskEditor
          key={editing.id}
          api={api}
          task={editing}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            refresh((value) => value + 1);
          }}
        />
      )}
      {!state.data ? (
        !state.error && <p>正在读取任务…</p>
      ) : state.data.rows.length ? (
        taskId ? (
          <div className="managed-task-list">{renderTasks()}</div>
        ) : (
          <div className="table-wrap task-table">
            <table>
              <caption className="sr-only">固定任务列表</caption>
              <thead>
                <tr>
                  <th>任务主题</th>
                  <th>每日执行时刻</th>
                  <th>下次执行</th>
                  <th>最近状态</th>
                  <th>定时执行</th>
                  <th>自动发布</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>{renderTasks()}</tbody>
            </table>
          </div>
        )
      ) : (
        <div className="panel task-list-empty">
          <h2>{taskId ? "任务不存在" : "暂无系统任务"}</h2>
          <p>
            {taskId
              ? "该任务不存在或已不可用。"
              : "未读取到已配置的固定任务，请检查后端任务初始化。"}
          </p>
        </div>
      )}
    </>
  );
}
