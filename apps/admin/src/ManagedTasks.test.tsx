import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ManagedTasks } from "./ManagedTasks";
import { client } from "./api";
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const config = {
  topic: "模型公告",
  prompts: ["搜索原文", "核对日期"],
  autoPublish: false,
  schedule: { kind: "manual" },
  timezone: "Asia/Shanghai",
};
const task = {
  id: "managed-one",
  name: "每日研究",
  status: "active",
  configuration: config,
};
function fixture() {
  const api = vi
    .fn()
    .mockImplementation(
      async (
        path: string,
        _signal?: AbortSignal,
        body?: unknown,
        method?: string,
      ) => {
        if (method === "DELETE") return { deleted: true };
        if (body) return { task };
        return path === "/tasks" ? { tasks: [task] } : { runs: [] };
      },
    );
  return api;
}
test("editor submits ordered prompts and a kind-specific plan with explicit automatic publication", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByText("模型公告");
  fireEvent.click(screen.getByText("更多"));
  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "上移" })[1]);
  fireEvent.click(screen.getByLabelText("自动发布到 GitHub"));
  fireEvent.change(screen.getByLabelText("执行计划"), {
    target: { value: "daily" },
  });
  fireEvent.change(screen.getByLabelText("执行时刻"), {
    target: { value: "10:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存任务" }));
  await waitFor(() =>
    expect(api.mock.calls.some((call) => call[3] === "PUT")).toBe(true),
  );
  const body = api.mock.calls.find((call) => call[3] === "PUT")![2] as Record<
    string,
    unknown
  >;
  expect(body.name).toBe(body.topic);
  expect(body.prompts).toEqual(["核对日期", "搜索原文"]);
  expect(body.autoPublish).toBe(true);
  expect(body.schedule).toEqual({ kind: "daily", time: "10:30" });
});
test("deletion requires confirmation and uses DELETE without a request body", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByText("模型公告");
  fireEvent.click(screen.getByText("更多"));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  expect(api.mock.calls.some((call) => call[3] === "DELETE")).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await waitFor(() =>
    expect(api.mock.calls.some((call) => call[3] === "DELETE")).toBe(true),
  );
});
test("HTTP client preserves an explicit DELETE method when body is absent", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", fetcher);
  await client("token", () => {})("/tasks/one", undefined, undefined, "DELETE");
  expect(fetcher.mock.calls[0][1].method).toBe("DELETE");
  expect(fetcher.mock.calls[0][1].body).toBeUndefined();
});

test("switching the editor target loads the new task instead of carrying previous values", async () => {
  const second = {
    ...task,
    id: "second-task",
    name: "第二任务",
    configuration: { ...config, topic: "新主题" },
  };
  const api = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path === "/tasks" ? { tasks: [task, second] } : { runs: [] },
    );
  render(<ManagedTasks api={api} />);
  await screen.findByText("模型公告");
  fireEvent.click(screen.getAllByText("更多")[0]);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[0]);
  expect((screen.getByLabelText("任务主题") as HTMLInputElement).value).toBe(
    "模型公告",
  );
  fireEvent.click(screen.getAllByText("更多")[1]);
  fireEvent.click(screen.getAllByRole("button", { name: "编辑" })[1]);
  expect((screen.getByLabelText("任务主题") as HTMLInputElement).value).toBe(
    "新主题",
  );
});

test("a paused schedule still allows manual execution with a single primary action", async () => {
  const paused = {
    ...task,
    status: "paused",
    configuration: { ...config, schedule: { kind: "daily", time: "09:00" } },
  };
  const api = vi
    .fn()
    .mockImplementation(
      async (path: string, _signal?: AbortSignal, body?: unknown) =>
        body
          ? { run: { id: "started" } }
          : path === "/tasks"
            ? { tasks: [paused] }
            : { runs: [] },
    );
  render(<ManagedTasks api={api} />);
  await screen.findByText("定时已暂停");
  expect(screen.queryByRole("button", { name: "停止执行" })).toBeNull();
  expect(screen.queryByLabelText("任务名称")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "立即运行" }));
  await waitFor(() =>
    expect(
      api.mock.calls.some(
        (call) => call[0] === "/tasks/managed-one/runs" && call[2],
      ),
    ).toBe(true),
  );
});

