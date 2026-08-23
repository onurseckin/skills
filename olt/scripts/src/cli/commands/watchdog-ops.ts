import { HarnessError } from "../../errors/harness-error.ts";
import { enforceLineLimit } from "../formatters/line-limiter.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../options.ts";
import {
  loadWatchdogStore,
  parseTimestamp,
  type WatchdogStatus,
} from "../../authority/watchdog-manager.ts";
import { loadRun } from "../../store/index.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import {
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  type Supervisory5PointHealthReport,
} from "../../scheduler/core-engine.ts";

export function watchdogStatusCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "run",
    "capsules-dir",
    "generation",
    "pulse-id",
    "phase",
    "filter-status",
    "max-age-ms",
    "dry-run",
    "all",
    "json",
    "now",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");

  const target = run ?? capsulesDir;
  const store = loadWatchdogStore(target);

  const activeWd = store.active_watchdog;

  const lines: string[] = [
    "### Watchdog Lifecycle & Cadence Status",
    `- **Capsules / Target Root**: \`${target !== undefined ? target : "default (.olt/capsules/)"}\``,
    `- **Status Breakdown**: Active: ${activeWd ? 1 : 0} | Terminated/None: ${activeWd ? 0 : 1}`,
  ];

  if (activeWd) {
    lines.push("");
    lines.push("#### Active Watchdog");
    lines.push(`- **ID**: ${activeWd.id}`);
    lines.push(`- **Generation**: ${activeWd.generation}`);
    lines.push(`- **Phase**: ${activeWd.phase}`);
    lines.push(`- **Started At**: ${activeWd.started_at}`);
    lines.push(`- **Last Heartbeat**: ${activeWd.last_heartbeat_at}`);
  } else {
    lines.push("");
    lines.push("#### No Active Watchdog");
  }

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    watchdog: activeWd,
    summary: {
      active_count: activeWd ? 1 : 0,
    },
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

export function watchdogCleanupCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  // Purged legacy cleanup command
  return {
    markdown: "Legacy cleanup command purged.",
  };
}

export function watchdogPhaseCleanupCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  // Purged legacy cleanup command
  return {
    markdown: "Legacy phase cleanup command purged.",
  };
}

export function watchdogVerifyCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  // Purged legacy verify command
  return {
    markdown: "Legacy verify command purged.",
  };
}

export async function watchdogProbeCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const allowedFlags = ["run", "capsules-dir", "generation", "pulse-id", "now", "all", "json"];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const nowMs = parseTimestamp(nowRaw);

  let state: Record<string, unknown> = {};
  let doctorResult: Record<string, unknown> | undefined = undefined;

  if (run !== undefined) {
    try {
      const loaded = loadRun(run);
      state = loaded.state as Record<string, unknown>;
      doctorResult = await runDoctor(run);
    } catch {
      // Fallback
    }
  }

  const dispatchResult = dispatchSupervisoryHealthProbe(state, {
    runRoot: run,
    now: nowMs,
    doctorResult,
  });

  const maxLines = isAll ? 500 : 40;
  const markdown = enforceLineLimit(dispatchResult.markdown, maxLines);

  return {
    markdown,
    dispatched: dispatchResult.dispatched,
    target_agent_id: dispatchResult.targetAgentId,
    target_role: dispatchResult.targetRole,
    report: dispatchResult.report,
    prompt_for_leader: dispatchResult.promptForLeader,
    doctor: doctorResult ?? null,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}
