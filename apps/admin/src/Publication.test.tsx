import { afterEach, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Publication } from "./Publication";
import type { Client } from "./api";
afterEach(cleanup);
test("approval is explicit and archive remains separate; destination and commit are visible", async () => {
  let status = "validated";
  const calls: string[] = [];
  const api = vi.fn(async (path: string, _signal: unknown, body: unknown) => {
    calls.push(path);
    if (path.endsWith("/approve")) {
      expect(body).toEqual({ contentHash: "a".repeat(64), confirm: true });
      status = "approved";
    }
    if (path.endsWith("/publish")) status = "published";
    return {
      contentHash: "a".repeat(64),
      status,
      configured: true,
      target: { repository: "owner/archive", branch: "reports" },
      publications:
        status === "published"
          ? [
              {
                id: "p",
                repository: "owner/archive",
                branch: "reports",
                status: "succeeded",
                commit_sha: "b".repeat(40),
                remote_url:
                  "https://github.com/owner/archive/commit/" + "b".repeat(40),
                attempts: 1,
              },
            ]
          : [],
    };
  }) as Client;
  render(<Publication api={api} reportId="r" />);
  const approve = await screen.findByRole("button", { name: "批准此版本" });
  expect((approve as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(approve);
  const publish = await screen.findByRole("button", { name: "归档到 GitHub" });
  expect(calls.some((x) => x.endsWith("/publish"))).toBe(false);
  fireEvent.click(publish);
  await screen.findByText("b".repeat(40));
  expect(screen.getByText("owner/archive · reports")).toBeTruthy();
});
test("changing archive target requires an explicit publish action, never a record-check label", async () => {
  const api = vi.fn(async () => ({
    contentHash: "a".repeat(64),
    status: "published",
    configured: true,
    target: { repository: "owner/new", branch: "main" },
    publications: [
      {
        id: "old",
        repository: "owner/old",
        branch: "reports",
        status: "succeeded",
        commit_sha: "b".repeat(40),
        attempts: 1,
      },
    ],
  })) as Client;
  render(<Publication api={api} reportId="r" />);
  const publish = await screen.findByRole("button", { name: "归档到 GitHub" });
  expect((publish as HTMLButtonElement).disabled).toBe(false);
  expect(screen.queryByRole("button", { name: "核对归档记录" })).toBeNull();
  expect(screen.getByText(/当前目标尚未归档/)).toBeTruthy();
  expect(screen.getByText("归档目标：owner/old · reports")).toBeTruthy();
});
test("reading a successful current-target record never invokes the publishing endpoint", async () => {
  const api = vi.fn(async () => ({
    contentHash: "a".repeat(64),
    status: "published",
    configured: true,
    target: { repository: "owner/archive", branch: "reports" },
    publications: [
      {
        id: "p",
        repository: "owner/archive",
        branch: "reports",
        status: "succeeded",
        commit_sha: "b".repeat(40),
        attempts: 1,
      },
    ],
  })) as Client;
  render(<Publication api={api} reportId="r" />);
  fireEvent.click(await screen.findByRole("button", { name: "刷新归档记录" }));
  expect(
    (api as ReturnType<typeof vi.fn>).mock.calls.some(([path]) =>
      String(path).endsWith("/publish"),
    ),
  ).toBe(false);
});
test('report deletion waits for explicit confirmation and reports successful removal', async () => {
  const onDeleted = vi.fn();
  const api = vi.fn(async (_path, _signal, _body, method) => method === 'DELETE' ? {deleted:true} : {
    contentHash:'a'.repeat(64),status:'validated',configured:false,target:null,publications:[],
  }) as Client;
  render(<Publication api={api} reportId="r" onDeleted={onDeleted} />);
  fireEvent.click(await screen.findByRole('button',{name:'删除日报'}));
  expect(onDeleted).not.toHaveBeenCalled();
  expect(vi.mocked(api).mock.calls.some(c=>c[3]==='DELETE')).toBe(false);
  fireEvent.click(screen.getByRole('button',{name:'确认删除日报和归档'}));
  await screen.findByText('日报已删除');
  expect(api).toHaveBeenCalledWith('/news/reports/r',expect.anything(),{confirm:true},'DELETE');
  expect(onDeleted).toHaveBeenCalledOnce();
});
