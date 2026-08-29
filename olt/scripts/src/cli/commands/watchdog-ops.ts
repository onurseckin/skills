import { HarnessError } from "../../core/errors/index.ts";
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
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  listWatchdogs,
  loadWatchdogStore,
  parseTimestamp,
  renderAsciiWatchdogTable,
  terminatePhaseWatchdogs,
  verifyWatchdogLifecycle,
  type WatchdogRecord,
  type WatchdogStatus,
} from "../../authority/watchdog/index.ts";
import { loadRun } from "../../engine/store/index.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import {
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  type Supervisory5PointHealthReport,
} from "../../engine/scheduler/index.ts";

const VALID_FILTER_STATUSES = new Set(["active", "stale", "terminated", "orphaned", "all"]);

function boundedEvidenceCause(error: unknown): string {
  if (typeof error === "string") return error.slice(0, 240);
  if (
    typeof error === "number" ||
    typeof error === "boolean" ||
    typeof error === "bigint" ||
    typeof error === "symbol" ||
    error === null ||
    error === undefined
  ) {
    return String(error).slice(0, 240);
  }
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, "message");
    if (descriptor && "value" in descriptor && typeof descriptor.value === "string") {
      return descriptor.value.slice(0, 240);
    }
  } catch {}
  return "unknown error";
}

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
  const nowRaw = textFlag(flags, "now", false);
  const filterStatusRaw = textFlag(flags, "filter-status", false);

  if (filterStatusRaw !== undefined) {
    const norm = filterStatusRaw.trim().toLowerCase();
    if (!VALID_FILTER_STATUSES.has(norm)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `invalid filter-status: '${filterStatusRaw}'. Expected one of: active, stale, terminated, orphaned, all`,
      );
    }
  }

  const target = run ?? capsulesDir;
  const store = loadWatchdogStore(target);

  const genVal = integerFlag(flags, "generation");
  const pulseIdVal = textFlag(flags, "pulse-id", false);
  const phaseVal = textFlag(flags, "phase", false);
  const statusFilter: WatchdogStatus | undefined =
    filterStatusRaw && filterStatusRaw.toLowerCase() !== "all"
      ? (filterStatusRaw.toLowerCase() as WatchdogStatus)
      : undefined;

  const filteredWatchdogs = listWatchdogs(
    {
      generation: genVal,
      pulse_id: pulseIdVal,
      phase: phaseVal,
      status: statusFilter,
    },
    target,
  );

  const byGen: Record<string, number> = {};
  for (const w of store.watchdogs) {
    const key = `gen-${w.generation}`;
    byGen[key] = (byGen[key] ?? 0) + 1;
  }

  const activeCount = store.watchdogs.filter((w) => w.status === "active").length;
  const totalCount = store.watchdogs.length;

  const lines: string[] = [
    "### Watchdog Lifecycle & Cadence Status",
    `- **Capsules / Target Root**: \`${target !== undefined ? target : "default (.olt/capsules/)"}\``,
    `- **Total Registered Monitors**: ${totalCount} (${filteredWatchdogs.length} matching filter)`,
    `- **Status Breakdown**: Active: ${activeCount} | Terminated/None: ${totalCount - activeCount}`,
    "",
    renderAsciiWatchdogTable(filteredWatchdogs, nowRaw !== undefined ? { now: nowRaw } : undefined),
  ];

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    watchdogs: filteredWatchdogs,
    summary: {
      total: totalCount,
      active_count: activeCount,
      filtered_count: filteredWatchdogs.length,
      by_generation: byGen,
    },
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

export function watchdogCleanupCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "authority-run",
    "actor",
    "run",
    "capsules-dir",
    "generation",
    "pulse-id",
    "phase",
    "max-age-ms",
    "mark-as",
    "reason",
    "dry-run",
    "all",
    "now",
    "json",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);
  const phase = textFlag(flags, "phase", false);
  const dryRun = boolFlag(flags, "dry-run");
  const genVal = integerFlag(flags, "generation");
  const pulseIdVal = textFlag(flags, "pulse-id", false);
  const maxAgeMs = integerFlag(flags, "max-age-ms");
  const markAs = textFlag(flags, "mark-as", false) as WatchdogStatus | undefined;
  const reason = textFlag(flags, "reason", false);

  const target = run ?? capsulesDir;

  if (phase !== undefined) {
    const res = terminatePhaseWatchdogs(
      {
        phase,
        generation: genVal,
        pulse_id: pulseIdVal,
        dryRun,
        now: nowRaw,
        reason,
      },
      target,
    );

    const lines: string[] = [
      "### Watchdog Phase Cleanup Engine",
      `- **Target Phase**: \`${phase}\``,
      `- **Terminated Count**: ${res.terminatedCount}`,
      `- **Remaining Active**: ${res.activeCount}`,
      `- **Dry Run**: ${dryRun ? "true" : "false"}`,
    ];

    const maxLines = isAll ? 500 : 35;
    const markdown = enforceLineLimit(lines.join("\n"), maxLines);

    return {
      markdown,
      cleaned_count: res.terminatedCount,
      remaining_active: res.activeCount,
      dry_run: res.dryRun,
      phase,
      terminated_watchdogs: res.terminatedWatchdogs,
      run_root: run ?? null,
      capsules_dir: capsulesDir ?? null,
    };
  }

  const res = cleanupStaleWatchdogs(
    {
      now: nowRaw,
      maxAgeMs,
      markAs,
      dryRun,
      reason,
    },
    target,
  );

  const lines: string[] = [
    `### Watchdog Stale Cleanup Engine${dryRun ? " - Dry Run (Simulated)" : ""}`,
    `- **Cleaned Count**: ${res.cleanedCount}`,
    `- **Remaining Active**: ${res.activeCount}`,
    `- **Dry Run**: ${dryRun ? "true" : "false"}`,
  ];

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    cleaned_count: res.cleanedCount,
    remaining_active: res.activeCount,
    dry_run: res.dryRun,
    cleaned_watchdogs: res.cleanedWatchdogs,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

export function watchdogPhaseCleanupCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "authority-run",
    "actor",
    "run",
    "capsules-dir",
    "phase",
    "current-phase",
    "generation",
    "pulse-id",
    "exclude-id",
    "reason",
    "mark-as",
    "dry-run",
    "all",
    "now",
    "json",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);
  const phase = textFlag(flags, "phase", false);
  const currentPhase = textFlag(flags, "current-phase", false);
  const dryRun = boolFlag(flags, "dry-run");
  const genVal = integerFlag(flags, "generation");
  const pulseIdVal = textFlag(flags, "pulse-id", false);
  const excludeId = textFlag(flags, "exclude-id", false);
  const reason = textFlag(flags, "reason", false);

  const target = run ?? capsulesDir;

  if (currentPhase !== undefined) {
    const res = cleanupPreviousPhaseWatchdogs(
      {
        currentPhase,
        generation: genVal,
        pulse_id: pulseIdVal,
        excludeId,
        dryRun,
        now: nowRaw,
      },
      target,
    );

    const lines: string[] = [
      "### Watchdog Automatic Phase Cleanup Engine",
      `- **Current Rollover Phase**: \`${currentPhase}\``,
      `- **Terminated Prior Monitors**: ${res.terminatedCount}`,
      `- **Remaining Active**: ${res.activeCount}`,
      `- **Dry Run**: ${dryRun ? "true" : "false"}`,
    ];

    const maxLines = isAll ? 500 : 35;
    const markdown = enforceLineLimit(lines.join("\n"), maxLines);

    return {
      markdown,
      terminated_count: res.terminatedCount,
      remaining_active: res.activeCount,
      dry_run: res.dryRun,
      current_phase: currentPhase,
      terminated_watchdogs: res.terminatedWatchdogs,
      run_root: run ?? null,
      capsules_dir: capsulesDir ?? null,
    };
  }

  const targetPhase = phase ?? "default";
  const res = terminatePhaseWatchdogs(
    {
      phase: targetPhase,
      generation: genVal,
      pulse_id: pulseIdVal,
      excludeId,
      reason,
      dryRun,
      now: nowRaw,
    },
    target,
  );

  const lines: string[] = [
    "### Watchdog Automatic Phase Cleanup Engine",
    `- **Target Phase**: \`${targetPhase}\``,
    `- **Terminated Count**: ${res.terminatedCount}`,
    `- **Remaining Active**: ${res.activeCount}`,
    `- **Dry Run**: ${dryRun ? "true" : "false"}`,
  ];

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    terminated_count: res.terminatedCount,
    remaining_active: res.activeCount,
    dry_run: res.dryRun,
    phase: targetPhase,
    terminated_watchdogs: res.terminatedWatchdogs,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

export function watchdogVerifyCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "run",
    "capsules-dir",
    "generation",
    "pulse-id",
    "phase",
    "all",
    "now",
    "json",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);
  const genVal = integerFlag(flags, "generation");

  const target = run ?? capsulesDir;
  const res = verifyWatchdogLifecycle(nowRaw !== undefined ? { now: nowRaw } : undefined, target);

  let filteredViolations = res.violations;
  if (genVal !== undefined) {
    const store = loadWatchdogStore(target);
    const genWatchdogs = new Set(
      store.watchdogs.filter((w) => w.generation === genVal).map((w) => w.id),
    );
    filteredViolations = res.violationDetails
      .filter((v) => !v.watchdog_id || genWatchdogs.has(v.watchdog_id))
      .map((v) => v.message);
  }

  const isValid = filteredViolations.length === 0;

  const lines: string[] = [
    `### Watchdog Lifecycle Verification: ${isValid ? "PASSED ✅" : "FAILED ❌"}`,
    `- **Target Root**: \`${target !== undefined ? target : "default"}\``,
    `- **Active Monitors**: ${res.activeCount}`,
    `- **Total Records**: ${res.totalCount}`,
    `- **Violations Count**: ${filteredViolations.length}`,
  ];

  if (filteredViolations.length > 0) {
    lines.push("");
    lines.push("#### Invariant Violations:");
    for (const v of filteredViolations) {
      lines.push(`- ⚠️ ${v}`);
    }
  }

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    valid: isValid,
    violations: filteredViolations,
    violation_details: res.violationDetails,
    active_count: res.activeCount,
    total_count: res.totalCount,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
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
    } catch (error) {
      throw new HarnessError(
        "INTEGRITY",
        `watchdog probe cannot load supervisory evidence for ${run}: ${boundedEvidenceCause(error)}`,
      );
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
