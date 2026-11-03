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
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch("/api" + path, {
        method: body ? "POST" : "GET",
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
    const data = (await response.json()) as T;
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
    task_busy: "任务已有执行中的 Run，请等待完成。",
    queue_full: "执行队列已满，请稍后重试。",
    auth_required: "Codex 认证失效，需要在服务账户下重新登录。",
  };
  return messages[error.code] ?? `请求失败（${error.code}）。请刷新或重试。`;
}
