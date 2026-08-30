import {
  listWatchdogs,
  loadWatchdogStore,
  renderAsciiWatchdogTable,
  type WatchdogRecord,
  type WatchdogStatus,
} from "../../../authority/watchdog/index.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { enforceLineLimit } from "../../formatters/index.ts";
import {
  assertFlags,
  boolFlag,
  integerFlag,
  textFlag,
  type CommandContext,
  type Flags,
} from "../../index.ts";

export const VALID_FILTER_STATUSES = new Set(["active", "stale", "terminated", "orphaned", "all"]);

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
