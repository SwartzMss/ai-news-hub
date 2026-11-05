import type { TaskConfiguration } from "../../../../packages/shared/src/index.js";
import { HttpError } from "../errors.js";
export function taskInput(value: unknown): {
  name: string;
  status: "active" | "paused";
  configuration: TaskConfiguration;
} {
  const fail = (): never => {
    throw new HttpError(400, "invalid_task_configuration");
  };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return fail();
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "name",
          "status",
          "topic",
          "prompts",
          "autoPublish",
          "schedule",
          "timezone",
        ].includes(k),
    )
  )
    return fail();
  if (
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 200 ||
    typeof v.topic !== "string" ||
    !v.topic.trim() ||
    v.topic.length > 200
  )
    return fail();
  if (
    !Array.isArray(v.prompts) ||
    v.prompts.length < 1 ||
    v.prompts.length > 20 ||
    v.prompts.some((p) => typeof p !== "string" || !p.trim() || p.length > 8000)
  )
    return fail();
  if (
    typeof v.autoPublish !== "boolean" ||
    !v.schedule ||
    typeof v.schedule !== "object" ||
    Array.isArray(v.schedule)
  )
    return fail();
  if (v.status !== undefined && v.status !== "active" && v.status !== "paused")
    return fail();
  const timezone = v.timezone ?? "Asia/Shanghai";
  if (typeof timezone !== "string") return fail();
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
  } catch {
    return fail();
  }
  const schedule = v.schedule as TaskConfiguration["schedule"];
  const allowed: Record<string, string[]> = {
    manual: ["kind"],
    once: ["kind", "at"],
    interval: ["kind", "minutes"],
    daily: ["kind", "time"],
    weekly: ["kind", "time", "weekday"],
  };
  if (
    typeof schedule.kind !== "string" ||
    !Object.hasOwn(allowed, schedule.kind) ||
    Object.keys(schedule).some((k) => !allowed[schedule.kind]!.includes(k))
  )
    return fail();
  if (
    schedule.kind === "once" &&
    (typeof schedule.at !== "string" ||
      !/Z$|[+-]\d\d:\d\d$/.test(schedule.at) ||
      !Number.isFinite(Date.parse(schedule.at)))
  )
    return fail();
  if (
    schedule.kind === "interval" &&
    (!Number.isInteger(schedule.minutes) ||
      schedule.minutes! < 1 ||
      schedule.minutes! > 525600)
  )
    return fail();
  if (
    ["daily", "weekly"].includes(schedule.kind) &&
    (typeof schedule.time !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(schedule.time))
  )
    return fail();
  if (
    schedule.kind === "weekly" &&
    (!Number.isInteger(schedule.weekday) ||
      schedule.weekday! < 0 ||
      schedule.weekday! > 6)
  )
    return fail();
  return {
    name: v.name.trim(),
    status: (v.status ?? "active") as "active" | "paused",
    configuration: {
      topic: v.topic.trim(),
      prompts: v.prompts as string[],
      autoPublish: v.autoPublish,
      schedule,
      timezone,
    },
  };
}
/** Strictly future occurrence; missed slots never accumulate. IANA timezone conversion uses Intl. */
export function nextOccurrence(
  configuration: TaskConfiguration,
  after: Date,
): string | null {
  const s = configuration.schedule;
  if (s.kind === "manual") return null;
  if (s.kind === "once")
    return Date.parse(s.at!) > after.getTime()
      ? new Date(s.at!).toISOString()
      : null;
  if (s.kind === "interval")
    return new Date(after.getTime() + s.minutes! * 60000).toISOString();
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: configuration.timezone,
    hourCycle: "h23",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
  });
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // At most eight days, minute precision, handles DST gaps without inventing a local instant.
  for (
    let t = Math.floor(after.getTime() / 60000) * 60000 + 60000;
    t <= after.getTime() + 8 * 86400000;
    t += 60000
  ) {
    const parts = formatter.formatToParts(t),
      get = (type: string) => parts.find((p) => p.type === type)?.value;
    if (
      `${get("hour")}:${get("minute")}` === s.time &&
      (s.kind === "daily" || get("weekday") === weekdays[s.weekday!])
    )
      return new Date(t).toISOString();
  }
  throw new HttpError(400, "invalid_schedule");
}
