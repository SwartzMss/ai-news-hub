import { Runs } from "./Runs";
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
  const settingsPages = [
    { id: "codex", label: "模型与执行", icon: "spark" as const },
    { id: "github", label: "GitHub 归档", icon: "github" as const },
    { id: "security", label: "安全设置", icon: "shield" as const },
  ];
  const settingsPage = settingsPages.find(
    (page) =>
      hash === `#/settings/${page.id}` ||
      (page.id === "codex" && hash === "#/settings"),
  );
  const settings = !!settingsPage;
  const resultsPage = hash === "#/runs" || hash.startsWith("#/runs?");
  const resultsTaskId =
    new URLSearchParams(hash.split("?")[1] ?? "").get("taskId") ?? "";
  const inResults = resultsPage || !!runId;
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
        <nav className="primary-nav" aria-label="主导航">
          <a
            href="#"
            aria-current={!settings && !inResults ? "page" : undefined}
          >
            <Icon name="grid" />
            <span>任务总览</span>
            {!settings && !inResults && <span className="nav-marker" />}
          </a>
          <a href="#/runs" aria-current={inResults ? "page" : undefined}>
            <Icon name="file" />
            <span>运行与结果</span>
          </a>
          {settingsPages.map((page) => (
            <a
              key={page.id}
              href={`#/settings/${page.id}`}
              aria-current={settingsPage?.id === page.id ? "page" : undefined}
            >
              <Icon name={page.icon} />
              <span>{page.label}</span>
            </a>
          ))}
        </nav>
        <div className="sidebar-footer">
          <button className="logout-button" onClick={logout} aria-label="退出">
            <Icon name="logout" />
            <span>退出</span>
          </button>
        </div>
      </aside>
      <main
        className={`workspace-content${settings ? " settings-page" : ""}`}
        id="main-content"
        tabIndex={-1}
        key={`${token}:${resultsPage}:${resultsTaskId}:${settingsPage?.id ?? ""}:${taskId ?? ""}:${runId ?? ""}`}
      >
        {taskId && runId && (
          <div className="run-back-links">
            <a href={`#/runs?taskId=${encodeURIComponent(taskId)}`}>
              返回运行记录
            </a>
            <a href={pathFor(taskId)}>所属任务</a>
          </div>
        )}
        {settings ? (
          <Settings
            api={api}
            onCredentialChanged={connected}
            initialSection={`settings-${settingsPage!.id}`}
            hideNavigation
          />
        ) : resultsPage ? (
          <Runs api={api} initialTaskId={resultsTaskId} />
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
