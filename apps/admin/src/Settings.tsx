import { useEffect, useMemo, useRef, useState } from "react";
import type {
  SettingsUpdate,
  SettingsView,
} from "../../../packages/shared/src/settings";
import { ApiError, errorText, type Client } from "./api";
import { Icon, PageHeading } from "./ui";
export function Settings({
  api,
  onCredentialChanged,
}: {
  api: Client;
  onCredentialChanged: (token: string) => void;
}) {
  const [data, setData] = useState<SettingsView>(),
    [error, setError] = useState<unknown>(),
    [saved, setSaved] = useState(false),
    [busy, setBusy] = useState(false),
    [token, setToken] = useState(""),
    [clearToken, setClearToken] = useState(false);
  const [current, setCurrent] = useState(""),
    [password, setPassword] = useState(""),
    [confirm, setConfirm] = useState(""),
    [passwordBusy, setPasswordBusy] = useState(false);
  const pending = useRef(false),
    passwordPending = useRef(false),
    controller = useMemo(() => new AbortController(), []);
  useEffect(() => () => controller.abort(), [controller]);
  useEffect(() => {
    const c = new AbortController();
    void api<SettingsView>("/settings", c.signal)
      .then((value) => {
        if (!c.signal.aborted) setData(value);
      })
      .catch((cause) => {
        if (!c.signal.aborted) setError(cause);
      });
    return () => c.abort();
  }, [api]);
  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!data || pending.current) return;
    pending.current = true;
    setBusy(true);
    setSaved(false);
    setError(undefined);
    const body: SettingsUpdate = {
      revision: data.revision,
      logLevel: data.logLevel,
      codex: data.codex,
      execution: data.execution,
      github: {
        enabled: data.github.enabled,
        repository: data.github.repository,
        branch: data.github.branch,
        ...(token ? { token } : clearToken ? { clearToken: true } : {}),
      },
    };
    try {
      const result = await api<SettingsView>(
        "/settings",
        controller.signal,
        body,
        "PUT",
      );
      if (!controller.signal.aborted) {
        setData(result);
        setToken("");
        setClearToken(false);
        setSaved(true);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      pending.current = false;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  async function rotate(event: React.FormEvent) {
    event.preventDefault();
    if (passwordPending.current) return;
    setError(undefined);
    setSaved(false);
    if (password !== confirm) {
      setError(new ApiError(400, "password_mismatch"));
      return;
    }
    passwordPending.current = true;
    setPasswordBusy(true);
    try {
      const result = await api<{ token: string }>(
        "/auth/password",
        controller.signal,
        { currentPassword: current, newPassword: password },
      );
      if (!controller.signal.aborted) onCredentialChanged(result.token);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause);
    } finally {
      passwordPending.current = false;
      if (!controller.signal.aborted) setPasswordBusy(false);
    }
  }
  const [section, setSection] = useState("settings-codex");
  function jump(id: string) {
    setSection(id);
    document
      .getElementById(id)
      ?.scrollIntoView({
        behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)")
          .matches
          ? "auto"
          : "smooth",
        block: "start",
      });
  }
  const disabled = busy || passwordBusy;
  return (
    <>
      <PageHeading
        title="系统设置"
        description="管理你的研究工具、执行偏好与发布目标。"
        action={
          <button
            type="submit"
            form="runtime-settings"
            disabled={disabled || !data}
          >
            <Icon name="check" size={17} />
            {busy ? "正在保存…" : "保存设置"}
          </button>
        }
      />
      {error ? (
        <p role="alert" className="error">
          {errorText(error)}
        </p>
      ) : null}
      {saved ? (
        <p role="status" className="success-notice">
          <Icon name="check" size={17} />
          设置已保存并生效。
        </p>
      ) : null}
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="设置分区">
          {[
            { id: "settings-codex", label: "模型与执行", icon: "spark" },
            { id: "settings-github", label: "GitHub 归档", icon: "github" },
            { id: "settings-security", label: "安全设置", icon: "shield" },
          ].map((item) => (
            <button
              key={item.id}
              className={section === item.id ? "selected" : ""}
              onClick={() => jump(item.id)}
            >
              <Icon
                name={item.icon as "spark" | "github" | "shield"}
                size={17}
              />
              {item.label}
            </button>
          ))}
          <p>
            配置保存到数据库。
            <br />
            任务空闲时即可生效。
          </p>
        </nav>
        <div className="settings-content">
          {!data ? (
            <p className="loading-state">正在读取设置…</p>
          ) : (
            <form
              className="settings-form"
              id="runtime-settings"
              onSubmit={save}
            >
              <fieldset
                className="settings-section"
                id="settings-codex"
                disabled={disabled}
              >
                <legend>
                  <span className="section-symbol">
                    <Icon name="spark" size={20} />
                  </span>
                  模型与执行
                </legend>
                <p className="section-description">
                  选择研究使用的 Codex，并控制每轮执行的资源。
                </p>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="codex-binary">Codex 可执行文件</label>
                    <input
                      id="codex-binary"
                      value={data.codex.binary}
                      onChange={(e) =>
                        setData({
                          ...data,
                          codex: { ...data.codex, binary: e.target.value },
                        })
                      }
                      required
                    />
                    <p className="field-help">
                      服务主机上的命令或可执行文件路径。
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="codex-model">模型</label>
                    <input
                      id="codex-model"
                      value={data.codex.model}
                      onChange={(e) =>
                        setData({
                          ...data,
                          codex: { ...data.codex, model: e.target.value },
                        })
                      }
                      maxLength={128}
                      placeholder="沿用 Codex 配置"
                    />
                    <p className="field-help">留空使用 Codex 的默认模型。</p>
                  </div>
                </div>
                <div className="form-grid three-columns">
                  <div className="field">
                    <label htmlFor="run-timeout">每轮超时（毫秒）</label>
                    <input
                      id="run-timeout"
                      type="number"
                      min={1000}
                      max={3600000}
                      value={data.execution.timeoutMs}
                      onChange={(e) =>
                        setData({
                          ...data,
                          execution: {
                            ...data.execution,
                            timeoutMs: Number(e.target.value),
                          },
                        })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="concurrency">并发数</label>
                    <input
                      id="concurrency"
                      type="number"
                      min={1}
                      max={4}
                      value={data.execution.concurrency}
                      onChange={(e) =>
                        setData({
                          ...data,
                          execution: {
                            ...data.execution,
                            concurrency: Number(e.target.value),
                          },
                        })
                      }
                      required
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="queue-size">最大等待队列</label>
                    <input
                      id="queue-size"
                      type="number"
                      min={1}
                      max={100}
                      value={data.execution.maxQueue}
                      onChange={(e) =>
                        setData({
                          ...data,
                          execution: {
                            ...data.execution,
                            maxQueue: Number(e.target.value),
                          },
                        })
                      }
                      required
                    />
                  </div>
                </div>
                <div className="settings-inline-row">
                  <div>
                    <label htmlFor="log-level">日志级别</label>
                    <p className="field-help">控制服务日志的详细程度。</p>
                  </div>
                  <select
                    id="log-level"
                    value={data.logLevel}
                    onChange={(e) =>
                      setData({
                        ...data,
                        logLevel: e.target.value as SettingsView["logLevel"],
                      })
                    }
                  >
                    {[
                      "fatal",
                      "error",
                      "warn",
                      "info",
                      "debug",
                      "trace",
                      "silent",
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </select>
                </div>
                <p className="subtle-note">
                  <Icon name="info" size={15} />
                  Codex 账户登录仍由服务主机管理。
                </p>
              </fieldset>
              <fieldset
                className="settings-section"
                id="settings-github"
                disabled={disabled}
              >
                <legend>
                  <span className="section-symbol">
                    <Icon name="github" size={20} />
                  </span>
                  GitHub 归档
                </legend>
                <div className="settings-inline-row archive-toggle">
                  <div>
                    <strong>归档已批准的日报</strong>
                    <p className="field-help">
                      将审核通过的内容保存到你指定的仓库。
                    </p>
                  </div>
                  <label className="switch-control">
                    <input
                      type="checkbox"
                      aria-label="启用 GitHub 归档"
                      checked={data.github.enabled}
                      onChange={(e) =>
                        setData({
                          ...data,
                          github: { ...data.github, enabled: e.target.checked },
                        })
                      }
                    />
                    <span className="switch-track" />
                    <span className="sr-only">启用 GitHub 归档</span>
                  </label>
                </div>
                <div className="form-grid">
                  <div className="field">
                    <label htmlFor="github-repository">GitHub 仓库</label>
                    <input
                      id="github-repository"
                      value={data.github.repository}
                      onChange={(e) =>
                        setData({
                          ...data,
                          github: {
                            ...data.github,
                            repository: e.target.value,
                          },
                        })
                      }
                      placeholder="owner/repository"
                      required={data.github.enabled}
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="github-branch">GitHub 分支</label>
                    <input
                      id="github-branch"
                      value={data.github.branch}
                      onChange={(e) =>
                        setData({
                          ...data,
                          github: { ...data.github, branch: e.target.value },
                        })
                      }
                      placeholder="reports"
                      required={data.github.enabled}
                    />
                  </div>
                </div>
                <div className="field token-field">
                  <label htmlFor="github-token">
                    GitHub Token{" "}
                    <span
                      className={`secret-state ${data.github.tokenConfigured ? "configured" : ""}`}
                    >
                      {data.github.tokenConfigured ? "已保存" : "未配置"}
                    </span>
                  </label>
                  <input
                    id="github-token"
                    aria-label="GitHub Token"
                    type="password"
                    value={token}
                    onChange={(e) => {
                      setToken(e.target.value);
                      setClearToken(false);
                    }}
                    autoComplete="off"
                    disabled={clearToken}
                    placeholder={
                      data.github.tokenConfigured
                        ? "留空保留现有 Token"
                        : "输入具有目标仓库权限的 Token"
                    }
                  />
                  <p className="field-help">
                    {data.github.tokenConfigured
                      ? "已配置；留空保留原 Token。"
                      : "尚未配置 Token。"}
                    只授予目标仓库所需的内容读写权限。
                  </p>
                </div>
                <label className="check clear-secret">
                  <input
                    type="checkbox"
                    checked={clearToken}
                    onChange={(e) => {
                      setClearToken(e.target.checked);
                      setToken("");
                    }}
                  />
                  清除已存 Token
                </label>
                <p className="subtle-note">
                  <Icon name="shield" size={15} />
                  保存目标不会自动发布，归档仍需你单独确认。
                </p>
              </fieldset>
              <p className="settings-save-note">
                <Icon name="info" size={15} />
                任务或归档执行中，请等待完成后保存设置。
              </p>
            </form>
          )}
          <section className="settings-section" id="settings-security">
            <div className="settings-section-title">
              <span className="section-symbol">
                <Icon name="shield" size={20} />
              </span>
              <h2>管理员密码</h2>
            </div>
            <p className="section-description">
              更新登录凭据，管理你对工作台的访问。
            </p>
            <form className="settings-form" onSubmit={rotate}>
              <div className="field">
                <label htmlFor="current-password">当前密码或旧 Token</label>
                <input
                  id="current-password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  disabled={disabled}
                />
              </div>
              <div className="form-grid">
                <div className="field">
                  <label htmlFor="new-password">新管理员密码</label>
                  <input
                    id="new-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={disabled}
                  />
                </div>
                <div className="field">
                  <label htmlFor="repeat-password">确认新密码</label>
                  <input
                    id="repeat-password"
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    maxLength={128}
                    required
                    value={confirm}
                    onChange={(e) => setConfirm(e.target.value)}
                    disabled={disabled}
                  />
                </div>
              </div>
              <div className="password-action">
                <p className="field-help">
                  至少 12 个字符。更新后其他会话会失效。
                </p>
                <button className="quiet" disabled={disabled}>
                  {passwordBusy ? "正在更新…" : "更新管理员密码"}
                </button>
              </div>
            </form>
          </section>
        </div>
      </div>
    </>
  );
}
