import type { ReactNode } from "react";
export type IconName =
  | "grid"
  | "settings"
  | "logout"
  | "arrow"
  | "plus"
  | "search"
  | "spark"
  | "file"
  | "clock"
  | "shield"
  | "check"
  | "github"
  | "message"
  | "activity"
  | "info"
  | "chevron"
  | "link"
  | "inbox";
const paths: Record<IconName, ReactNode> = {
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-.7 2.4-2 .9L4 5.7 2 9l1.8 1.7v2.6L2 15l2 3.3 2.3-.6 2 .9L9 21h4l.7-2.4 2-.9 2.3.6 2-3.3-1.8-1.7v-2.6L20 9l-2-3.3-2.3.6-2-.9L13 3Z" />
      <circle cx="11" cy="12" r="3" />
    </>
  ),
  logout: (
    <>
      <path d="M9 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h4m6-12 4 4-4 4m4-4H9" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 4 4" />
    </>
  ),
  spark: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5Z" />
      <path d="M20 2v4m-2-2h4" />
    </>
  ),
  file: (
    <>
      <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Z" />
      <path d="M14 3v6h6M8 13h8m-8 4h5" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  shield: (
    <>
      <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6Z" />
      <path d="m8 12 3 3 5-6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  github: (
    <>
      <path
        d="M9 20c-4 1-4-2-6-2m12 4v-4c0-1 .1-1.5-.5-2 3-.4 5.5-1.5 5.5-6a5 5 0 0 0-1.5-3.5A5 5 0 0 0 18.4 3s-1.2-.4-3.9 1.4a13 13 0 0 0-7 0C4.8 2.6 3.6 3 3.6 3a5 5 0 0 0-.1 3.5A5 5 0 0 0 2 10c0 4.5 2.5 5.6 5.5 6-.6.5-.5 1-.5 2v4"
        transform="translate(1 -1) scale(.92)"
      />
    </>
  ),
  message: (
    <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5A8.5 8.5 0 0 1 10.5 3h2a8.5 8.5 0 0 1 8.5 8.5Z" />
  ),
  activity: <path d="M3 12h4l3-8 4 16 3-8h4" />,
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.01" />
    </>
  ),
  chevron: <path d="m9 5 7 7-7 7" />,
  link: (
    <>
      <path
        d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"
        transform="translate(1 1)"
      />
    </>
  ),
  inbox: (
    <>
      <path d="M4 4h16l2 11v5H2v-5Zm-2 11h6l2 3h4l2-3h6" />
    </>
  ),
};
export function Icon({
  name,
  size = 18,
  className = "",
}: {
  name: IconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      className={`icon ${className}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {paths[name]}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand-lockup">
      <span className="brand-mark">
        <Icon name="file" size={19} />
      </span>
      <span>
        News Hub<span className="brand-caption">AI 研究工作台</span>
      </span>
    </span>
  );
}
export const labels: Record<string, string> = {
  queued: "待执行",
  running: "执行中",
  waiting_approval: "需要审批",
  succeeded: "成功",
  failed: "失败",
  cancelled: "已取消",
  interrupted: "已中断",
  active: "已启用",
  paused: "已暂停",
};
export function Badge({ status }: { status: string }) {
  return (
    <span className={`badge ${status}`}>
      <span className="status-dot" />
      {labels[status] ?? status}
    </span>
  );
}
export const time = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : "—";
export const active = (status: string) =>
  ["queued", "running", "waiting_approval"].includes(status);
export const pathFor = (task: string, run?: string) =>
  `#/tasks/${encodeURIComponent(task)}${run ? "/runs/" + encodeURIComponent(run) : ""}`;
export function PageHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {description && <p className="page-description">{description}</p>}
      </div>
      {action && <div className="page-action">{action}</div>}
    </div>
  );
}
export function EmptyState({
  title,
  children,
  icon = "inbox",
}: {
  title: string;
  children: ReactNode;
  icon?: IconName;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
