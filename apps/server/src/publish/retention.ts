import { dateInTimezone, nextOccurrence } from "../tasks/configuration.js";
import type { PublicationService } from "./service.js";

const timezone = "Asia/Shanghai";
const schedule = { timezone, schedule: { kind: "daily" as const, time: "03:00" } };
const retryDelayMs = 15 * 60 * 1000;

export function retentionCutoffDate(at: Date): string {
  const [year, month, day] = dateInTimezone(at, timezone).split("-").map(Number);
  const cutoff = new Date(Date.UTC(year!, month! - 1, day!));
  cutoff.setUTCDate(cutoff.getUTCDate() - 29);
  return cutoff.toISOString().slice(0, 10);
}

export class ReportRetentionScheduler {
  private active?: Promise<number>;
  private nextAttemptAt?: number;
  private stopping = false;

  constructor(
    private publications: Pick<PublicationService, "removeExpiredBefore">,
    private now: () => Date = () => new Date(),
  ) {}

  tick(at = this.now()): Promise<number> {
    if (this.stopping || this.active) return Promise.resolve(0);
    if (this.nextAttemptAt !== undefined && at.getTime() < this.nextAttemptAt)
      return Promise.resolve(0);
    const cutoff = retentionCutoffDate(at);
    const operation = Promise.resolve().then(() => this.publications.removeExpiredBefore(cutoff));
    const promise = operation
      .then((deleted) => {
        const current = this.now();
        const after = current.getTime() > at.getTime() ? current : at;
        this.nextAttemptAt = Date.parse(nextOccurrence(schedule, after)!);
        return deleted;
      })
      .catch((error) => {
        this.nextAttemptAt = Math.max(this.now().getTime(), at.getTime()) + retryDelayMs;
        throw error;
      })
      .finally(() => {
        if (this.active === promise) this.active = undefined;
      });
    this.active = promise;
    return promise;
  }

  stop(): void {
    this.stopping = true;
  }

  async close(): Promise<void> {
    this.stop();
    await this.active?.catch(() => {});
  }
}
