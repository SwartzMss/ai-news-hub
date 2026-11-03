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
