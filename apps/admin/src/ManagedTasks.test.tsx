import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ManagedTasks } from "./ManagedTasks";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function makeTask(
  id: string,
  templateId: string,
  name: string,
  time = "08:05",
  status = "active",
  autoPublish = false,
) {
  return {
    id,
    name,
    status,
    configuration: {
      templateId,
      templateVersion: 1,
      topic: name,
      promptCount: 2,
      autoPublish,
      schedule: { kind: "daily", time },
      timezone: "Asia/Shanghai",
    },
  };
}

function fixture(initialTasks = [makeTask(
  "technology",
  "daily-technology",
  "每日科技投资简报",
)]) {
  const tasks = [...initialTasks];
  const api = vi.fn().mockImplementation(
    async (
      path: string,
      _signal?: AbortSignal,
      body?: Record<string, unknown>,
      method?: string,
    ) => {
      if (path === "/tasks") return { tasks };
      if (path.endsWith("/runs?limit=1")) return { runs: [] };
      if (method === "PUT") {
        const id = path.split("/")[2];
        const index = tasks.findIndex((task) => task.id === id);
        const current = tasks[index];
        const updated = {
          ...current,
          status: body?.status ?? current.status,
          configuration: {
            ...current.configuration,
            ...body,
          },
        };
        tasks[index] = updated;
        return { task: updated };
      }
      if (path.endsWith("/runs")) return { run: { id: "started", status: "queued" } };
      if (path.endsWith("/stop")) return { task: tasks[0] };
      return { runs: [] };
    },
  );
  return api;
}

test("the task list only exposes the fixed tasks and their operational controls", async () => {
  const api = fixture([
    makeTask("headlines", "daily-headlines", "每日热点观察"),
    makeTask("technology", "daily-technology", "每日科技投资简报"),
    makeTask("opensource", "daily-opensource", "每日开源精选"),
  ]);
  render(<ManagedTasks api={api} />);

  for (const name of ["每日热点观察", "每日科技投资简报", "每日开源精选"])
    await screen.findByRole("link", { name });

  expect(screen.getAllByRole("link")).toHaveLength(3);
  expect(screen.queryByRole("button", { name: "新增任务" })).toBeNull();
  expect(screen.queryByRole("button", { name: "删除" })).toBeNull();
  expect(screen.queryByLabelText("Prompt 模板")).toBeNull();
  expect(screen.queryByLabelText("执行计划")).toBeNull();
  expect(api.mock.calls.some((call) => call[0] === "/prompt-templates")).toBe(false);
});

test("the time editor only changes the daily execution time", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByRole("link", { name: "每日科技投资简报" });

  fireEvent.click(screen.getByRole("button", { name: "修改时间" }));
  const dialog = await screen.findByRole("dialog", { name: "修改执行时间" });
  expect(dialog.querySelectorAll("select")).toHaveLength(0);
  expect(dialog.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);

  fireEvent.change(screen.getByLabelText("每日执行时刻（北京时间）"), {
    target: { value: "10:30" },
  });
  fireEvent.click(screen.getByRole("button", { name: "保存时间" }));

  await waitFor(() =>
    expect(api.mock.calls.some((call) => call[3] === "PUT")).toBe(true),
  );
  const body = api.mock.calls.find((call) => call[3] === "PUT")![2];
  expect(body).toEqual({
    templateId: "daily-technology",
    templateVersion: 1,
    autoPublish: false,
    schedule: { kind: "daily", time: "10:30" },
    timezone: "Asia/Shanghai",
    status: "active",
  });
  expect(api.mock.calls.some((call) => call[3] === "POST")).toBe(false);
});

test("the schedule switch only pauses or enables the existing task", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByRole("link", { name: "每日科技投资简报" });

  const toggle = screen.getByRole("switch", {
    name: "定时执行：每日科技投资简报",
  });
  expect(toggle).toBeChecked();
  fireEvent.click(toggle);

  await waitFor(() =>
    expect(api.mock.calls.some((call) => call[3] === "PUT")).toBe(true),
  );
  const body = api.mock.calls.find((call) => call[3] === "PUT")![2] as Record<string, unknown>;
  expect(body).toMatchObject({
    templateId: "daily-technology",
    templateVersion: 1,
    autoPublish: false,
    schedule: { kind: "daily", time: "08:05" },
    timezone: "Asia/Shanghai",
    status: "paused",
  });
});

test("automatic publishing remains independent from the schedule switch", async () => {
  const api = fixture();
  render(<ManagedTasks api={api} />);
  await screen.findByRole("link", { name: "每日科技投资简报" });

  fireEvent.click(
    screen.getByRole("switch", { name: "自动发布：每日科技投资简报" }),
  );
  await waitFor(() =>
    expect(api.mock.calls.some((call) => call[3] === "PUT")).toBe(true),
  );
  const body = api.mock.calls.find((call) => call[3] === "PUT")![2] as Record<string, unknown>;
  expect(body).toMatchObject({
    autoPublish: true,
    schedule: { kind: "daily", time: "08:05" },
    status: "active",
  });
});

test("a paused task can still be run manually", async () => {
  const api = fixture([
    makeTask(
      "technology",
      "daily-technology",
      "每日科技投资简报",
      "08:05",
      "paused",
    ),
  ]);
  render(<ManagedTasks api={api} />);
  await screen.findByText("已关闭");

  fireEvent.click(screen.getByRole("button", { name: "立即运行" }));
  await waitFor(() =>
    expect(
      api.mock.calls.some(
        (call) => call[0] === "/tasks/technology/runs" && call[2],
      ),
    ).toBe(true),
  );
});
