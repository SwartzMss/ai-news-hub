import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Runs } from "./Runs";
import { RunDetail } from "./TaskViews";
afterEach(cleanup);
const run = {
  id: "run-one",
  task_id: "task-one",
  status: "failed",
  error_code: "source_fetch_failed",
  created_at: "2026-11-04T23:24:38Z",
  configuration: { prompts: ["搜索原文"], autoPublish: false },
};
test("results list separates finalization from research and supports filters and pagination", async () => {
  const api = vi.fn().mockImplementation(async (path: string) =>
    path === "/tasks"
      ? { tasks: [{ id: "task-one", name: "每日研究" }] }
      : {
          runs: [
            {
              run,
              task_name: "每日研究",
              task_deleted: false,
              state: "failed",
              latest_turn: { sequence: 2, mode: "finalize" },
              report: null,
              publication: null,
            },
          ],
          total: 21,
        },
  );
  render(<Runs api={api} />);
  await screen.findByText("日报生成");
  expect(
    screen.getByRole("link", { name: "查看执行" }).getAttribute("href"),
  ).toBe("#/tasks/task-one/runs/run-one");
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await waitFor(() =>
    expect(api.mock.calls.some(([path]) => path.includes("offset=20"))).toBe(
      true,
    ),
  );
  fireEvent.change(screen.getByLabelText("执行状态"), {
    target: { value: "failed" },
  });
  await waitFor(() =>
    expect(
      api.mock.calls.some(
        ([path]) => path.includes("state=failed") && path.includes("offset=0"),
      ),
    ).toBe(true),
  );
});
test("managed results default to the report view and label system finalization independently", async () => {
  const api = vi.fn().mockImplementation(async (path: string) =>
    path.includes("/events")
      ? { events: [] }
      : path.startsWith("/news/runs/")
        ? { newsRun: { report_id: null } }
        : {
            run,
            turns: [
              {
                id: "one",
                sequence: 1,
                mode: "research",
                status: "succeeded",
                input_text: "搜索原文",
                output_text: "研究结果",
              },
              {
                id: "two",
                sequence: 2,
                mode: "finalize",
                status: "failed",
                error_code: "source_fetch_failed",
                input_text: "生成日报",
                output_text: null,
              },
            ],
          },
  );
  render(<RunDetail api={api} taskId="task-one" runId="run-one" />);
  await screen.findByText(/这条历史执行在原文抓取步骤失败/);
  expect(
    screen.getByRole("tab", { name: "最终结果" }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 与回复" }));
  expect(screen.getByText("日报生成（系统步骤）")).toBeTruthy();
  expect(screen.getByText("第 1 轮 Prompt")).toBeTruthy();
  expect(screen.queryByText("第 2 轮")).toBeNull();
  expect(screen.queryByLabelText("下一轮 prompt")).toBeNull();
});

test("manual publication in progress is shown independently of the completed research run", async () => {
  const api = vi.fn().mockImplementation(async (path: string) =>
    path === "/tasks"
      ? { tasks: [] }
      : {
          runs: [
            {
              run: {
                ...run,
                status: "succeeded",
                error_code: null,
                publishing: false,
              },
              task_name: "研究",
              task_deleted: false,
              state: "running",
              latest_turn: null,
              report: { id: "report", status: "approved", title: "日报" },
              publication: { status: "publishing", error_code: null },
            },
          ],
          total: 1,
        },
  );
  render(<Runs api={api} />);
  await screen.findByText("正在发布");
  expect(screen.queryByText("成功")).toBeNull();
});

test("source failure diagnostics expose bounded details and keep the repair stage distinct", async () => {
  const api = vi.fn().mockImplementation(async (path: string) =>
    path.includes("/events")
      ? { events: [] }
      : path.startsWith("/news/runs/")
        ? { newsRun: { report_id: null } }
        : {
            run,
            sourceFailures: [
              {
                url: "https://example.com/blocked",
                code: "source_http_failed",
                httpStatus: 403,
                attempts: 1,
              },
            ],
            turns: [
              {
                id: "repair",
                sequence: 3,
                idempotency_key: "source-repair",
                mode: "finalize",
                status: "failed",
                input_text: "修复来源",
                output_text: "未通过的候选JSON",
              },
            ],
          },
  );
  render(<RunDetail api={api} taskId="task-one" runId="run-one" />);
  await screen.findByText("https://example.com/blocked");
  expect(screen.getByText(/HTTP 403/)).toBeTruthy();
  expect(screen.getByText(/已尝试 1 次/)).toBeTruthy();
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 与回复" }));
  expect(screen.getByText("来源修复（系统步骤）")).toBeTruthy();
  expect(
    within(screen.getByRole("tabpanel", { name: "Prompt 与回复" })).getByText(
      "未通过的候选JSON",
    ),
  ).toBeTruthy();
  expect(screen.getByText(/以下生成内容未通过校验/)).toBeTruthy();
});

test("task filter only offers configured user tasks, retaining legacy run history", async () => {
  const api = vi.fn().mockImplementation(async (path: string) =>
    path === "/tasks"
      ? {
          tasks: [
            {
              id: "task-one",
              name: "每日研究",
              configuration: run.configuration,
            },
            { id: "news-research", name: "Codex 主题新闻研究" },
            { id: "sample-connectivity", name: "Codex connectivity sample" },
          ],
        }
      : {
          runs: [
            {
              run: { ...run, task_id: "sample-connectivity" },
              task_name: "Codex connectivity sample",
              task_deleted: false,
              state: "failed",
              latest_turn: null,
              report: null,
              publication: null,
            },
          ],
          total: 1,
        },
  );
  render(<Runs api={api} />);
  await screen.findByRole("option", { name: "每日研究" });
  const filter = within(screen.getByLabelText("所属任务"));
  expect(
    filter.queryByRole("option", { name: "Codex 主题新闻研究" }),
  ).toBeNull();
  expect(
    filter.queryByRole("option", { name: "Codex connectivity sample" }),
  ).toBeNull();
  expect(screen.getByText("Codex connectivity sample")).toBeTruthy();
});

test("the last configured Prompt is displayed as its own round rather than an extra system step", async () => {
  const api = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path.includes("/events")
        ? { events: [] }
        : path.startsWith("/news/runs/")
          ? { newsRun: { report_id: null } }
          : {
              run: { ...run, status: "running", error_code: null },
              turns: [
                {
                  id: "one",
                  sequence: 1,
                  mode: "finalize",
                  status: "running",
                  input_text: "我的完整指令",
                  output_text: null,
                },
              ],
            },
    );
  render(<RunDetail api={api} taskId="task-one" runId="run-one" />);
  await screen.findByRole("tab", { name: "Prompt 与回复" });
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 与回复" }));
  expect(screen.getByText("第 1 轮 Prompt")).toBeTruthy();
  expect(screen.getByText("我的完整指令")).toBeTruthy();
  expect(screen.queryByText("日报生成（系统步骤）")).toBeNull();
  expect(screen.queryByText("系统步骤")).toBeNull();
});

test.each(['task-one', 'news-research'])('successful final Prompt shows one readable reply for %s', async (taskId) => {
  const report = { id: 'report-one', version: 1, status: 'validated', document: {
    title: '本轮完整日报', reportDate: '2026-11-07', collectedAt: '2026-11-07T00:00:00Z', items: [{
      articleId: 'source-one', category: 'opensource', importance: 3,
      factSummary: '这次回复的实际内容。', analysis: null, evidenceQuote: 'Official source announcement', verification: 'codex_reported',
      source: {name: 'Official', canonicalUrl: 'https://example.com/release', publishedAt: null, eventAt: null, fetchedAt: null}
    }]
  }};
  const api = vi.fn().mockImplementation(async (path: string) => {
    if (path.includes('/events')) return { events: [] };
    if (path.startsWith('/news/runs/')) return { newsRun: { report_id: report.id } };
    if (path.endsWith('/publication')) return { publications: [], contentHash: 'hash', configured: false };
    if (path.startsWith('/news/reports/')) return { report };
    return { run: {...run, task_id:taskId, status:'succeeded', error_code: null}, turns:[{
      id:'final', sequence:1, mode:'finalize', status:'succeeded', input_text:'我的日报要求', output_text:'{"title":"保存的原始回复"}'
    }]};
  });
  render(<RunDetail api={api} taskId={taskId} runId="run-one" />);
  await screen.findAllByText('本轮完整日报');
  const conversationName = taskId === 'task-one' ? 'Prompt 与回复' : '研究会话';
  fireEvent.click(screen.getByRole('tab', {name:conversationName}));
  const panel=within(screen.getByRole('tabpanel', {name:conversationName}));
  expect(panel.getByText('这次回复的实际内容。')).toBeTruthy();
  expect(panel.getByText('原始回复')).toBeTruthy();
  expect(panel.getByText('{"title":"保存的原始回复"}')).toBeTruthy();
  expect(panel.queryByText(/日报已生成，可在/)).toBeNull();
  expect(screen.getByRole('tab', {name:'诊断日志'})).toBeTruthy();
  expect(screen.queryByRole('tab', {name:'运行信息'})).toBeNull();
  expect(screen.getAllByRole('tab')).toHaveLength(taskId === 'task-one' ? 3 : 2);
  expect(panel.getAllByLabelText('简报阅读预览')).toHaveLength(1);
  fireEvent.click(screen.getByRole('tab', {name:'诊断日志'}));
  const diagnostics=within(screen.getByRole('tabpanel', {name:'诊断日志'}));
  expect(diagnostics.getByRole('heading', {name:'运行信息'})).toBeTruthy();
  expect(diagnostics.getByText('run-one')).toBeTruthy();
  expect(diagnostics.getByText('暂无诊断日志。')).toBeTruthy();
});
