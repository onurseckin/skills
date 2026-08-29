import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  formatDuration,
  formatSeq,
  type DynamicDagState,
  type StepTraceEntry,
  type StepTracerSummary,
} from "./types.ts";

export function renderAsciiTimeline(
  entries: readonly StepTraceEntry[],
  maxEntries?: number,
): string {
  if (entries.length === 0) {
    return "  ┌────────────────────────────────────────────────────────┐\n  │  (No telemetry events recorded for active step trace)  │\n  └────────────────────────────────────────────────────────┘";
  }

  const lines: string[] = [];
  const displayEntries =
    maxEntries !== undefined && maxEntries > 0 ? entries.slice(0, maxEntries) : entries;

  for (let i = 0; i < displayEntries.length; i++) {
    const entry = displayEntries[i];
    if (!entry) continue;
    const isLast = i === displayEntries.length - 1;
    const timeStr = formatDuration(entry.elapsedMs);
    const seqStr = formatSeq(entry.sequence);

    const connector = i === 0 ? "●" : isLast ? "└─●" : "├─●";
    const pipe = isLast ? "  " : "│ ";

    lines.push(
      `${connector} [${seqStr} +${timeStr}] [${entry.actor}] ${entry.glyph} ${entry.title}`,
    );

    for (const d of entry.details) {
      lines.push(`${pipe} ↳ ${d}`);
    }

    if (!isLast) {
      lines.push("│");
    }
  }

  if (displayEntries.length < entries.length) {
    lines.push(`... [${entries.length - displayEntries.length} more events truncated]`);
  }

  return lines.join("\n");
}

export function computeStepTracerSummary(
  entries: readonly StepTraceEntry[],
  dynamicDag: DynamicDagState,
): StepTracerSummary {
  const uniqueActors = [...new Set(entries.map((e) => e.actor))];
  const gateRuns = entries.filter((e) => e.isGate);
  const gateFails = gateRuns.filter((e) => e.isError);
  const gatePasses = gateRuns.filter((e) => !e.isError);
  const errors = entries.filter((e) => e.isError);
  const totalDurationMs = entries.length > 0 ? (entries[entries.length - 1]?.elapsedMs ?? 0) : 0;

  return {
    totalSteps: entries.length,
    totalDurationMs,
    uniqueActors,
    taskCount: dynamicDag.totalTasks,
    dynamicExpansionCount: dynamicDag.dynamicTasksCount,
    repairBranchesCount: dynamicDag.repairBranchesCount,
    maxRoundReached: dynamicDag.currentRound,
    gateRunsCount: gateRuns.length,
    gatePassesCount: gatePasses.length,
    gateFailsCount: gateFails.length,
    errorCount: errors.length,
  };
}

export function inspectCapsuleAuxiliary(runRoot: string): {
  readonly roundsFound: readonly string[];
  readonly activeLeaseFiles: readonly string[];
} {
  const roundsFound: string[] = [];
  const activeLeaseFiles: string[] = [];

  if (existsSync(runRoot)) {
    const roundsDir = join(runRoot, "rounds");
    if (existsSync(roundsDir)) {
      try {
        const entries = readdirSync(roundsDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isDirectory()) {
            roundsFound.push(e.name);
          }
        }
      } catch {
      }
    }

    const leasesDir = join(runRoot, "leases");
    if (existsSync(leasesDir)) {
      try {
        const entries = readdirSync(leasesDir, { withFileTypes: true });
        for (const e of entries) {
          if (e.isFile() && e.name.endsWith(".json")) {
            activeLeaseFiles.push(e.name);
          }
        }
      } catch {
      }
    }
  }

  return { roundsFound, activeLeaseFiles };
}
