import { expect, it, vi } from "vitest";
import { mountAccountDataControls } from "./account-data-client";

it("requires confirmation, posts current password and clears private DOM after account deletion", async () => {
  document.body.innerHTML = `<a data-account-nav href="/account/">我的账户</a><div data-account-profile><strong data-account-email>reader@example.com</strong></div>
    <div data-account-tools><form data-account-delete><input name="password" type="password" value="correct horse battery staple" required>
    <input name="confirm" type="checkbox" checked required><p data-account-delete-status></p><button type="submit">删除账户</button></form></div>`;
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 204 })));
  const navigate = vi.fn();
  mountAccountDataControls(navigate);
  document.querySelector<HTMLFormElement>("[data-account-delete]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(navigate).toHaveBeenCalledWith("/"));
  expect(fetch).toHaveBeenCalledWith("/api/auth/delete-account", expect.objectContaining({ method: "POST", credentials: "same-origin" }));
  expect(document.querySelector("[data-account-email]")!.textContent).toBe("");
  vi.unstubAllGlobals();
});

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
  mountAccountDataControls(vi.fn());
  document.querySelector<HTMLFormElement>("[data-account-export]")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ cursor: { createdAt: 1, id: "first" },
    exportedAt: 1795176000000, exportToken: "token" });
  await vi.waitFor(() => expect(click).toHaveBeenCalled());
  expect(document.querySelector("[data-account-export-status]")!.textContent).toContain("下载");
  click.mockRestore(); vi.unstubAllGlobals();
});
