import { formatShortSha, formatDuration } from "./types.ts";
import { join } from "node:path";
import type {
  CharterStatus,
  HealthObservationSummary,
  IntegrityStatus,
  RuntimeStatus,
} from "./types.ts";
export function renderCharterLine(status: CharterStatus, sha: string | null): string {
  if (status === "ok" && sha) {
    const formattedSha = formatShortSha(sha);
    return `ok  ${formattedSha.padEnd(8)} (ok | DRIFTED | missing)`;
  }
  if (status === "DRIFTED") {
    return "DRIFTED     (ok | DRIFTED | missing)";
  }
  return "missing     (ok | DRIFTED | missing)";
}

export function renderRuntimeLine(status: RuntimeStatus, version: string | null): string {
  if (status === "ok" && version) {
    return `ok  ${version.padEnd(8)} (ok | drifted | unknown)`;
  }
  if (status === "drifted") {
    return "drifted     (ok | drifted | unknown)";
  }
  return "unknown     (ok | drifted | unknown)";
}

export function renderIntegrityLine(status: IntegrityStatus): string {
  if (status === "ok") {
    return "ok          (ok | repairable | FAILED)";
  }
  if (status === "repairable") {
    return "repairable  (ok | repairable | FAILED)";
  }
  return "FAILED      (ok | repairable | FAILED)";
}

export function renderGapLine(
  gapMs: number | null,
  armedMs: number | null,
  driverLatenessMs: number | null,
): string {
  if (gapMs === null || armedMs === null || driverLatenessMs === null) {
    return "unknown";
  }
  const gapStr = formatDuration(gapMs);
  const armedStr = formatDuration(armedMs);
  const is3xLate = gapMs > 3 * armedMs;
  if (is3xLate) {
    return `${gapStr} (armed ${armedStr}; driver late by ${formatDuration(driverLatenessMs)} [WARNING: > 3x armed interval])`;
  }
  if (Math.abs(driverLatenessMs) < 60_000) {
    return `${gapStr} (armed ${armedStr}; driver on time)`;
  }
  if (driverLatenessMs > 0) {
    return `${gapStr} (armed ${armedStr}; driver late by ${formatDuration(driverLatenessMs)})`;
  }
  return `${gapStr} (armed ${armedStr}; driver early by ${formatDuration(-driverLatenessMs)})`;
}

export function renderHealthLine(
  observations: readonly HealthObservationSummary[],
  ageMs: number | null,
): string {
  if (observations.length === 0) {
    return "unknown";
  }
  const parts = observations.map((obs) => `${obs.source} ${obs.count}`);
  const ageStr = ageMs !== null ? `(last run ${formatDuration(ageMs)} ago)` : "";
  return `${parts.join(" · ")}        ${ageStr}`.trimEnd();
}
