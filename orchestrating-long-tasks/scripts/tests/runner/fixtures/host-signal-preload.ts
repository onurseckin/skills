import { appendFileSync, closeSync, openSync, writeSync } from "node:fs";

const protectedPids = new Set<number>(
  JSON.parse(process.env.HARNESS_SENTINEL_PROTECTED_PIDS ?? "[]"),
);
const protectedGroups = new Set<number>(
  JSON.parse(process.env.HARNESS_SENTINEL_PROTECTED_GROUPS ?? "[]"),
);
const reportPath = process.env.HARNESS_SENTINEL_REPORT;
const markerPath = process.env.HARNESS_SENTINEL_PRELOAD_MARKER;
const originalKill = process.kill.bind(process);

if (!markerPath) throw new Error("host-safety sentinel preload marker path is missing");
const marker = openSync(markerPath, "wx", 0o600);
try {
  writeSync(marker, "loaded\n");
} finally {
  closeSync(marker);
}

function blocked(target: number): boolean {
  if (!Number.isSafeInteger(target) || target === 0 || target === -1) return true;
  return target > 0 ? protectedPids.has(target) : protectedGroups.has(-target);
}

process.kill = ((target: number, signal?: NodeJS.Signals | number): boolean => {
  const denied = blocked(target);
  const event = JSON.stringify({
    target,
    signal: signal ?? "SIGTERM",
    blocked: denied,
    at: new Date().toISOString(),
  });
  if (reportPath) appendFileSync(reportPath, `${event}\n`, { encoding: "utf8", mode: 0o600 });
  if (!denied) return originalKill(target, signal);
  throw new Error(
    `host-safety sentinel blocked signal ${String(signal ?? "SIGTERM")} to ${target}`,
  );
}) as typeof process.kill;
