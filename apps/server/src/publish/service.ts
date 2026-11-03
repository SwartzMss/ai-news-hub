import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppError, HttpError } from "../errors.js";
import { reviewedReport, archiveArtifact, sha256 } from "./artifact.js";
export interface PublishTarget {
  repository: string;
  branch: string;
}
export interface ArchiveArtifact {
  path: string;
  content: string;
  hash: string;
}
export interface GitHubAdapter {
  publish(
    artifact: ArchiveArtifact,
    signal: AbortSignal,
  ): Promise<{ sha: string; committedAt: string }>;
}
type Publication = {
  id: string;
  status: string;
  commit_sha: string | null;
  error_code: string | null;
  attempts: number;
} & Record<string, unknown>;
export class PublicationService {
  private active?: Promise<Publication>;
  private controller?: AbortController;
  private stopped = false;
  constructor(
    private db: DatabaseSync,
    private target?: PublishTarget,
    private adapter?: GitHubAdapter,
  ) {
    db.prepare(
      "UPDATE publication_records SET status='failed',error_code='publication_interrupted',updated_at=? WHERE target='github' AND status='publishing'",
    ).run(new Date().toISOString());
  }
  inspect(id: string) {
    const report = reviewedReport(this.db, id);
    return {
      contentHash: report.contentHash,
      status: report.status,
      approval:
        this.db
          .prepare("SELECT * FROM report_approvals WHERE report_id=?")
          .get(id) ?? null,
      configured: !!(this.target && this.adapter),
      target: this.target
        ? { repository: this.target.repository, branch: this.target.branch }
        : null,
      publications: this.db
        .prepare(
          "SELECT * FROM publication_records WHERE report_id=? AND target='github' ORDER BY created_at DESC,id",
        )
        .all(id) as Publication[],
    };
  }
  approve(id: string, expectedHash: string) {
    const report = reviewedReport(this.db, id);
    if (report.contentHash !== expectedHash)
      throw new HttpError(409, "report_changed");
    const prior = this.db
      .prepare("SELECT * FROM report_approvals WHERE report_id=?")
      .get(id);
    if (prior) {
      if (prior.content_hash !== expectedHash)
        throw new HttpError(409, "approval_changed");
      return this.inspect(id);
    }
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO report_approvals(report_id,content_hash,approved_at) VALUES (?,?,?)",
        )
        .run(id, expectedHash, new Date().toISOString());
      this.db
        .prepare("UPDATE reports SET status='approved',updated_at=? WHERE id=?")
        .run(new Date().toISOString(), id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
    return this.inspect(id);
  }
  publish(id: string): Promise<Publication> {
    if (this.stopped)
      return Promise.reject(new HttpError(503, "publisher_stopped"));
    if (this.active)
      return Promise.reject(new HttpError(409, "publication_busy"));
    this.controller = new AbortController();
    const promise = this.perform(id, this.controller.signal);
    this.active = promise;
    void promise
      .finally(() => {
        if (this.active === promise) this.active = undefined;
      })
      .catch(() => {});
    return promise;
  }
  private async perform(id: string, signal: AbortSignal): Promise<Publication> {
    const report = reviewedReport(this.db, id);
    const approval = this.db
      .prepare("SELECT * FROM report_approvals WHERE report_id=?")
      .get(id);
    if (!approval || !["approved", "published"].includes(report.status))
      throw new HttpError(409, "report_not_approved");
    if (approval.content_hash !== report.contentHash)
      throw new HttpError(409, "approval_changed");
    if (!this.target || !this.adapter)
      throw new HttpError(503, "publication_disabled");
    const artifact = archiveArtifact(report, String(approval.approved_at));
    const key =
      "github/" +
      sha256(
        JSON.stringify({
          repository: this.target.repository,
          branch: this.target.branch,
          path: artifact.path,
          hash: artifact.hash,
        }),
      );
    this.db
      .prepare(
        `INSERT OR IGNORE INTO publication_records(id,report_id,target,idempotency_key,status,artifact_path,repository,branch,content_hash)
   VALUES (?,?,'github',?,'pending',?,?,?,?)`,
      )
      .run(
        randomUUID(),
        id,
        key,
        artifact.path,
        this.target.repository,
        this.target.branch,
        artifact.hash,
      );
    const get = () =>
      this.db
        .prepare("SELECT * FROM publication_records WHERE idempotency_key=?")
        .get(key) as Publication;
    if (get().status === "succeeded") return get();
    this.db
      .prepare(
        "UPDATE publication_records SET status='publishing',error_code=NULL,attempts=attempts+1,updated_at=? WHERE idempotency_key=?",
      )
      .run(new Date().toISOString(), key);
    try {
      const result = await this.adapter.publish(artifact, signal);
      if (
        !/^[0-9a-f]{40}$/.test(result.sha) ||
        !Number.isFinite(Date.parse(result.committedAt))
      )
        throw new AppError("github_invalid_response");
      // Revalidate after the remote operation. If local data changed, do not claim publication success.
      if (reviewedReport(this.db, id).contentHash !== report.contentHash)
        throw new AppError("approval_changed");
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db
          .prepare(
            "UPDATE publication_records SET status='succeeded',commit_sha=?,published_at=?,remote_url=?,error_code=NULL,updated_at=? WHERE idempotency_key=?",
          )
          .run(
            result.sha,
            result.committedAt,
            `https://github.com/${this.target.repository}/commit/${result.sha}`,
            new Date().toISOString(),
            key,
          );
        this.db
          .prepare(
            "UPDATE reports SET status='published',updated_at=? WHERE id=?",
          )
          .run(new Date().toISOString(), id);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    } catch (error) {
      const code =
        error instanceof AppError
          ? error.code
          : signal.aborted
            ? "publication_interrupted"
            : "github_unavailable";
      this.db
        .prepare(
          "UPDATE publication_records SET status='failed',error_code=?,updated_at=? WHERE idempotency_key=?",
        )
        .run(code, new Date().toISOString(), key);
    }
    return get();
  }
  async close() {
    this.stopped = true;
    this.controller?.abort();
    await this.active?.catch(() => {});
  }
}
