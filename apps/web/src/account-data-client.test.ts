import { expect, it, vi } from "vitest";
import { mountAccountDataControls } from "./account-data-client";

it("downloads every export page using a short-lived continuation token", async () => {
  document.body.innerHTML = `<form data-account-export><input name="password" type="password" value="correct horse battery staple" required>
    <p data-account-export-status></p><button type="submit">下载</button></form>`;
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ schemaVersion: 1, exportedAt: 1795176000000, exportToken: "token",
      account: { email: "reader@example.com" }, categories: [], favorites: [{ id: "first" }],
      nextCursor: { createdAt: 1, id: "first" } }))
    .mockResolvedValueOnce(Response.json({ schemaVersion: 1, exportedAt: 1795176000000, exportToken: "token",
      favorites: [{ id: "second" }], nextCursor: null }));
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:test"), revokeObjectURL: vi.fn() }));
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  mountAccountDataControls();
  document.querySelector<HTMLFormElement>("[data-account-export]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ cursor: { createdAt: 1, id: "first" },
    exportedAt: 1795176000000, exportToken: "token" });
  await vi.waitFor(() => expect(click).toHaveBeenCalled());
  expect(document.querySelector("[data-account-export-status]")!.textContent).toContain("下载");
  click.mockRestore(); vi.unstubAllGlobals();
});
