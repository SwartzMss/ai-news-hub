import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { App } from "./App";
const task = {
  id: "sample-connectivity",
  name: "连接检查",
  channel: "test",
  status: "active",
  prompt: "Read-only sample",
  schedule: null,
  timezone: "UTC",
};
const run = {
  id: "run-1",
  task_id: task.id,
  status: "succeeded",
  created_at: "2026-11-03T00:00:00Z",
  error_code: null,
  thread_id: "thread-1",
  turn_id: "turn-1",
};
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  location.hash = "";
});
function mockFetch(fail?: number) {
  const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/auth/status")
      return Response.json({ initialized: true, mode: "token" });
    if (fail)
      return new Response(
        JSON.stringify({
          error: {
            code: fail === 401 ? "unauthorized" : "management_disabled",
          },
        }),
        { status: fail },
      );
    if (url === "/api/auth/login")
      return Response.json({ token: "test_only_0123456789_abcdefghijklmnop" });
    if (url === "/api/overview")
      return Response.json({
        timezone: "Asia/Shanghai",
        generatedAt: "2026-11-06T00:00:00Z",
        tasks: { total: 0, manual: 0, scheduled: 0, paused: 0 },
        todayRuns: 0,
        running: 0,
        queued: 0,
        pendingReview: 0,
        pendingPublish: 0,
        publishFailed: 0,
        recentFailures: 0,
        daily: [],
        recentRuns: [],
      });
    if (url === "/api/tasks") return Response.json({ tasks: [task] });
    if (url === "/api/settings")
      return Response.json({
        revision: 1,
        logLevel: "info",
        codex: { binary: "codex", model: "" },
        execution: { timeoutMs: 120000, concurrency: 1, maxQueue: 20 },
        github: {
          enabled: false,
          repository: "",
          branch: "",
          tokenConfigured: false,
        },
      });
    if (url.includes("/events"))
      return Response.json({
        events: [
          {
            id: 1,
            kind: "finished",
            created_at: run.created_at,
            data: { status: "succeeded" },
          },
        ],
      });
    if (url.startsWith("/api/news/runs"))
      return new Response("{}", { status: 404 });
    if (url === "/api/runs/run-1")
      return Response.json({
        run,
        turns: [
          {
            id: "turn-1",
            sequence: 1,
            status: "succeeded",
            output_text: "<script>unsafe</script>",
          },
        ],
      });
    if (init?.method === "POST") return Response.json({ run });
    if (url.includes("/runs")) return Response.json({ runs: [run] });
    return Response.json({ task });
  });
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
async function login() {
  fireEvent.change(await screen.findByLabelText("管理 Token"), {
    target: { value: "test_only_0123456789_abcdefghijklmnop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "连接后台" }));
  await screen.findByRole("heading", { name: "系统概览" });
}
test("authenticated Task → Run navigation renders real metadata, safe output and missing-report state", async () => {
  const fetcher = mockFetch();
  render(<App />);
  await login();
  location.hash = "#/tasks/sample-connectivity";
  fireEvent(window, new HashChangeEvent("hashchange"));
  await screen.findByRole("heading", { name: "连接检查" });
  fireEvent.click(await screen.findByRole("link", { name: "run-1" }));
  const conversation = await screen.findByRole("tab", { name: "研究会话" });
  expect(document.querySelectorAll('.primary-nav [aria-current="page"]')).toHaveLength(1);
  expect(screen.getByRole("link", {name:"运行与结果"}).getAttribute("aria-current")).toBe("page");
  expect(
    screen.getByRole("link", { name: "所属任务" }).getAttribute("href"),
  ).toBe("#/tasks/sample-connectivity");
  expect(conversation.getAttribute("aria-selected")).toBe("true");
  fireEvent.keyDown(conversation, { key: "End" });
  expect(
    screen.getByRole("tab", { name: "运行信息" }).getAttribute("aria-selected"),
  ).toBe("true");
  await screen.findByText("thread-1");
  fireEvent.keyDown(screen.getByRole("tab", { name: "运行信息" }), {
    key: "Home",
  });
  expect(conversation.getAttribute("aria-selected")).toBe("true");
  await screen.findByText("此 Run 尚无日报");
  expect(screen.getAllByText("<script>unsafe</script>").length).toBeGreaterThan(
    0,
  );
  expect(document.querySelector("script")).toBeNull();
  expect(
    fetcher.mock.calls.every(([, init]) =>
      new Headers(init?.headers).has("authorization"),
    ),
  ).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: "退出" }));
  expect(screen.queryByText("thread-1")).toBeNull();
});
test("wrong Token and disabled management are explicit and do not show private data", async () => {
  mockFetch(401);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("管理 Token"), {
    target: { value: "wrong-token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "连接后台" }));
  await screen.findByText(/管理认证失效/);
  expect(screen.queryByRole("heading", { name: "任务总览" })).toBeNull();
});
test("unavailable service displays a retryable connection error", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("network")));
  render(<App />);
  await screen.findByText(/无法连接后台/);
  expect(screen.getByRole("button", { name: "重新连接" })).toBeTruthy();
});
test("manual trigger uses idempotency key and enters the Run belonging to the selected Task", async () => {
  const fetcher = mockFetch();
  render(<App />);
  await login();
  location.hash = "#/tasks/sample-connectivity";
  fireEvent(window, new HashChangeEvent("hashchange"));
  const button = await screen.findByRole("button", { name: "手动执行" });
  fireEvent.click(button);
  fireEvent.click(button);
  await screen.findByText("thread-1");
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter(
        ([url, init]) => init?.method === "POST" && !url.includes("/auth/"),
      ),
    ).toHaveLength(1),
  );
  expect(
    JSON.parse(
      String(
        fetcher.mock.calls.find(
          ([url, init]) => init?.method === "POST" && !url.includes("/auth/"),
        )![1]!.body,
      ),
    ).idempotencyKey,
  ).toMatch(/^admin-/);
});

