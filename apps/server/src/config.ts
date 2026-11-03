import { isAbsolute, normalize } from "node:path";
import { AppError } from "./errors.js";

export const LOG_LEVELS = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const;
export interface Config {
  host: "127.0.0.1" | "::1";
  port: number;
  dataDir: string;
  logLevel: (typeof LOG_LEVELS)[number];
  adminToken?: string;
  codexBin: string;
  model?: string;
  runTimeoutMs: number;
  concurrency: number;
  maxQueue: number;
  publication?: { repository: string; branch: string; token: string };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const host = env.AI_NEWS_HUB_HOST ?? "127.0.0.1";
  const portText = env.AI_NEWS_HUB_PORT ?? "3000";
  const dataDir = env.AI_NEWS_HUB_DATA_DIR ?? "/var/lib/ai-news-hub";
  const logLevel = env.AI_NEWS_HUB_LOG_LEVEL ?? "info";
  const adminToken = env.AI_NEWS_HUB_ADMIN_TOKEN || undefined;
  const repository = env.AI_NEWS_HUB_GITHUB_REPOSITORY || undefined;
  const branch = env.AI_NEWS_HUB_GITHUB_BRANCH || undefined;
  const githubToken = env.AI_NEWS_HUB_GITHUB_TOKEN || undefined;
  if (repository || branch || githubToken) {
    if (
      !repository ||
      !branch ||
      !githubToken ||
      !/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}\/[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(
        repository,
      ) ||
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/.test(branch) ||
      branch.includes("..") ||
      branch.includes("//") ||
      branch.endsWith("/") ||
      branch.endsWith(".") ||
      branch.split("/").some((x) => x.endsWith(".lock")) ||
      !/^[A-Za-z0-9_]{20,255}$/.test(githubToken)
    )
      throw new AppError("invalid_publication_config");
  }
  const numeric = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    const raw = env[name] ?? String(fallback);
    if (!/^\d+$/.test(raw) || Number(raw) < minimum || Number(raw) > maximum)
      throw new AppError("invalid_config");
    return Number(raw);
  };
  if (
    (host !== "127.0.0.1" && host !== "::1") ||
    !/^\d+$/.test(portText) ||
    Number(portText) < 1 ||
    Number(portText) > 65535 ||
    !isAbsolute(dataDir) ||
    !LOG_LEVELS.includes(logLevel as Config["logLevel"]) ||
    (adminToken !== undefined && !/^[A-Za-z0-9_-]{32,256}$/.test(adminToken))
  ) {
    throw new AppError(
      "invalid_config",
      "Check AI_NEWS_HUB_HOST/PORT/DATA_DIR/LOG_LEVEL",
    );
  }
  const codexBin = env.AI_NEWS_HUB_CODEX_BIN ?? "codex";
  const model = env.AI_NEWS_HUB_MODEL || undefined;
  if (
    !codexBin ||
    (model !== undefined && (model.length > 128 || /[\r\n]/.test(model)))
  )
    throw new AppError("invalid_config");
  return {
    host,
    port: Number(portText),
    dataDir: normalize(dataDir),
    logLevel: logLevel as Config["logLevel"],
    adminToken,
    codexBin,
    model,
    publication:
      repository && branch && githubToken
        ? { repository, branch, token: githubToken }
        : undefined,
    runTimeoutMs: numeric("AI_NEWS_HUB_RUN_TIMEOUT_MS", 120000, 1000, 3600000),
    concurrency: numeric("AI_NEWS_HUB_CONCURRENCY", 1, 1, 4),
    maxQueue: numeric("AI_NEWS_HUB_MAX_QUEUE", 20, 1, 100),
  };
}
