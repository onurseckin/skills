import { loadWatchdogStore, parseTimestamp, timestampMilliseconds } from "./store.ts";
import type { VerifyWatchdogResult, WatchdogRecord, WatchdogViolation } from "./types.ts";

export function verifyWatchdogLifecycle(
  options: { now?: string | number | Date } = {},
  target?: string,
): VerifyWatchdogResult {
  const nowMs = parseTimestamp(options.now);
  const store = loadWatchdogStore(target);

  const violations: string[] = [];
  const violationDetails: WatchdogViolation[] = [];

  const activeByGen = new Map<number, WatchdogRecord[]>();
  const activeByPulse = new Map<string, WatchdogRecord[]>();

  for (const w of store.watchdogs) {
    if (w.status === "active") {
      const genList = activeByGen.get(w.generation) ?? [];
      genList.push(w);
      activeByGen.set(w.generation, genList);

      if (w.pulse_id) {
        const pulseList = activeByPulse.get(w.pulse_id) ?? [];
        pulseList.push(w);
        activeByPulse.set(w.pulse_id, pulseList);
      }

      const lastHbMs = timestampMilliseconds(w.last_heartbeat_at, "last_heartbeat_at");
      if (nowMs - lastHbMs > w.timeout_ms) {
        const diff = nowMs - lastHbMs;
        const msg = `Watchdog '${w.id}' heartbeat is overdue by ${diff}ms (timeout: ${w.timeout_ms}ms)`;
        violations.push(msg);
        violationDetails.push({
          rule: "heartbeat_timeout_exceeded",
          message: msg,
          watchdog_id: w.id,
        });
      }
    }
  }

  for (const [gen, list] of activeByGen.entries()) {
    if (list.length > 1) {
      const msg = `Multiple active watchdogs found in generation ${gen}: ${list.map((w) => w.id).join(", ")}`;
      violations.push(msg);
      violationDetails.push({
        rule: "single_active_per_generation",
        message: msg,
      });
    }
  }

  for (const [pulse, list] of activeByPulse.entries()) {
    if (list.length > 1) {
      const msg = `Multiple active watchdogs found for pulse '${pulse}': ${list.map((w) => w.id).join(", ")}`;
      violations.push(msg);
      violationDetails.push({
        rule: "single_active_per_pulse",
        message: msg,
      });
    }
  }

  const activeCount = store.watchdogs.filter((w) => w.status === "active").length;

  return {
    valid: violations.length === 0,
    violations,
    violationDetails,
    activeCount,
    totalCount: store.watchdogs.length,
  };
}

export function renderAsciiWatchdogTable(
  records: readonly WatchdogRecord[],
  _options: { now?: string | number | Date } = {},
): string {
  if (records.length === 0) {
    return [
      "┌─────────────────────────────────────────────────────────────────────────────┐",
      "│ No registered watchdog monitors found matching criteria                     │",
      "└─────────────────────────────────────────────────────────────────────────────┘",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push(
    "┌───────────────────────────┬─────────────┬────────────────┬──────────────┬────────┐",
  );
  lines.push(
    "│ Watchdog ID               │ Gen / Pulse │ Phase          │ Status       │ PID    │",
  );
  lines.push(
    "├───────────────────────────┼─────────────┼────────────────┼──────────────┼────────┤",
  );

  for (const w of records) {
    const idPad = w.id.padEnd(25).slice(0, 25);
    const genPulse = `g${w.generation}${w.pulse_id ? "/" + w.pulse_id : ""}`
      .padEnd(11)
      .slice(0, 11);
    const phasePad = w.phase.padEnd(14).slice(0, 14);
    const statusGlyph =
      w.status === "active"
        ? "[ACTIVE 🟢]"
        : w.status === "stale"
          ? "[STALE ⚠️]"
          : w.status === "terminated"
            ? "[TERMINATED ⏹️]"
            : "[ORPHANED ❌]";
    const statusPad = statusGlyph.padEnd(12);
    const pidPad = String(w.pid).padEnd(6).slice(0, 6);
    const cadenceSec = `${Math.round(w.heartbeat_cadence_ms / 1000)}s`;

    lines.push(`│ ${idPad} │ ${genPulse} │ ${phasePad} │ ${statusPad} │ ${pidPad} │`);
    lines.push(
      `│   Cadence: ${cadenceSec.padEnd(6)} | Timeout: ${Math.round(w.timeout_ms / 1000)}s                                      │`,
    );
  }

  lines.push(
    "└───────────────────────────┴─────────────┴────────────────┴──────────────┴────────┘",
  );
  return lines.join("\n");
}
