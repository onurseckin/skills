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
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  listWatchdogs,
  loadWatchdogStore,
  parseTimestamp,
  renderAsciiWatchdogTable,
  terminatePhaseWatchdogs,
  verifyWatchdogLifecycle,
  type WatchdogStatus,
} from "../../authority/watchdog-manager.ts";
import { loadRun } from "../../store/index.ts";
import { runDoctor } from "../../reporting/doctor.ts";
import {
  auditSupervisory5PointHealth,
  dispatchSupervisoryHealthProbe,
  type Supervisory5PointHealthReport,
} from "../../scheduler/core-engine.ts";

function parseFilterStatus(raw?: string): WatchdogStatus | "all" | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase().trim();
  if (
    normalized === "active" ||
    normalized === "stale" ||
    normalized === "terminated" ||
    normalized === "orphaned" ||
    normalized === "all"
  ) {
    return normalized as WatchdogStatus | "all";
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `--filter-status must be active, stale, terminated, orphaned, or all; got '${raw}'`,
  );
}

function parseMarkAs(raw?: string): "stale" | "terminated" | "orphaned" | undefined {
  if (raw === undefined) return undefined;
  const normalized = raw.toLowerCase().trim();
  if (normalized === "stale" || normalized === "terminated" || normalized === "orphaned") {
    return normalized as "stale" | "terminated" | "orphaned";
  }
  throw new HarnessError(
    "INVALID_ARGUMENT",
    `--mark-as must be stale, terminated, or orphaned; got '${raw}'`,
  );
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
  const generation = integerFlag(flags, "generation", { minimum: 1 });
  const pulseId = textFlag(flags, "pulse-id", false);
  const phase = textFlag(flags, "phase", false);
  const filterStatusRaw = textFlag(flags, "filter-status", false);
  const maxAgeMs = integerFlag(flags, "max-age-ms", { minimum: 0 });
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const store = loadWatchdogStore(target);
  const filterStatus = parseFilterStatus(filterStatusRaw);
  const nowMs = parseTimestamp(nowRaw);

  const filteredWatchdogs = listWatchdogs(
    {
      generation,
      pulse_id: pulseId,
      phase,
      status: filterStatus,
      max_age_ms: maxAgeMs,
      now: nowMs,
    },
    target,
  );

  const allWatchdogs = store.watchdogs;
  let activeCount = 0;
  let staleCount = 0;
  let terminatedCount = 0;
  let orphanedCount = 0;
  const byGeneration: Record<string, number> = {};

  for (const wd of allWatchdogs) {
    if (wd.status === "active") activeCount++;
    else if (wd.status === "stale") staleCount++;
    else if (wd.status === "terminated") terminatedCount++;
    else if (wd.status === "orphaned") orphanedCount++;

    const genKey = `gen-${wd.generation}`;
    byGeneration[genKey] = (byGeneration[genKey] ?? 0) + 1;
  }

  const lines: string[] = [
    "### Watchdog Lifecycle & Cadence Status",
    `- **Capsules / Target Root**: \`${target !== undefined ? target : "default (.capsules/)"}\``,
    `- **Total Registered Monitors**: ${allWatchdogs.length} (${filteredWatchdogs.length} matching filter)`,
    `- **Status Breakdown**: Active: ${activeCount} | Stale: ${staleCount} | Terminated: ${terminatedCount} | Orphaned: ${orphanedCount}`,
    `- **Accumulation Invariant**: Max 1 active monitor per generation/pulse strictly enforced`,
  ];

  if (generation !== undefined) {
    lines.push(`- **Generation Filter**: Generation ${generation}`);
  }
  if (pulseId !== undefined) {
    lines.push(`- **Pulse Filter**: \`${pulseId}\``);
  }
  if (phase !== undefined) {
    lines.push(`- **Phase Filter**: \`${phase}\``);
  }

  lines.push("");
  lines.push("#### Active & Historical Watchdogs");
  lines.push(renderAsciiWatchdogTable(filteredWatchdogs, { now: nowMs }));

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    watchdogs: filteredWatchdogs,
    summary: {
      total: allWatchdogs.length,
      filtered_count: filteredWatchdogs.length,
      active_count: activeCount,
      stale_count: staleCount,
      terminated_count: terminatedCount,
      orphaned_count: orphanedCount,
      by_generation: byGeneration,
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
    "json",
    "now",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const generation = integerFlag(flags, "generation", { minimum: 1 });
  const pulseId = textFlag(flags, "pulse-id", false);
  const phase = textFlag(flags, "phase", false);
  const maxAgeMs = integerFlag(flags, "max-age-ms", { minimum: 0 });
  const markAsRaw = textFlag(flags, "mark-as", false);
  const reason = textFlag(flags, "reason", false);
  const isDryRun = boolFlag(flags, "dry-run");
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const nowMs = parseTimestamp(nowRaw);
  const markAs = parseMarkAs(markAsRaw);

  if (phase !== undefined) {
    // Phase-directed cleanup
    const result = terminatePhaseWatchdogs(
      {
        phase,
        generation,
        pulse_id: pulseId,
        dryRun: isDryRun,
        now: nowMs,
        markAs: markAs ?? "terminated",
        reason: reason ?? `cleanup_phase_${phase}`,
      },
      target,
    );

    const lines: string[] = [
      "### Watchdog Phase Cleanup Engine",
      `- **Target Root**: \`${target !== undefined ? target : "default (.capsules/)"}\``,
      `- **Execution Mode**: ${isDryRun ? "Dry Run (Simulated)" : "Live Cleanup"}`,
      `- **Target Phase**: \`${phase}\``,
      `- **Terminated Monitors**: ${result.terminatedCount}`,
      `- **Remaining Active Monitors**: ${result.activeCount}`,
      `- **Total Tracked Monitors**: ${result.totalCount}`,
    ];

    if (generation !== undefined) {
      lines.push(`- **Generation Target**: Generation ${generation}`);
    }

    lines.push("");
    lines.push("#### Cleaned / Terminated Watchdogs");
    lines.push(renderAsciiWatchdogTable(result.terminatedWatchdogs, { now: nowMs }));

    const maxLines = isAll ? 500 : 35;
    const markdown = enforceLineLimit(lines.join("\n"), maxLines);

    return {
      markdown,
      cleaned_count: result.terminatedCount,
      cleaned_watchdogs: result.terminatedWatchdogs,
      remaining_active: result.activeCount,
      total_monitors: result.totalCount,
      dry_run: result.dryRun,
      phase,
      run_root: run ?? null,
      capsules_dir: capsulesDir ?? null,
    };
  }

  // Stale monitor cleanup
  const result = cleanupStaleWatchdogs(
    {
      generation,
      maxAgeMs,
      dryRun: isDryRun,
      now: nowMs,
      markAs: markAs ?? "stale",
      reason: reason ?? "stale_cadence_exceeded",
    },
    target,
  );

  const lines: string[] = [
    "### Watchdog Stale Cleanup Engine",
    `- **Target Root**: \`${target !== undefined ? target : "default (.capsules/)"}\``,
    `- **Execution Mode**: ${isDryRun ? "Dry Run (Simulated)" : "Live Cleanup"}`,
    `- **Stale Monitors Cleaned**: ${result.cleanedCount}`,
    `- **Remaining Active Monitors**: ${result.activeCount}`,
    `- **Total Tracked Monitors**: ${result.totalCount}`,
  ];

  if (generation !== undefined) {
    lines.push(`- **Generation Target**: Generation ${generation}`);
  }

  lines.push("");
  if (result.cleanedCount > 0) {
    lines.push("#### Cleaned Watchdogs");
    lines.push(renderAsciiWatchdogTable(result.cleanedWatchdogs, { now: nowMs }));
  } else {
    lines.push("#### Cleaned Watchdogs");
    lines.push(renderAsciiWatchdogTable([], { now: nowMs }));
  }

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    cleaned_count: result.cleanedCount,
    cleaned_watchdogs: result.cleanedWatchdogs,
    remaining_active: result.activeCount,
    total_monitors: result.totalCount,
    dry_run: result.dryRun,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

export function watchdogPhaseCleanupCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
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
    "json",
    "now",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const phase = textFlag(flags, "phase", false);
  const currentPhase = textFlag(flags, "current-phase", false);
  const generation = integerFlag(flags, "generation", { minimum: 1 });
  const pulseId = textFlag(flags, "pulse-id", false);
  const excludeId = textFlag(flags, "exclude-id", false);
  const reason = textFlag(flags, "reason", false);
  const markAsRaw = textFlag(flags, "mark-as", false);
  const isDryRun = boolFlag(flags, "dry-run");
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const nowMs = parseTimestamp(nowRaw);
  const markAs = parseMarkAs(markAsRaw);

  const result =
    currentPhase !== undefined
      ? cleanupPreviousPhaseWatchdogs(
          {
            currentPhase,
            generation,
            pulse_id: pulseId,
            currentWatchdogId: excludeId,
            reason,
            markAs,
            dryRun: isDryRun,
            now: nowMs,
          },
          target,
        )
      : terminatePhaseWatchdogs(
          {
            phase,
            generation,
            pulse_id: pulseId,
            excludeId,
            reason,
            markAs,
            dryRun: isDryRun,
            now: nowMs,
          },
          target,
        );

  const lines: string[] = [
    "### Watchdog Automatic Phase Cleanup Engine",
    `- **Target Root**: \`${target !== undefined ? target : "default (.capsules/)"}\``,
    `- **Execution Mode**: ${isDryRun ? "Dry Run (Simulated)" : "Live Cleanup"}`,
    `- **Terminated Phase Monitors**: ${result.terminatedCount}`,
    `- **Remaining Active Monitors**: ${result.activeCount}`,
    `- **Total Tracked Monitors**: ${result.totalCount}`,
  ];

  if (currentPhase !== undefined) {
    lines.push(`- **Rollover Target Phase**: \`${currentPhase}\` (prior phases terminated)`);
  } else if (phase !== undefined) {
    lines.push(`- **Target Phase Terminated**: \`${phase}\``);
  }
  if (generation !== undefined) {
    lines.push(`- **Generation Target**: Generation ${generation}`);
  }
  if (pulseId !== undefined) {
    lines.push(`- **Pulse Target**: \`${pulseId}\``);
  }

  lines.push("");
  lines.push("#### Terminated Watchdogs");
  lines.push(renderAsciiWatchdogTable(result.terminatedWatchdogs, { now: nowMs }));

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    terminated_count: result.terminatedCount,
    terminated_watchdogs: result.terminatedWatchdogs,
    remaining_active: result.activeCount,
    total_monitors: result.totalCount,
    dry_run: result.dryRun,
    phase: phase ?? null,
    current_phase: currentPhase ?? null,
    generation: generation ?? null,
    pulse_id: pulseId ?? null,
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
    "json",
    "now",
  ];
  assertFlags(flags, allowedFlags);

  const run = textFlag(flags, "run", false);
  const capsulesDir = textFlag(flags, "capsules-dir", false);
  const generation = integerFlag(flags, "generation", { minimum: 1 });
  const pulseId = textFlag(flags, "pulse-id", false);
  const phase = textFlag(flags, "phase", false);
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const nowMs = parseTimestamp(nowRaw);

  const result = verifyWatchdogLifecycle(
    {
      generation,
      pulse_id: pulseId,
      phase,
      now: nowMs,
    },
    target,
  );

  const lines: string[] = [
    "### Watchdog Lifecycle Invariant Verification",
    `- **Target Root**: \`${target !== undefined ? target : "default (.capsules/)"}\``,
    `- **Verification Status**: ${result.valid ? "PASSED ✅ (All Lifecycle Invariants Upheld)" : "FAILED ❌ (Violations Detected)"}`,
    `- **Total Monitors Inspected**: ${result.totalCount} (Active: ${result.activeCount}, Stale: ${result.staleCount}, Terminated: ${result.terminatedCount}, Orphaned: ${result.orphanedCount})`,
    `- **Invariant Rule**: Max 1 active monitor per generation/pulse strictly enforced`,
  ];

  if (generation !== undefined) {
    lines.push(`- **Generation Scope**: Generation ${generation}`);
  }
  if (pulseId !== undefined) {
    lines.push(`- **Pulse Scope**: \`${pulseId}\``);
  }
  if (phase !== undefined) {
    lines.push(`- **Phase Scope**: \`${phase}\``);
  }

  if (result.violations.length > 0) {
    lines.push("");
    lines.push("#### Invariant Violations");
    for (const v of result.violations) {
      lines.push(`- ⚠️ ${v}`);
    }
  }

  lines.push("");
  lines.push("#### Tracked Watchdogs");
  lines.push(renderAsciiWatchdogTable(result.watchdogs, { now: nowMs }));

  const maxLines = isAll ? 500 : 35;
  const markdown = enforceLineLimit(lines.join("\n"), maxLines);

  return {
    markdown,
    valid: result.valid,
    violations: result.violations,
    violation_details: result.violationDetails,
    summary: {
      total: result.totalCount,
      active_count: result.activeCount,
      stale_count: result.staleCount,
      terminated_count: result.terminatedCount,
      orphaned_count: result.orphanedCount,
    },
    watchdogs: result.watchdogs,
    run_root: run ?? null,
    capsules_dir: capsulesDir ?? null,
  };
}

/**
 * CLI Command: watchdog:probe
 * Runs `bun harness.ts doctor` and dispatches active 5-point supervisory health probe to the top leader.
 */
export async function watchdogProbeCommand(
  flags: Flags,
  _context?: CommandContext,
): Promise<Record<string, unknown>> {
  const allowedFlags = [
    "run",
    "capsules-dir",
    "generation",
    "pulse-id",
    "now",
    "all",
    "json",
  ];
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
