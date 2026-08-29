import { HarnessError } from "../errors/harness-error.ts";
import { DualTimeRecord, isDualTimeRecord } from "./contracts.ts";

function resolveDate(dateOrMs?: Date | number | string | DualTimeRecord): Date {
  if (dateOrMs === undefined) {
    return new Date();
  }
  if (typeof dateOrMs === "number") {
    if (!Number.isFinite(dateOrMs)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${dateOrMs}`);
    }
    const date = new Date(dateOrMs);
    if (isNaN(date.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${dateOrMs}`);
    }
    return date;
  }
  if (typeof dateOrMs === "string") {
    const date = new Date(dateOrMs);
    if (isNaN(date.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid date string: ${dateOrMs}`);
    }
    return date;
  }
  if (dateOrMs instanceof Date) {
    if (isNaN(dateOrMs.getTime())) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid Date object");
    }
    return dateOrMs;
  }
  if (typeof dateOrMs === "object" && dateOrMs !== null) {
    if (typeof dateOrMs.timestamp_ms === "number" && Number.isFinite(dateOrMs.timestamp_ms)) {
      const date = new Date(dateOrMs.timestamp_ms);
      if (!isNaN(date.getTime())) return date;
    }
    if (typeof dateOrMs.utc === "string") {
      const date = new Date(dateOrMs.utc);
      if (!isNaN(date.getTime())) return date;
    }
  }
  throw new HarnessError("INVALID_ARGUMENT", `Cannot extract date from value: ${String(dateOrMs)}`);
}

export function extractTimestampMs(value: DualTimeRecord | string | number | Date): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid timestamp number: ${value}`);
    }
    return value;
  }
  if (value instanceof Date) {
    const ms = value.getTime();
    if (isNaN(ms)) {
      throw new HarnessError("INVALID_ARGUMENT", "Invalid Date object");
    }
    return ms;
  }
  if (typeof value === "string") {
    const ms = new Date(value).getTime();
    if (isNaN(ms)) {
      throw new HarnessError("INVALID_ARGUMENT", `Invalid date string: ${value}`);
    }
    return ms;
  }
  if (typeof value === "object" && value !== null) {
    if (typeof value.timestamp_ms === "number" && Number.isFinite(value.timestamp_ms)) {
      return value.timestamp_ms;
    }
    if (typeof value.utc === "string") {
      const ms = new Date(value.utc).getTime();
      if (!isNaN(ms)) return ms;
    }
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `Cannot extract timestamp from value: ${String(value)}`,
  );
}

function extractDualTimeParts(
  date: Date,
  timezone: string,
): { local: string; offset_minutes: number; timezone: string } {
  let parts: Intl.DateTimeFormatPart[];
  let offsetParts: Intl.DateTimeFormatPart[];

  try {
    parts = Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      fractionalSecondDigits: 3,
      hourCycle: "h23",
    }).formatToParts(date);

    offsetParts = Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      timeZoneName: "longOffset",
    }).formatToParts(date);
  } catch (error) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Invalid timezone: ${timezone} (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const found = parts.find((p) => p.type === type);
    return found ? found.value : "00";
  };

  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = get("hour");
  const minute = get("minute");
  const second = get("second");
  const frac = get("fractionalSecond");
  const fractionalSecond = (frac && frac.length > 0 ? frac : "000").padEnd(3, "0");

  const offsetPart = offsetParts.find((p) => p.type === "timeZoneName");
  const offsetRaw = offsetPart ? offsetPart.value : "GMT+00:00";
  let offsetStr = "+00:00";
  let offsetMinutes = 0;

  const offsetMatch = offsetRaw.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
  if (offsetMatch && offsetMatch[1] && offsetMatch[2]) {
    const sign = offsetMatch[1] === "-" ? -1 : 1;
    const hours = parseInt(offsetMatch[2], 10);
    const mins = offsetMatch[3] ? parseInt(offsetMatch[3], 10) : 0;
    offsetMinutes = sign * (hours * 60 + mins);
    const formattedHours = String(hours).padStart(2, "0");
    const formattedMins = String(mins).padStart(2, "0");
    offsetStr = `${offsetMatch[1]}${formattedHours}:${formattedMins}`;
  }

  const local = `${year}-${month}-${day}T${hour}:${minute}:${second}.${fractionalSecond}${offsetStr}`;

  return {
    local,
    offset_minutes: offsetMinutes,
    timezone,
  };
}

/**
 * Returns a DualTimeRecord for the given date/timestamp, containing UTC ISO string,
 * local ISO string with offset, timezone name, signed offset in minutes, and epoch ms.
 */
export function getDualTime(
  dateOrMs?: Date | number | string | DualTimeRecord,
  timezone?: string,
): DualTimeRecord {
  const date = resolveDate(dateOrMs);
  const detectedTz =
    typeof Intl !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : "";
  const targetTimezone = timezone ? timezone : detectedTz ? detectedTz : "UTC";

  // If input is already a valid DualTimeRecord and timezone matches or was not specified, reuse
  if (
    typeof dateOrMs === "object" &&
    dateOrMs !== null &&
    !(dateOrMs instanceof Date) &&
    isDualTimeRecord(dateOrMs) &&
    (timezone === undefined || dateOrMs.timezone === timezone)
  ) {
    return { ...dateOrMs };
  }

  const {
    local,
    offset_minutes,
    timezone: resolvedTz,
  } = extractDualTimeParts(date, targetTimezone);

  return {
    utc: date.toISOString(),
    local,
    timezone: resolvedTz,
    offset_minutes,
    timestamp_ms: date.getTime(),
  };
}
