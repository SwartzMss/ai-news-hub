import { useEffect, useMemo, useState } from "react";
import type { AuthStatus } from "../../../packages/shared/src/settings";
import { ApiError, client, errorText } from "./api";
import { Brand, Icon } from "./ui";
export function Login({
  onConnected,
  error: sessionError,
}: {
  onConnected: (token: string) => void;
  error?: unknown;
}) {
  const [status, setStatus] = useState<AuthStatus>(),
    [error, setError] = useState<unknown>(),
    [input, setInput] = useState(""),
    [confirm, setConfirm] = useState(""),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  useEffect(() => {
    const pending = new AbortController();
    setStatus(undefined);
    setError(undefined);
    void client("", () => {})<AuthStatus>("/auth/status", pending.signal)
      .then((value) => {
        if (
          !["setup", "password", "token"].includes(value.mode) ||
          typeof value.initialized !== "boolean" ||
          (value.mode === "setup" && typeof value.setupToken !== "string")
        )
          throw new ApiError(502, "invalid_response");
        if (!pending.signal.aborted) setStatus(value);
      })
      .catch((cause) => {
        if (!pending.signal.aborted) setError(cause);
      });
    return () => pending.abort();
  }, [attempt]);
  const setup = status?.mode === "setup",
    legacy = status?.mode === "token";
  async function connect(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !status) return;
    setError(undefined);
    if (setup && input !== confirm) {
      setError(new ApiError(400, "password_mismatch"));
      return;
    }
    setBusy(true);
    try {
      const result = await client("", () => {})<{ token: string }>(
        setup ? "/auth/setup" : "/auth/login",
        controller.signal,
        setup
          ? { setupToken: status.setupToken, password: input }
          : { password: legacy ? input.trim() : input },
      );
      if (!result.token) throw new ApiError(502, "invalid_response");
      if (!controller.signal.aborted) onConnected(result.token);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <div className="auth-shell">
      <aside className="auth-story">
        <div className="auth-brand">
          <Brand />
        </div>
        <div className="auth-story-content">
          <span className="auth-category">你的新闻研究空间</span>
          <h2>
            从一个问题，
            <br />
            到一份有来源的日报。
          </h2>
          <p>
            与 Codex 一起寻找线索、核对原文，
            <br />
            把判断留给自己。
          </p>
          <div className="auth-workflow">
            <div>
              <span>
                <Icon name="search" size={19} />
              </span>
              <p>
                围绕主题搜集<small>从你关心的问题开始</small>
              </p>
            </div>
            <div>
              <span>
                <Icon name="message" size={19} />
              </span>
              <p>
                在对话中完善<small>逐轮补查、筛选与整理</small>
              </p>
            </div>
            <div>
              <span>
                <Icon name="shield" size={19} />
              </span>
              <p>
                审核后再发布<small>保留来源与每次研究记录</small>
              </p>
            </div>
          </div>
        </div>
        <p className="auth-story-footer">
          AI News Hub <span>个人研究与内容工作台</span>
        </p>
      </aside>
      <main className="auth-main">
        <div className="login">
          <div className="login-emblem">
            <Icon name={setup ? "shield" : "file"} size={24} />
          </div>
          <h1>{setup ? "初始化管理员" : "连接你的新闻后台"}</h1>
          <p className="login-description">
            {setup
              ? "设置你的管理员密码，即可开始使用。"
              : "欢迎回来，继续你的研究与审阅。"}
          </p>
          {!status ? (
            <>
              <p className="loading-state" role="status">
                正在读取登录状态…
              </p>
              {error ? (
                <button
                  className="quiet"
                  onClick={() => setAttempt((n) => n + 1)}
                >
                  重新连接
                </button>
              ) : null}
            </>
          ) : (
            <form onSubmit={connect}>
              <div className="field">
                <label htmlFor="credential">
                  {setup ? "设置密码" : legacy ? "管理 Token" : "管理员密码"}
                </label>
                <input
                  id="credential"
                  type="password"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  autoComplete={setup ? "new-password" : "current-password"}
                  minLength={setup ? 12 : undefined}
                  maxLength={legacy ? 256 : 128}
                  required
                  disabled={busy}
                  placeholder={setup ? "至少 12 个字符" : "输入你的登录凭据"}
                />
              </div>
              {setup && (
                <div className="field">
                  <label htmlFor="confirm-password">确认密码</label>
                  <input
                    id="confirm-password"
                    type="password"
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    disabled={busy}
                    placeholder="再次输入刚才的密码"
                  />
                </div>
              )}
              {error || sessionError ? (
                <p role="alert" className="error">
                  {errorText(error ?? sessionError)}
                </p>
              ) : null}
              <button className="login-submit" disabled={busy}>
                {busy ? "正在连接…" : setup ? "初始化并进入后台" : "连接后台"}
                <Icon name="arrow" size={17} />
              </button>
            </form>
          )}
          {!status && (error || sessionError) ? (
            <p role="alert" className="error">
              {errorText(error ?? sessionError)}
            </p>
          ) : null}
          <div className="login-note">
            <Icon name="shield" size={15} />
            <p>
              {setup
                ? "密码至少 12 个字符，确认后即可进入后台。"
                : legacy
                  ? "使用旧 Token 登录后，可在系统设置中改设管理员密码。"
                  : "会话仅保留在当前页面，刷新后重新登录。"}
            </p>
          </div>
        </div>
        <p className="auth-main-footer">研究有据，发布有度。</p>
      </main>
    </div>
  );
}
