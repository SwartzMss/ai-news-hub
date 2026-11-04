export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}
export function client(token: string, expired: (error: ApiError) => void) {
  return async function request<T>(
    path: string,
    signal?: AbortSignal,
    body?: unknown,
    method?: 'POST'|'PUT'|'DELETE',
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch("/api" + path, {
        method: method ?? (body ? "POST" : "GET"),
        signal,
        cache: "no-store",
        redirect: "error",
        headers: {
          Authorization: `Bearer ${token}`,
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new ApiError(0, "network_unavailable");
    }
    signal?.throwIfAborted();
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      signal?.throwIfAborted();
      if (response.status === 401 || data.error?.code === "management_disabled")
        expired(
          new ApiError(response.status, data.error?.code ?? "unauthorized"),
        );
      throw new ApiError(response.status, data.error?.code ?? "request_failed");
    }
    const data = (response.status === 204 ? undefined : await response.json()) as T;
    signal?.throwIfAborted();
    return data;
  };
}
export type Client = ReturnType<typeof client>;
export function errorText(error: unknown): string {
  if (!(error instanceof ApiError)) return "请求失败，请重试。";
  const messages: Record<string, string> = {
    unauthorized: "管理认证失效或 Token 不正确，请重新连接。",
    management_disabled: "管理 API 尚未启用，请先配置服务端 Token。",
    network_unavailable: "无法连接后台，请确认服务正在运行，然后重试。",
    invalid_task_configuration: "任务配置不正确，请检查 Prompt、计划和时区。",
    task_not_editable: "历史预定义任务仅供查看，请新建研究任务。",
    managed_run_automatic: "此任务按已配置的 Prompt 自动执行。",
    invalid_schedule: "执行计划不正确，请检查时间与时区。",
    publication_disabled: "请先配置并启用 GitHub 归档。",
    task_busy: "任务已有执行中的 Run，请等待完成。",
    queue_full: "执行队列已满，请稍后重试。",
    auth_required: "Codex 认证失效，需要在服务账户下重新登录。",
    invalid_setup_token: "初始化页面已失效，请刷新页面后重新设置密码。",
    invalid_password: "管理员密码必须为 12–128 个字符。",
    password_mismatch: "两次输入的密码不一致。",
    incorrect_password: "当前密码或旧 Token 不正确。",
    auth_rate_limited: "认证请求过于频繁，请一分钟后重试。",
    settings_busy: "有任务或归档正在执行，请完成后保存设置。",
    settings_changed: "设置已被其他页面更新，请重新进入设置页核对。",
    invalid_settings: "配置格式不正确，请检查路径、模型和执行参数。",
    invalid_publication_config: "GitHub 归档配置不完整或格式不正确。",
    workflow_run_finalized: "本 Run 已生成日报，请新建研究以调整内容。",
    turn_limit: "已达到每个 Run 20 轮的上限，请开始新的研究。",
  };
  return messages[error.code] ?? `请求失败（${error.code}）。请刷新或重试。`;
}
