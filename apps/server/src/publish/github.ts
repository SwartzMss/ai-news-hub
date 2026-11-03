import { AppError } from "../errors.js";
import { githubHttpClient, githubText, type GitHubFetch } from "./http.js";
import type {
  ArchiveArtifact,
  GitHubAdapter,
  PublishTarget,
} from "./service.js";
export class GitHubArchive implements GitHubAdapter {
  private http;
  constructor(
    private target: PublishTarget,
    private token: string,
    fetcher?: GitHubFetch,
  ) {
    this.http = fetcher ? { fetcher, close: async () => {} } : githubHttpClient();
  }
  async publish(artifact: ArchiveArtifact, signal: AbortSignal) {
    if (
      !/^reports\/\d{4}\/\d{2}\/\d{2}\/opensource\/v\d{6}\.json$/.test(
        artifact.path,
      ) ||
      Buffer.byteLength(artifact.content) > 256 * 1024
    )
      throw new AppError("archive_invalid");
    const combined = AbortSignal.any([signal, AbortSignal.timeout(20000)]);
    const request = async (
      path: string,
      method = "GET",
      body?: unknown,
      missing = false,
    ): Promise<unknown> => {
      try {
        const response = await this.http.fetcher(
          `https://api.github.com/repos/${this.target.repository}/${path}`,
          {
            method,
            redirect: "error",
            signal: combined,
            headers: {
              authorization: `Bearer ${this.token}`,
              accept: "application/vnd.github+json",
              "x-github-api-version": "2026-03-10",
              "user-agent": "AI-News-Hub/0.1",
              ...(body ? { "content-type": "application/json" } : {}),
            },
            ...(body ? { body: JSON.stringify(body) } : {}),
          },
        );
        if (missing && response.status === 404) {
          await response.body?.cancel();
          return undefined;
        }
        if (!response.ok) {
          await response.body?.cancel();
          throw new AppError(`github_http_${response.status}`);
        }
        return JSON.parse(await githubText(response)) as unknown;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError(
          combined.aborted ? "github_timeout" : "github_unavailable",
        );
      }
    };
    // All reads use a fixed commit snapshot; a missing branch is never created implicitly.
    const ref = (await request(
      "git/ref/heads/" + encodeURIComponent(this.target.branch),
    )) as { object?: { type?: string; sha?: string } };
    if (ref.object?.type !== "commit" || !validSha(ref.object.sha))
      throw new AppError("github_invalid_response");
    const head = ref.object.sha;
    const path = "contents/" + artifact.path;
    const existing = (await request(
      path + "?ref=" + head,
      "GET",
      undefined,
      true,
    )) as
      | { type?: string; encoding?: string; content?: string; size?: number }
      | undefined;
    if (existing) {
      if (
        existing.type !== "file" ||
        existing.encoding !== "base64" ||
        typeof existing.content !== "string" ||
        !Buffer.from(existing.content, "base64").equals(
          Buffer.from(artifact.content, "utf8"),
        )
      )
        throw new AppError("archive_conflict");
      const commits = (await request(
        "commits?" +
          new URLSearchParams({
            path: artifact.path,
            sha: head,
            per_page: "1",
          }),
      )) as { sha?: string; commit?: { committer?: { date?: string } } }[];
      return commitResult(commits?.[0]);
    }
    const result = (await request(path, "PUT", {
      message: `archive: ${artifact.path} (${artifact.hash.slice(0, 12)})`,
      content: Buffer.from(artifact.content).toString("base64"),
      branch: this.target.branch,
    })) as { commit?: { sha?: string; committer?: { date?: string } } };
    return commitResult(result.commit);
  }
  async close() {
    await this.http.close();
  }
}
const validSha = (value: unknown): value is string =>
  typeof value === "string" && /^[a-f0-9]{40}$/.test(value);
function commitResult(
  value:
    | {
        sha?: string;
        committer?: { date?: string };
        commit?: { committer?: { date?: string } };
      }
    | undefined,
) {
  const date = value?.committer?.date ?? value?.commit?.committer?.date;
  if (!validSha(value?.sha) || !date || !Number.isFinite(Date.parse(date)))
    throw new AppError("github_invalid_response");
  return { sha: value.sha, committedAt: new Date(date).toISOString() };
}
