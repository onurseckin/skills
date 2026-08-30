import {
  cleanupPreviousPhaseWatchdogs,
  cleanupStaleWatchdogs,
  terminatePhaseWatchdogs,
  type WatchdogStatus,
} from "../../../authority/watchdog/index.ts";
import { enforceLineLimit } from "../../formatters/index.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../../index.ts";

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
