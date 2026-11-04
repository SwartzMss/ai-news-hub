import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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
  await screen.findByText(/日报生成阶段的原文抓取校验失败/);
  expect(
    screen.getByRole("tab", { name: "最终结果" }).getAttribute("aria-selected"),
  ).toBe("true");
  fireEvent.click(screen.getByRole("tab", { name: "Prompt 记录" }));
  expect(screen.getByText("日报生成（系统步骤）")).toBeTruthy();
  expect(screen.getByText("研究第 1 轮")).toBeTruthy();
  expect(screen.queryByText("第 2 轮")).toBeNull();
  expect(screen.queryByLabelText("下一轮 prompt")).toBeNull();
});

test("manual publication in progress is shown independently of the completed research run", async () => {
  const api = vi
    .fn()
    .mockImplementation(async (path: string) =>
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
