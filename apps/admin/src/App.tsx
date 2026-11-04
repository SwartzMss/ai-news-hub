import { useCallback, useEffect, useMemo, useState } from "react";
import { client, type ApiError } from "./api";
import { Login } from "./Login";
import { Settings } from "./Settings";
import { Dashboard, TaskDetail, RunDetail } from "./TaskViews";
import { Brand, Icon, pathFor } from "./ui";

export function App() {
  const [token, setToken] = useState(""),
    [error, setError] = useState<unknown>(),
    [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const change = () => setHash(location.hash);
    addEventListener("hashchange", change);
    return () => removeEventListener("hashchange", change);
  }, []);
  const expire = useCallback((cause: ApiError) => {
    setToken("");
    setError(cause);
  }, []);
  const api = useMemo(() => client(token, expire), [token, expire]);
  const connected = (value: string) => {
    setError(undefined);
    setToken(value);
  };
  let taskId: string | undefined, runId: string | undefined;
  try {
    const match = /^#\/tasks\/([^/]+)(?:\/runs\/([^/]+))?$/.exec(hash);
    if (match) {
      taskId = decodeURIComponent(match[1]);
      runId = match[2] ? decodeURIComponent(match[2]) : undefined;
    }
  } catch {
    /* Invalid route returns to the workspace. */
  }
  const settings = hash === "#/settings";
  function logout() {
    void client(token, () => {})(
      "/auth/logout",
      AbortSignal.timeout(10000),
      {},
    ).catch(() => {});
    setToken("");
    setError(undefined);
  }
  if (!token) return <Login onConnected={connected} error={error} />;
  return (
    <div className="app-shell">
      <a
        href="#main-content"
        className="skip-link"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById("main-content")?.focus();
        }}
      >
        跳到主要内容
      </a>
      <aside className="sidebar">
        <a className="sidebar-brand" href="#" aria-label="News Hub 首页">
          <Brand />
        </a>
        <div className="workspace-identity">
          <span className="workspace-avatar">N</span>
          <span>
            个人工作空间<small>新闻研究与内容管理</small>
          </span>
        </div>
        <nav className="primary-nav" aria-label="主导航">
          <a href="#" aria-current={!settings ? "page" : undefined}>
            <Icon name="grid" />
            <span>任务总览</span>
            {!settings && <span className="nav-marker" />}
          </a>
          <a href="#/settings" aria-current={settings ? "page" : undefined}>
            <Icon name="settings" />
            <span>系统设置</span>
            {settings && <span className="nav-marker" />}
          </a>
        </nav>
        <div className="sidebar-footer">
          <div className="workspace-note">
            <Icon name="shield" />
            <p>
              由你决定何时发布<small>研究结果经人工审核后归档</small>
            </p>
          </div>
          <button className="logout-button" onClick={logout} aria-label="退出">
            <Icon name="logout" />
            <span>退出</span>
          </button>
        </div>
      </aside>
      <header className="topbar">
        <nav className="breadcrumbs" aria-label="页面位置">
          <span>工作空间</span>
          <Icon name="chevron" size={14} />
          {taskId ? (
            <>
              <a href={pathFor(taskId)}>任务详情</a>
              {runId && (
                <>
                  <Icon name="chevron" size={14} />
                  <span>研究记录</span>
                </>
              )}
            </>
          ) : (
            <span>{settings ? "系统设置" : "任务总览"}</span>
          )}
        </nav>
        <div className="topbar-meta">
          <span className="local-label">
            <Icon name="shield" size={14} />
            本地管理
          </span>
          <span className="user-avatar" title="管理员">
            A
          </span>
        </div>
      </header>
      <main
        className="workspace-content"
        id="main-content"
        tabIndex={-1}
        key={`${token}:${settings}:${taskId ?? ""}:${runId ?? ""}`}
      >
        {settings ? (
          <Settings api={api} onCredentialChanged={connected} />
        ) : !taskId ? (
          <Dashboard api={api} />
        ) : runId ? (
          <RunDetail api={api} taskId={taskId} runId={runId} />
        ) : (
          <TaskDetail api={api} taskId={taskId} />
        )}
      </main>
    </div>
  );
}
