export type AuthState = { kind: "user"; user: { id: string; email: string } } | { kind: "guest" } | { kind: "unavailable" } | { kind: "error" };

export class ApiError extends Error {
  constructor(public status: number, public code: string) { super(code); }
}

export async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers: { Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({})) as { error?: string };
    if (response.status === 401 && (path.startsWith("/api/favorites") || path.startsWith("/api/favorite-categories")))
      window.dispatchEvent(new Event("favorite-session-expired"));
    throw new ApiError(response.status, data.error ?? "request_failed");
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}

export async function readAuth(): Promise<AuthState> {
  try {
    const data = await api<{ user: { id: string; email: string } }>("/api/auth/me");
    return { kind: "user", user: data.user };
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return { kind: "guest" };
    if (error instanceof ApiError && error.status === 503) return { kind: "unavailable" };
    return { kind: "error" };
  }
}

export function requestMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === "turnstile_required") return "请先完成人机验证，再重新登录。";
    if (error.code === "invalid_code") return "验证码错误或已过期，请检查邮件或重新获取。";
    if (error.status === 401) return "登录已失效，或邮箱和密码不正确。";
    if (error.status === 403) return "请求未通过验证，请刷新页面后重试。";
    if (error.status === 404) return "内容已不存在，请刷新页面。";
    if (error.status === 409) return "分类名称已存在，请换一个名称。";
    if (error.status === 429) return "操作太频繁，请稍后重试。";
    if (error.status === 503) return "账户服务暂不可用，请稍后再试。";
  }
  return "网络请求失败，请检查连接后重试。";
}