test("an active execution replaces Run with Stop and separates the schedule state", async () => {
  const scheduled = {
    ...task,
    configuration: { ...config, schedule: { kind: "daily", time: "09:00" } },
  };
  const api = vi.fn().mockImplementation(async (path: string) =>
    path === "/tasks"
      ? { tasks: [scheduled] }
      : {
          runs: [
            {
              id: "running",
              status: "running",
              created_at: "2026-11-04T01:00:00Z",
            },
          ],
        },
  );
  render(<ManagedTasks api={api} />);
  await screen.findByText("定时已启用");
  expect(screen.getByRole("status").textContent).toBe("运行中");
  expect(screen.getByRole("button", { name: "停止执行" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "立即运行" })).toBeNull();
  expect(screen.queryByRole("link", { name: "运行记录" })).toBeNull();
});

test("task editor is a separate modal that closes on cancel and restores focus", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByText("模型公告");
  const trigger = screen.getByRole("button", { name: "新增任务" });
  trigger.focus();
  fireEvent.click(trigger);
  const dialog = await screen.findByRole("dialog", { name: "新增任务" });
  expect(dialog.closest(".managed-task-list")).toBeNull();
  expect(document.documentElement.style.overflow).toBe("hidden");
  expect(document.activeElement).toBe(screen.getByLabelText("任务主题"));
  fireEvent(dialog, new Event("cancel", { cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.documentElement.style.overflow).toBe("");
  expect(document.activeElement).toBe(trigger);
});

test("many tasks are paged and only the visible tasks load execution state", async () => {
  const tasks = Array.from({ length: 23 }, (_, i) => ({
    ...task,
    id: `task-${i}`,
    name: `任务 ${i}`,
    configuration: { ...config, topic: `任务 ${i}` },
  }));
  const api = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path === "/tasks" ? { tasks } : { runs: [] },
    );
  render(<ManagedTasks api={api} />);
  await screen.findByRole("link", { name: "任务 0" });
  expect(screen.queryByRole("link", { name: "任务 10" })).toBeNull();
  expect(api.mock.calls.filter(([p]) => p.includes("/runs"))).toHaveLength(10);
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("link", { name: "任务 10" });
  await new Promise((resolve) => setTimeout(resolve, 300));
  expect(screen.getByRole("link", { name: "任务 10" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "任务 0" })).toBeNull();
  fireEvent.change(screen.getByRole("searchbox", { name: "搜索任务" }), {
    target: { value: "任务 22" },
  });
  await screen.findByRole("link", { name: "任务 22" });
  expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
  expect(screen.queryByRole("link", { name: "运行记录" })).toBeNull();
});
test("plan filter handles manual, enabled and paused schedules without hiding the editor", async () => {
  const tasks = [
    task,
    {
      ...task,
      id: "daily",
      configuration: {
        ...config,
        topic: "每日模型",
        schedule: { kind: "daily", time: "09:00" },
      },
    },
  ];
  const api = vi
    .fn()
    .mockImplementation(async (path: string) =>
      path === "/tasks" ? { tasks } : { runs: [] },
    );
  render(<ManagedTasks api={api} />);
  await screen.findByText("模型公告");
  fireEvent.change(screen.getByRole("combobox", { name: "执行计划筛选" }), {
    target: { value: "scheduled" },
  });
  await screen.findByRole("link", { name: "每日模型" });
  await waitFor(() =>
    expect(screen.queryByRole("link", { name: "模型公告" })).toBeNull(),
  );
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  await screen.findByRole("dialog", { name: "编辑任务" });
});

test("deleting the last task on a page returns to a valid page", async () => {
  let tasks = Array.from({ length: 11 }, (_, i) => ({
    ...task,
    id: `page-${i}`,
    configuration: { ...config, topic: `分页任务 ${i}` },
  }));
  const api = vi
    .fn()
    .mockImplementation(
      async (
        path: string,
        _signal: AbortSignal,
        _body: unknown,
        method: string,
      ) => {
        if (method === "DELETE") {
          tasks = tasks.filter((t) => path !== `/tasks/${t.id}`);
          return {};
        }
        return path === "/tasks" ? { tasks } : { runs: [] };
      },
    );
  render(<ManagedTasks api={api} />);
  await screen.findByRole("link", { name: "分页任务 0" });
  fireEvent.click(screen.getByRole("button", { name: "下一页" }));
  await screen.findByRole("link", { name: "分页任务 10" });
  fireEvent.click(screen.getByText("更多"));
  fireEvent.click(screen.getByRole("button", { name: "删除" }));
  fireEvent.click(screen.getByRole("button", { name: "确认删除" }));
  await screen.findByRole("link", { name: "分页任务 0" });
  expect(screen.queryByRole("link", { name: "分页任务 10" })).toBeNull();
  expect(screen.queryByRole("button", { name: "下一页" })).toBeNull();
});
