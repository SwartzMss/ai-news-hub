import { ApiError, requestMessage } from "./account-api";

export function mountAccountDataControls(): void {
  const exportForm = document.querySelector<HTMLFormElement>("[data-account-export]");
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
}
