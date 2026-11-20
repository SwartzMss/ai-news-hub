import { api, ApiError, requestMessage } from "./account-api";
import { notifyLogout } from "./account-privacy";

export function mountAccountDataControls(navigate: (path: string) => void): void {
  const exportForm = document.querySelector<HTMLFormElement>("[data-account-export]");
  const deleteForm = document.querySelector<HTMLFormElement>("[data-account-delete]");
  exportForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!exportForm.reportValidity()) return;
    const button = exportForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    if (button.disabled) return;
    const password = exportForm.elements.namedItem("password") as HTMLInputElement;
    const status = exportForm.querySelector<HTMLElement>("[data-account-export-status]")!;
    button.disabled = true; status.textContent = "正在准备数据文件…";
    try {
      type ExportPage = { schemaVersion: number; exportedAt: number; exportToken: string;
        account?: unknown; categories?: unknown[]; favorites: unknown[];
        nextCursor: { createdAt: number; id: string } | null };
      let payload: Record<string, unknown> = { password: password.value };
      let first: ExportPage | undefined;
      const favorites: unknown[] = [];
      for (;;) {
        const response = await fetch("/api/auth/export-data", { method: "POST", credentials: "same-origin", cache: "no-store",
          headers: { Accept: "application/json", "Content-Type": "application/json" }, body: JSON.stringify(payload) });
        if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new ApiError(response.status, data.error ?? "request_failed"); }
        const page = await response.json() as ExportPage;
        if (!first) first = page;
        favorites.push(...page.favorites);
        if (!page.nextCursor) break;
        status.textContent = `已准备 ${favorites.length} 条收藏…`;
        payload = { cursor: page.nextCursor, exportedAt: page.exportedAt, exportToken: page.exportToken };
      }
      const content = JSON.stringify({ schemaVersion: first!.schemaVersion,
        exportedAt: new Date(first!.exportedAt).toISOString(), account: first!.account,
        categories: first!.categories, favorites });
      const url = URL.createObjectURL(new Blob([content], { type: "application/json" }));
      const link = document.createElement("a"); link.href = url; link.download = "ai-news-hub-data.json";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      status.textContent = "数据文件已开始下载。";
      exportForm.reset();
    } catch (error) { status.textContent = requestMessage(error); }
    finally { password.value = ""; button.disabled = false; }
  });
  deleteForm?.addEventListener("submit", async event => {
    event.preventDefault();
    if (!deleteForm.reportValidity()) return;
    const button = deleteForm.querySelector<HTMLButtonElement>('button[type="submit"]')!;
    if (button.disabled) return;
    const password = deleteForm.elements.namedItem("password") as HTMLInputElement;
    const status = deleteForm.querySelector<HTMLElement>("[data-account-delete-status]")!;
    button.disabled = true; status.textContent = "正在删除账户…";
    try {
      await api<void>("/api/auth/delete-account", "POST", { password: password.value });
      notifyLogout();
      navigate("/");
    } catch (error) { status.textContent = requestMessage(error); button.disabled = false; }
    finally { password.value = ""; }
  });
}
