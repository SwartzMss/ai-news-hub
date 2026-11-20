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
