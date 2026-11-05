import { afterEach, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { Overview } from "./Overview";
import type { OverviewResponse } from "../../../packages/shared/src";
afterEach(cleanup);
const empty: OverviewResponse = {
  timezone: "Asia/Shanghai",
  generatedAt: "2026-11-06T03:00:00Z",
  tasks: { total: 0, manual: 0, scheduled: 0, paused: 0 },
  todayRuns: 0,
  running: 0,
  queued: 0,
  pendingReview: 0,
  pendingPublish: 0,
  publishFailed: 0,
  recentFailures: 0,
  daily: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-11-0${i + 1}`,
    total: 0,
    succeeded: 0,
    failed: 0,
    stopped: 0,
    active: 0,
  })),
  recentRuns: [],
};
test("empty overview renders seven real zero days, no invented success rate, and management links", async () => {
  const api = vi.fn().mockResolvedValue(empty);
  render(<Overview api={api} />);
  await screen.findByText("尚无执行记录");
  expect(screen.getByRole("img", { name: "最近 7 天执行趋势" })).toBeTruthy();
  expect(
    screen.getByRole("link", { name: /任务总数/ }).getAttribute("href"),
  ).toBe("#/tasks");
  expect(
    screen.getByRole("link", { name: /待审核日报/ }).getAttribute("href"),
  ).toBe("#/runs?state=pending_review");
  expect(screen.getByText("成功率 —")).toBeTruthy();
  expect(api.mock.calls[0][0]).toBe("/overview");
});
test("overview shows server counts, actionable failures and a recent execution duration", async () => {
  const api = vi
    .fn()
    .mockResolvedValue({
      ...empty,
      tasks: { total: 120, manual: 40, scheduled: 60, paused: 20 },
      todayRuns: 105,
      pendingReview: 3,
      publishFailed: 2,
      daily: [
        {
          date: "2026-11-06",
          total: 4,
          succeeded: 2,
          failed: 1,
          stopped: 1,
          active: 0,
        },
      ],
      recentRuns: [
        {
          run: {
            id: "r",
            task_id: "t",
            status: "succeeded",
            created_at: "2026-11-06T01:00:00Z",
            started_at: "2026-11-06T01:00:02Z",
            finished_at: "2026-11-06T01:02:15Z",
          },
          task_name: "每日研究",
          task_deleted: false,
          state: "publish_failed",
          report: { id: "p", title: "日报", status: "validated" },
        },
      ],
    });
  render(<Overview api={api} />);
  await screen.findByText("每日研究");
  expect(screen.getByText("成功率 67%")).toBeTruthy();
  expect(screen.getByText("2分13秒")).toBeTruthy();
  expect(
    screen.getByRole("link", { name: "查看结果" }).getAttribute("href"),
  ).toBe("#/tasks/t/runs/r");
  expect(
    screen.getByRole("link", { name: /归档失败/ }).getAttribute("href"),
  ).toBe("#/runs?state=publish_failed");
  expect(screen.getByRole("cell", { name: "归档失败" })).toBeTruthy();
});
test("overview surfaces load errors without presenting made-up zero counts", async () => {
  render(<Overview api={vi.fn().mockRejectedValue(new Error("network"))} />);
  await screen.findByRole("alert");
  expect(screen.queryByRole("link", { name: /任务总数/ })).toBeNull();
});
