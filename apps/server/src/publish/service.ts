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
export interface ArchiveRemoval {
  reportId: string; path: string; hash: string;
}
export interface GitHubAdapter {
  remove?(artifact: ArchiveRemoval, target: PublishTarget, signal: AbortSignal): Promise<void>;
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
  private deletion?: Promise<{ deleted: true }>;
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
  busy():boolean{return !!(this.active || this.deletion);}
  configure(target:PublishTarget|undefined,adapter:GitHubAdapter|undefined):void {
    if(this.busy())throw new HttpError(409,'settings_busy');
    this.target=target;this.adapter=adapter;
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
  approve(id: string, expectedHash: string, kind: 'manual'|'automatic' = 'manual') {
    this.assertNotDeleting(id);
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
          "INSERT INTO report_approvals(report_id,content_hash,approved_at,approval_kind) VALUES (?,?,?,?)",
        )
        .run(id, expectedHash, new Date().toISOString(), kind);
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
    if (this.busy())
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
    this.assertNotDeleting(id);
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
      if(signal.aborted)throw new AppError("publication_interrupted");
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
        this.db.prepare("UPDATE task_runs SET error_code=NULL,updated_at=? WHERE id=? AND status='succeeded'").run(new Date().toISOString(), report.document.runId);
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
  private assertNotDeleting(id: string) {
    if (this.db.prepare("SELECT report_id FROM report_deletions WHERE report_id=?").get(id))
      throw new HttpError(409, "report_deleting");
  }
  remove(id: string): Promise<{ deleted: true }> {
    if (this.stopped) return Promise.reject(new HttpError(503, "publisher_stopped"));
    if (this.busy()) return Promise.reject(new HttpError(409, "publication_busy"));
    this.controller = new AbortController();
    const promise = this.performRemoval(id, this.controller.signal);
    this.deletion = promise;
    void promise.finally(() => { if (this.deletion === promise) this.deletion = undefined; }).catch(() => {});
    return promise;
  }
  private async performRemoval(id: string, signal: AbortSignal): Promise<{ deleted: true }> {
    const prior = this.db.prepare("SELECT status FROM report_deletions WHERE report_id=?").get(id);
    if (prior?.status === "succeeded") return { deleted: true };
    const report = this.db.prepare("SELECT * FROM reports WHERE id=?").get(id);
    if (!report) throw new HttpError(404, "report_not_found");
    const run = this.db.prepare("SELECT status FROM task_runs WHERE id=?").get(String(report.run_id));
    if (run && ["running", "queued", "waiting_approval"].includes(String(run.status)))
      throw new HttpError(409, "report_busy");
    const records = this.db.prepare("SELECT * FROM publication_records WHERE report_id=? AND target='github'").all(id);
    if (records.length && !this.adapter?.remove) throw new HttpError(503, "publication_disabled");
    const timestamp = new Date().toISOString();
    this.db.prepare(`INSERT INTO report_deletions(report_id,channel,report_date,version,status,created_at,updated_at)
      VALUES (?,?,?,?,'pending',?,?) ON CONFLICT(report_id) DO UPDATE SET status='pending',error_code=NULL,updated_at=excluded.updated_at`)
      .run(id, String(report.channel), String(report.report_date), Number(report.version), timestamp, timestamp);
    try {
      for (const record of records) {
        if (!record.repository || !record.branch || !record.artifact_path || !record.content_hash)
          throw new AppError("archive_target_unknown");
        await this.adapter!.remove!({reportId:id,path:String(record.artifact_path),hash:String(record.content_hash)},
          {repository:String(record.repository),branch:String(record.branch)}, signal);
      }
      signal.throwIfAborted();
      this.db.exec("BEGIN IMMEDIATE");
      try {
        this.db.prepare("UPDATE news_runs SET report_id=NULL WHERE report_id=?").run(id);
        this.db.prepare("UPDATE codex_news_runs SET report_id=NULL WHERE report_id=?").run(id);
        this.db.prepare("DELETE FROM report_articles WHERE report_id=?").run(id);
        this.db.prepare("DELETE FROM report_approvals WHERE report_id=?").run(id);
        this.db.prepare("DELETE FROM publication_records WHERE report_id=?").run(id);
        this.db.prepare("DELETE FROM reports WHERE id=?").run(id);
        this.db.prepare("UPDATE report_deletions SET status='succeeded',error_code=NULL,updated_at=? WHERE report_id=?")
          .run(new Date().toISOString(),id);
        this.db.prepare("INSERT INTO run_events(run_id,kind,data_json) VALUES (?,'report_deleted',?)")
          .run(String(report.run_id),JSON.stringify({reportId:id}));
        this.db.exec("COMMIT");
      } catch (error) { this.db.exec("ROLLBACK"); throw error; }
      return { deleted: true };
    } catch (error) {
      const code = error instanceof AppError ? error.code : signal.aborted ? "publication_interrupted" : "github_unavailable";
      this.db.prepare("UPDATE report_deletions SET status='failed',error_code=?,updated_at=? WHERE report_id=?")
        .run(code,new Date().toISOString(),id);
      throw new HttpError(502,code);
    }
  }
  interrupt():void { this.controller?.abort(); }
  async close() {
    this.stopped = true;
    this.controller?.abort();
    await this.active?.catch(() => {});
    await this.deletion?.catch(() => {});
  }
}