test("management disabled message is distinct from wrong Token", async () => {
  mockFetch(503);
  render(<App />);
  fireEvent.change(await screen.findByLabelText("管理 Token"), {
    target: { value: "token" },
  });
  fireEvent.click(screen.getByRole("button", { name: "连接后台" }));
  await screen.findByText(/管理 API 尚未启用/);
});
test("session expiration removes private results during polling", async () => {
  const fetcher = mockFetch();
  render(<App />);
  await login();
  location.hash = "#/tasks/sample-connectivity";
  fireEvent(window, new HashChangeEvent("hashchange"));
  await screen.findByRole("heading", { name: "连接检查" });
  fetcher.mockImplementation(async (url) =>
    url === "/api/auth/status"
      ? Response.json({ initialized: true, mode: "token" })
      : new Response(JSON.stringify({ error: { code: "unauthorized" } }), {
          status: 401,
        }),
  );
  await screen.findByLabelText("管理 Token", {}, { timeout: 4000 });
  expect(screen.queryByRole("link", { name: "连接检查" })).toBeNull();
  expect(screen.getByRole("alert").textContent).toMatch(/管理认证失效/);
});
test("late manual execution response cannot navigate after leaving the Task", async () => {
  const fetcher = mockFetch();
  render(<App />);
  await login();
  location.hash = "#/tasks/sample-connectivity";
  fireEvent(window, new HashChangeEvent("hashchange"));
  let complete!: (response: Response) => void;
  const previous = fetcher.getMockImplementation()!;
  fetcher.mockImplementation((url, init) =>
    init?.method === "POST" && !url.includes("/auth/")
      ? new Promise<Response>((resolve) => {
          complete = resolve;
        })
      : previous(url, init),
  );
  fireEvent.click(await screen.findByRole("button", { name: "手动执行" }));
  fireEvent.click(screen.getByRole("button", { name: "退出" }));
  location.hash = "";
  complete(Response.json({ run }));
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(location.hash).toBe("");
});
test("aborted old error response cannot expire a replacement session while reading its body", async () => {
  const { client } = await import("./api");
  let failBody!: (error: Error) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        new Promise((_resolve, reject) => {
          failBody = reject;
        }),
    }),
  );
  const expired = vi.fn();
  const controller = new AbortController();
  const request = client("old", expired)("/tasks", controller.signal).catch(
    () => {},
  );
  await waitFor(() => expect(failBody).toBeTypeOf("function"));
  controller.abort();
  failBody(new Error("aborted"));
  await request;
  expect(expired).not.toHaveBeenCalled();
});
test("news prompt and uncertain retry survive log pagination without replacing the idempotency key", async () => {
  const newsTask = { ...task, id: "news-research", name: "研究任务" };
  const newsRun = { ...run, task_id: newsTask.id };
  const posts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/auth/status")
        return Response.json({ initialized: true, mode: "token" });
      if (url === "/api/auth/login")
        return Response.json({
          token: "test_only_0123456789_abcdefghijklmnop",
        });
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        throw new TypeError("lost response");
      }
      if (url === "/api/overview")
        return Response.json({
          timezone: "Asia/Shanghai",
          generatedAt: "2026-11-06T00:00:00Z",
          tasks: { total: 0, manual: 0, scheduled: 0, paused: 0 },
          todayRuns: 0,
          running: 0,
          queued: 0,
          pendingReview: 0,
          pendingPublish: 0,
          publishFailed: 0,
          recentFailures: 0,
          daily: [],
          recentRuns: [],
        });
      if (url === "/api/tasks") return Response.json({ tasks: [newsTask] });
      if (url.includes("/events"))
        return Response.json({
          events: Array.from({ length: 100 }, (_, i) => ({
            id: i + 1,
            kind: "message",
            data: {},
            created_at: run.created_at,
          })),
        });
      if (url.startsWith("/api/news/runs/"))
        return Response.json({ newsRun: { report_id: null } });
      if (url === "/api/runs/run-1")
        return Response.json({
          run: newsRun,
          turns: [
            {
              id: "t",
              sequence: 1,
              status: "succeeded",
              input_text: "first",
              output_text: "reply",
            },
          ],
        });
      return Response.json({ runs: [newsRun], task: newsTask });
    }),
  );
  location.hash = "#/tasks/news-research/runs/run-1";
  render(<App />);
  fireEvent.change(await screen.findByLabelText("管理 Token"), {
    target: { value: "test_only_0123456789_abcdefghijklmnop" },
  });
  fireEvent.click(screen.getByRole("button", { name: "连接后台" }));
  fireEvent.change(await screen.findByLabelText("下一轮 prompt"), {
    target: { value: "补查原始公告" },
  });
  fireEvent.click(screen.getByRole("tab", { name: "执行日志" }));
  fireEvent.click(await screen.findByRole("button", { name: "后续日志" }));
  fireEvent.click(screen.getByRole("tab", { name: "研究会话" }));
  await waitFor(() =>
    expect(
      (screen.getByLabelText("下一轮 prompt") as HTMLTextAreaElement).disabled,
    ).toBe(false),
  );
  expect(
    (screen.getByLabelText("下一轮 prompt") as HTMLTextAreaElement).value,
  ).toBe("补查原始公告");
  fireEvent.click(screen.getByRole("button", { name: "继续研究" }));
  await screen.findByRole("button", { name: "重试原请求" });
  fireEvent.click(screen.getByRole("tab", { name: "执行日志" }));
  fireEvent.click(screen.getByRole("button", { name: "回到首条" }));
  fireEvent.click(screen.getByRole("tab", { name: "研究会话" }));
  const retry = await screen.findByRole("button", { name: "重试原请求" });
  await waitFor(() => expect(retry.hasAttribute("disabled")).toBe(false));
  fireEvent.click(retry);
  await waitFor(() => expect(posts).toHaveLength(2));
  expect(posts[0]).toEqual(posts[1]);
});
test("workspace navigation marks the current page and opens real system settings", async () => {
  mockFetch();
  render(<App />);
  await login();
  expect(
    screen.getByRole("link", { name: "系统概览" }).getAttribute("aria-current"),
  ).toBe("page");
  fireEvent.click(screen.getByRole("link", { name: "模型与执行" }));
  await screen.findByRole("heading", { name: "模型与执行" });
  expect(screen.getAllByRole("heading", { name: "模型与执行" })).toHaveLength(
    1,
  );
  expect(screen.queryByText("本地管理")).toBeNull();
  expect(document.querySelector(".topbar")).toBeNull();
  expect(document.querySelector(".user-avatar")).toBeNull();
  await screen.findByLabelText("Codex 可执行文件");
  fireEvent.click(screen.getByRole("link", { name: "GitHub 归档" }));
  await screen.findByLabelText("GitHub 仓库");
  expect(
    screen.getByRole("link", { name: "GitHub 归档" }).closest("aside"),
  ).not.toBeNull();
  expect(screen.getByRole("main").querySelector(".settings-nav")).toBeNull();
  expect(
    screen
      .getByRole("link", { name: "GitHub 归档" })
      .getAttribute("aria-current"),
  ).toBe("page");
  expect(
    document.querySelectorAll('.primary-nav [aria-current="page"]'),
  ).toHaveLength(1);
  expect(screen.queryByRole("link", { name: "系统设置" })).toBeNull();
  expect(
    screen.getByRole("link", { name: "任务总览" }).getAttribute("aria-current"),
  ).toBeNull();
});
