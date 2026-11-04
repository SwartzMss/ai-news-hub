import { useCallback, useState } from "react";
import type { RunListResponse, TaskRecord } from "../../../packages/shared/src";
import { errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { Badge, PageHeading, pathFor, time } from "./ui";
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
}: {
  api: Client;
  initialTaskId?: string;
}) {
  const [state, setState] = useState("all"),
    [taskId, setTaskId] = useState(initialTaskId),
    [page, setPage] = useState(0);
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
      return { ...result, tasks: tasks.tasks };
    },
    [api, state, taskId, page],
  );
  const { data, error } = usePolling(load);
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
                    {row.latest_turn?.mode === "finalize"
                      ? "日报生成"
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
                    <a href={pathFor(row.run.task_id, row.run.id)}>
                      {row.report ? "查看日报" : "查看执行"}
                    </a>
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
