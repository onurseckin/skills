import { DualTimeRecord } from "./contracts.ts";

/**
 * Renders a clean natural human-readable local time display with timezone abbreviation and UTC offset.
 * Example output: "2026-08-22 02:30:00 PDT (UTC-07:00)" or "2026-08-22 09:30:00 UTC (UTC+00:00)"
 */
export function formatDualTimeDisplay(record: DualTimeRecord): string {
  const date = new Date(record.timestamp_ms);
  let parts: Intl.DateTimeFormatPart[];

  try {
    parts = Intl.DateTimeFormat("en-US", {
      timeZone: record.timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
      timeZoneName: "short",
    }).formatToParts(date);
  } catch {
    parts = [];
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "";

  const year = get("year") || record.local.slice(0, 4);
  const month = get("month") || record.local.slice(5, 7);
  const day = get("day") || record.local.slice(8, 10);
  const hour = get("hour") || record.local.slice(11, 13);
  const minute = get("minute") || record.local.slice(14, 16);
  const second = get("second") || record.local.slice(17, 19);
  const tzShort = get("timeZoneName") || record.timezone;

  const sign = record.offset_minutes >= 0 ? "+" : "-";
  const absM = Math.abs(record.offset_minutes);
  const h = String(Math.floor(absM / 60)).padStart(2, "0");
  const m = String(absM % 60).padStart(2, "0");
  const offsetStr = `${sign}${h}:${m}`;

  return `${year}-${month}-${day} ${hour}:${minute}:${second} ${tzShort} (UTC${offsetStr})`;
}

/**
 * Formats a duration in milliseconds to a clean human-readable representation.
 */
export function formatDuration(duration_ms: number): string {
  const prefix = duration_ms < 0 ? "-" : "";
  const abs = Math.abs(duration_ms);

  if (abs < 1000) {
    return `${prefix}${abs}ms`;
  }
  if (abs < 60_000) {
    return `${prefix}${(abs / 1000).toFixed(2)}s`;
  }
  if (abs < 3_600_000) {
    const mins = Math.floor(abs / 60_000);
    const secs = Math.floor((abs % 60_000) / 1000);
    return `${prefix}${mins}m ${secs}s`;
  }
  if (abs < 86_400_000) {
    const hours = Math.floor(abs / 3_600_000);
    const mins = Math.floor((abs % 3_600_000) / 60_000);
    const secs = Math.floor((abs % 60_000) / 1000);
    return `${prefix}${hours}h ${mins}m ${secs}s`;
  }
  const days = Math.floor(abs / 86_400_000);
  const hours = Math.floor((abs % 86_400_000) / 3_600_000);
  const mins = Math.floor((abs % 3_600_000) / 60_000);
  return `${prefix}${days}d ${hours}h ${mins}m`;
}
