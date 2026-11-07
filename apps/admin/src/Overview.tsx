import { useCallback } from "react";
import type {
  OverviewDay,
  OverviewResponse,
  RunSummary,
} from "../../../packages/shared/src";
import { errorText, type Client } from "./api";
import { usePolling } from "./usePolling";
import { Badge, Icon, PageHeading, pathFor, type IconName } from "./ui";

const series = [
  ["succeeded", "成功"],
  ["failed", "失败"],
  ["stopped", "停止 / 中断"],
  ["active", "执行 / 排队"],
] as const;
function localTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
function duration(row: RunSummary) {
  const { started_at, finished_at } = row.run;
  if (!started_at) return "—";
  if (!finished_at)
    return ["queued", "running", "waiting_approval"].includes(row.run.status)
      ? "执行中"
      : "—";
  const seconds = Math.max(
    0,
    Math.round((Date.parse(finished_at) - Date.parse(started_at)) / 1000),
  );
  if (!Number.isFinite(seconds)) return "—";
  return seconds < 60
    ? `${seconds}秒`
    : `${Math.floor(seconds / 60)}分${seconds % 60}秒`;
}
function Trend({ days }: { days: OverviewDay[] }) {
  const max = Math.ceil(Math.max(2, ...days.map((day) => day.total)) / 2) * 2;
  return (
    <>
      <svg
        className="overview-trend"
        viewBox="0 0 640 185"
        role="img"
        aria-label="最近 7 天执行趋势"
      >
        {[0, 1, 2].map((i) => (
          <g key={i}>
            <line
              x1="30"
              x2="630"
              y1={170 - i * 70}
              y2={170 - i * 70}
              className="overview-gridline"
            />
            <text
              x="20"
              y={174 - i * 70}
              textAnchor="end"
              className="overview-axis"
            >
              {Math.round((max * i) / 2)}
            </text>
          </g>
        ))}
        {days.map((day, index) => {
          const x = 30 + (600 / 7) * (index + 0.5) - 18;
          let y = 170;
          return (
            <g key={day.date} tabIndex={0}>
              <title>
                {day.date}：共 {day.total} 次；
                {series
                  .map(([key, label]) => `${label} ${day[key]}`)
                  .join("，")}
              </title>
              {series.map(([key]) => {
                const height = (day[key] / max) * 140;
                y -= height;
                return (
                  <rect
                    key={key}
                    x={x}
                    y={y}
                    width="36"
                    height={height}
                    rx="2"
                    className={`trend-${key}`}
                  />
                );
              })}
              <text
                x={x + 18}
                y={y - 10}
                textAnchor="middle"
                className="overview-total"
              >
                {day.total}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="overview-date-axis" aria-hidden="true">
        {days.map((day) => (
          <span key={day.date}>{day.date.slice(5).replace("-", "/")}</span>
        ))}
      </div>
      <div className="overview-legend">
        {series.map(([key, label]) => (
          <span key={key}>
            <i className={`trend-${key}`} />
            {label}
          </span>
        ))}
      </div>
      <details className="overview-chart-data">
        <summary>查看每日明细</summary>
        <div className="table-wrap">
          <table>
            <caption className="sr-only">最近 7 天执行次数</caption>
            <thead>
              <tr>
                <th>日期</th>
                {series.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                <th>总计</th>
              </tr>
            </thead>
            <tbody>
              {days.map((day) => (
                <tr key={day.date}>
                  <th scope="row">{day.date}</th>
                  {series.map(([key]) => (
                    <td key={key}>{day[key]}</td>
                  ))}
                  <td>{day.total}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </>
  );
}
export function Overview({ api }: { api: Client }) {
  const load = useCallback(
    (signal: AbortSignal) => api<OverviewResponse>("/overview", signal),
    [api],
  );
  const { data, error } = usePolling(load, 10000);
  const total = data?.daily.reduce((n, d) => n + d.total, 0) ?? 0;
  const success = data?.daily.reduce((n, d) => n + d.succeeded, 0) ?? 0;
  const failed = data?.daily.reduce((n, d) => n + d.failed, 0) ?? 0;
  const metrics = data
    ? [
        {
          label: "任务总数",
          value: data.tasks.total,
          hint: `定时已启用 ${data.tasks.scheduled} 个`,
          icon: "grid",
          href: "#/tasks",
        },
        {
          label: "今日执行",
          value: data.todayRuns,
          hint: "今天发起的执行次数",
          icon: "clock",
          href: "#/runs",
        },
        {
          label: "正在运行",
          value: data.running,
          hint: `另有 ${data.queued} 次排队`,
          icon: "activity",
          href: "#/runs?state=running",
        },
        {
          label: "待审核日报",
          value: data.pendingReview,
          hint: `已批准待归档 ${data.pendingPublish} 份`,
          icon: "file",
          href: "#/runs?state=pending_review",
        },
      ]
    : [];
  return (
    <>
      <PageHeading
        title="系统概览"
        description={
          data ? `${localTime(data.generatedAt)} · 上海时间` : undefined
        }
        action={
          <a className="overview-manage" href="#/tasks">
            管理任务 <Icon name="arrow" size={15} />
          </a>
        }
      />
      {error ? (
        <p role="alert" className="error">
          {errorText(error)}
        </p>
      ) : null}
      {!data ? (
        !error && <p>正在读取系统概览…</p>
      ) : (
        <>
          <div className="overview-metrics">
            {metrics.map((metric) => (
              <a
                href={metric.href}
                className="panel overview-metric"
                key={metric.label}
              >
                <div>
                  <span>{metric.label}</span>
                  <Icon name={metric.icon as IconName} size={18} />
                </div>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </a>
            ))}
          </div>
          <div className="overview-charts">
            <section
              className="panel overview-chart-panel"
              aria-labelledby="trend-heading"
            >
              <div className="overview-section-heading">
                <h2 id="trend-heading">最近 7 天执行</h2>
                <span>共 {total} 次</span>
              </div>
              <div className="overview-trend-summary">
                <strong>
                  成功率{" "}
                  {success + failed
                    ? `${Math.round((success / (success + failed)) * 100)}%`
                    : "—"}
                </strong>
                <span>仅统计成功与失败的执行</span>
              </div>
              <Trend days={data.daily} />
            </section>

          </div>
          <section
            className="panel overview-attention"
            aria-labelledby="attention-heading"
          >
            <h2 id="attention-heading">待处理</h2>
            <div>
              {[
                ["待审核", data.pendingReview, "pending_review"],
                ["待归档", data.pendingPublish, "pending_review"],
                ["归档失败", data.publishFailed, "publish_failed"],
                ["近 7 天异常 / 中断", data.recentFailures, "failed"],
              ].map(([label, count, state]) => (
                <a key={label} href={`#/runs?state=${state}`}>
                  <span>{label}</span>
                  <strong>{count}</strong>
                  <Icon name="arrow" size={14} />
                </a>
              ))}
            </div>
          </section>
          <section
            className="panel overview-recent"
            aria-labelledby="recent-heading"
          >
            <div className="overview-section-heading">
              <h2 id="recent-heading">最近执行</h2>
              <a href="#/runs">全部记录 →</a>
            </div>
            {!data.recentRuns.length ? (
              <div className="overview-empty">
                <Icon name="inbox" size={30} />
                <h3>尚无执行记录</h3>
                <p>在任务总览中新增或运行一个任务，结果会显示在这里。</p>
                <a href="#/tasks">前往任务总览 →</a>
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>所属任务</th>
                      <th>状态</th>
                      <th>开始时间</th>
                      <th>耗时</th>
                      <th>操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentRuns.map((row) => (
                      <tr key={row.run.id}>
                        <td>
                          {row.task_name}
                          {row.task_deleted && (
                            <small className="muted">（已删除）</small>
                          )}
                        </td>
                        <td>
                          {row.state === "publish_failed" ? (
                            <span className="badge failed">归档失败</span>
                          ) : row.state === "running" &&
                            row.run.status === "succeeded" ? (
                            <span className="badge running">归档中</span>
                          ) : (
                            <Badge status={row.run.status} />
                          )}
                        </td>
                        <td>
                          {localTime(row.run.started_at ?? row.run.created_at)}
                        </td>
                        <td>{duration(row)}</td>
                        <td>
                          <a href={pathFor(row.run.task_id, row.run.id)}>
                            {row.report ? "查看结果" : "查看执行"}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <p className="overview-scope">
            执行统计包含已删除任务的历史，不含内置诊断任务。最近 7
            天按上海日历日期统计。
          </p>
        </>
      )}
    </>
  );
}
