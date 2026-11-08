import { useCallback, useEffect, useRef, useState } from "react";
import type { RunListResponse, RunSummary, TaskRecord } from "../../../packages/shared/src";
import { errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { active, Badge, PageHeading, pathFor, time } from "./ui";
const states = [
  ["all", "全部"],
  ["running", "运行中"],
  ["pending_review", "待审核 / 待发布"],
  ["failed", "执行异常"],
  ["publish_failed", "发布失败"],
  ["published", "已发布"],
];
export function Runs({
  api,
  initialTaskId = "",
  initialState = "all",
}: {
  api: Client;
  initialTaskId?: string;
  initialState?: string;
}) {
  const [state, setState] = useState(
      states.some(([id]) => id === initialState) ? initialState : "all",
    ),
    [taskId, setTaskId] = useState(initialTaskId),
    [page, setPage] = useState(0);
  const [refresh, setRefresh] = useState(0);
  const [selected, setSelected] = useState<RunSummary>();
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<unknown>();
  const pending = useRef(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current!;
    const previousOverflow = document.documentElement.style.overflow;
    const trigger = opener.current;
    document.documentElement.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    cancelButton.current?.focus();
    return () => {
      if (dialog.close) dialog.close();
      document.documentElement.style.overflow = previousOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [selected]);
  const load = useCallback(
    async (signal: AbortSignal) => {
      const query = new URLSearchParams({
        state,
        limit: "20",
        offset: String(page * 20),
      });
      if (taskId) query.set("taskId", taskId);
      const [result, tasks] = await Promise.all([
        api<RunListResponse>("/runs?" + query, signal),
        api<{ tasks: TaskRecord[] }>("/tasks", signal),
      ]);
      return {
        ...result,
        tasks: tasks.tasks.filter((task) => task.configuration),
      };
    },
    [api, state, taskId, page, refresh],
  );
  const { data, error } = usePolling(load);
  async function remove() {
    if (!selected || pending.current) return;
    pending.current = true;
    setDeleting(true);
    setDeleteError(undefined);
    try {
      await api(`/runs/${encodeURIComponent(selected.run.id)}`, AbortSignal.timeout(120000), {confirm:true}, 'DELETE');
      setSelected(undefined);
      if (page > 0 && data?.runs.length === 1) setPage(value => value - 1);
      else setRefresh(value => value + 1);
    } catch (cause) {
      setDeleteError(cause);
    } finally {
      pending.current = false;
      setDeleting(false);
    }
  }
  return (
    <>
      <PageHeading title="运行与结果" />
      <div className="run-filters">
        <label>
          所属任务
          <select
            value={taskId}
            onChange={(e) => {
              setTaskId(e.target.value);
              setPage(0);
            }}
            aria-label="所属任务"
          >
            <option value="">全部任务</option>
            {data?.tasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
            {taskId && !data?.tasks.some((task) => task.id === taskId) && (
              <option value={taskId}>历史任务</option>
            )}
          </select>
        </label>
        <label>
          执行状态
          <select
            aria-label="执行状态"
            value={state}
            onChange={(e) => {
              setState(e.target.value);
              setPage(0);
            }}
          >
            {states.map(([id, label]) => (
              <option key={id} value={id}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p role="alert" className="error">
          {errorText(error)}
        </p>
      ) : null}
      {selected && (
        <dialog
          ref={dialogRef}
          className="run-delete-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="run-delete-title"
          aria-describedby="run-delete-description"
          aria-busy={deleting}
          onKeyDown={event => {
            if (event.key !== "Tab") return;
            const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button:not(:disabled)");
            const first = buttons[0], last = buttons[buttons.length - 1];
            if (!first) event.preventDefault();
            else if (event.shiftKey && document.activeElement === first) {
              event.preventDefault(); last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault(); first.focus();
            }
          }}
          onCancel={event => {
            event.preventDefault();
            if (!pending.current) setSelected(undefined);
          }}
        >
          <header className="run-delete-header">
            <h2 id="run-delete-title">删除执行记录</h2>
            <p>此操作无法撤销，请确认要删除的记录。</p>
          </header>
          <div className="run-delete-body">
            <dl className="run-delete-target">
              <div><dt>所属任务</dt><dd>{selected.task_name}</dd></div>
              <div><dt>触发时间</dt><dd>{time(selected.run.created_at)}</dd></div>
            </dl>
            <p id="run-delete-description">将删除本次执行、对话和日志。有日报时会同步删除日报与 GitHub 归档，公开站和 RSS 随后续构建更新。</p>
            {deleteError ? <p role="alert" className="error">{errorText(deleteError)}</p> : null}
          </div>
          <div className="run-delete-actions">
            <button ref={cancelButton} className="quiet" disabled={deleting} onClick={() => setSelected(undefined)}>取消</button>
            <button className="run-delete-confirm" disabled={deleting} onClick={() => void remove()}>{deleting ? '正在删除…' : '确认删除'}</button>
          </div>
        </dialog>
      )}
      {!data ? (
        <p>正在读取执行记录…</p>
      ) : !data.runs.length ? (
        <div className="panel">
          <p>没有符合条件的执行记录。</p>
        </div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>所属任务</th>
                <th>执行阶段</th>
                <th>状态</th>
                <th>最终结果</th>
                <th>触发时间</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {data.runs.map((row) => (
                <tr key={row.run.id}>
                  <td>
                    {row.task_name}
                    {row.task_deleted && (
                      <small className="muted">（任务已删除）</small>
                    )}
                  </td>
                  <td>
                    {row.latest_turn &&
                    row.run.configuration &&
                    row.latest_turn.sequence <=
                      row.run.configuration.prompts.length
                      ? `Prompt ${row.latest_turn.sequence} / ${row.run.configuration.prompts.length}`
                      : row.latest_turn?.mode === "finalize"
                        ? row.run.configuration &&
                          row.latest_turn.sequence >
                            row.run.configuration.prompts.length + 1
                          ? "来源修复"
                          : "日报生成"
                        : row.latest_turn
                          ? `研究 ${row.latest_turn.sequence}${row.run.configuration ? ` / ${row.run.configuration.prompts.length}` : ""}`
                          : "等待执行"}
                  </td>
                  <td>
                    {row.run.publishing ||
                    row.publication?.status === "publishing" ? (
                      "正在发布"
                    ) : (
                      <Badge status={row.run.status} />
                    )}
                  </td>
                  <td>
                    {row.state === "publish_failed"
                      ? "发布失败"
                      : row.report
                        ? ({
                            validated: "待审核",
                            approved: "待发布",
                            published: "已发布",
                            rejected: "已拒绝",
                          }[row.report.status] ?? row.report.status)
                        : row.run.status === "failed"
                          ? "未生成日报"
                          : "尚无日报"}
                    {row.run.error_code && (
                      <p className="inline-error">{row.run.error_code}</p>
                    )}
                  </td>
                  <td>{time(row.run.created_at)}</td>
                  <td>
                    <div className="run-row-actions">
                      <a href={pathFor(row.run.task_id, row.run.id)}>
                        {row.report ? "查看日报" : "查看执行"}
                      </a>
                      <button
                        className="quiet"
                        disabled={deleting || active(row.run.status) || row.run.publishing || row.publication?.status === 'publishing'}
                        onClick={event => { opener.current = event.currentTarget; setSelected(row); setDeleteError(undefined); }}
                      >
                        删除记录
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data && (
        <div className="pagination">
          <span>
            共 {data.total} 条，第 {page + 1} 页
          </span>
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
              disabled={(page + 1) * 20 >= data.total}
              onClick={() => setPage((n) => n + 1)}
            >
              下一页
            </button>
          </div>
        </div>
      )}
    </>
  );
}
