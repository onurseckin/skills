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
  cleanupStaleWatchdogs,
  listWatchdogs,
  loadWatchdogStore,
  parseTimestamp,
  renderAsciiWatchdogTable,
  type WatchdogStatus,
} from "../../authority/watchdog-manager.ts";

export function watchdogStatusCommand(
  flags: Flags,
  _context?: CommandContext,
): Record<string, unknown> {
  const allowedFlags = [
    "run",
    "capsules-dir",
    "generation",
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
  const filterStatusRaw = textFlag(flags, "filter-status", false);
  const maxAgeMs = integerFlag(flags, "max-age-ms", { minimum: 0 });
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const store = loadWatchdogStore(target);

  let filterStatus: WatchdogStatus | "all" | undefined = undefined;
  if (filterStatusRaw !== undefined) {
    const normalized = filterStatusRaw.toLowerCase().trim();
    if (
      normalized === "active" ||
      normalized === "stale" ||
      normalized === "terminated" ||
      normalized === "orphaned" ||
      normalized === "all"
    ) {
      filterStatus = normalized as WatchdogStatus | "all";
    } else {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `--filter-status must be active, stale, terminated, orphaned, or all; got '${filterStatusRaw}'`,
      );
    }
  }

  const nowMs = parseTimestamp(nowRaw);

  const filteredWatchdogs = listWatchdogs(
    {
      generation,
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
  const maxAgeMs = integerFlag(flags, "max-age-ms", { minimum: 0 });
  const isDryRun = boolFlag(flags, "dry-run");
  const isAll = boolFlag(flags, "all");
  const nowRaw = textFlag(flags, "now", false);

  const target = run ?? capsulesDir;
  const nowMs = parseTimestamp(nowRaw);

  const result = cleanupStaleWatchdogs(
    {
      generation,
      maxAgeMs,
      dryRun: isDryRun,
      now: nowMs,
      markAs: "stale",
      reason: "stale_cadence_exceeded",
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
