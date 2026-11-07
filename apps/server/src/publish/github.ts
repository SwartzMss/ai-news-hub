import { createHash } from "node:crypto";
import { AppError } from "../errors.js";
import { githubHttpClient, githubText, type GitHubFetch } from "./http.js";
import type {
  ArchiveArtifact,
  ArchiveRemoval,
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
      !(
        /^reports\/\d{4}\/\d{2}\/\d{2}\/opensource\/v\d{6}\.json$/.test(artifact.path) ||
        /^reports\/topics\/t-[a-f0-9]{24}\/\d{4}\/\d{2}\/\d{2}\/v\d{6}\.json$/.test(artifact.path)
      ) ||
      Buffer.byteLength(artifact.content) > 256 * 1024
    )
      throw new AppError("archive_invalid");
    const request = this.request(signal);
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
  private request(signal: AbortSignal) {
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
    return request;
  }
  async remove(artifact: ArchiveRemoval, target: PublishTarget, signal: AbortSignal): Promise<void> {
    if (!(/^reports\/\d{4}\/\d{2}\/\d{2}\/opensource\/v\d{6}\.json$/.test(artifact.path) ||
      /^reports\/topics\/t-[a-f0-9]{24}\/\d{4}\/\d{2}\/\d{2}\/v\d{6}\.json$/.test(artifact.path)))
      throw new AppError("archive_invalid");
    if (target.repository !== this.target.repository || target.branch !== this.target.branch) throw new AppError("archive_target_unknown");
    const request = this.request(signal);
    const ref = await request("git/ref/heads/" + encodeURIComponent(this.target.branch)) as {object?:{sha?:string;type?:string}};
    if (ref.object?.type !== "commit" || !validSha(ref.object.sha)) throw new AppError("github_invalid_response");
    const head = ref.object.sha;
    const read = async (path: string) => {
      const file = await request("contents/" + path + "?ref=" + head,"GET",undefined,true) as {type?:string;encoding?:string;content?:string}|undefined;
      if (!file) return undefined;
      if (file.type !== "file" || file.encoding !== "base64" || typeof file.content !== "string") throw new AppError("github_invalid_response");
      return Buffer.from(file.content,"base64");
    };
    const content = await read(artifact.path);
    if (content !== undefined && createHash("sha256").update(content).digest("hex") !== artifact.hash)
      throw new AppError("archive_conflict");
    const tree: {path:string;mode:string;type:string;sha?:null;content?:string}[] = [];
    if (content !== undefined) tree.push({path:artifact.path,mode:"100644",type:"blob",sha:null});
    const mapping = await read("reports/topics.json");
    if (mapping !== undefined) {
      const value = JSON.parse(mapping.toString("utf8")) as {schema_version:number;assignments:{report_id:string}[]};
      if (value.schema_version !== 1 || !Array.isArray(value.assignments)) throw new AppError("archive_invalid");
      const assignments = value.assignments.filter(item => item.report_id !== artifact.reportId);
      if (assignments.length !== value.assignments.length)
        tree.push({path:"reports/topics.json",mode:"100644",type:"blob",content:JSON.stringify({...value,assignments},null,2)+"\n"});
    }
    if (!tree.length) return;
    const commit = await request("git/commits/"+head) as {tree?:{sha?:string}};
    if (!validSha(commit.tree?.sha)) throw new AppError("github_invalid_response");
    const nextTree = await request("git/trees","POST",{base_tree:commit.tree.sha,tree}) as {sha?:string};
    if (!validSha(nextTree.sha)) throw new AppError("github_invalid_response");
    const nextCommit = await request("git/commits","POST",{message:`remove report: ${artifact.reportId}`,tree:nextTree.sha,parents:[head]}) as {sha?:string};
    if (!validSha(nextCommit.sha)) throw new AppError("github_invalid_response");
    await request("git/refs/heads/"+encodeURIComponent(this.target.branch),"PATCH",{sha:nextCommit.sha,force:false});
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
