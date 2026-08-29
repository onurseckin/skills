import { existsSync, lstatSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { loadRun } from "../../../engine/store/index.ts";
import type { LiveRunSummary } from "./types.ts";

export function parseNowMs(nowInput?: number | Date | string): number {
  if (typeof nowInput === "number") return nowInput;
  if (nowInput instanceof Date) return nowInput.getTime();
  if (typeof nowInput === "string") {
    const parsed = Date.parse(nowInput);
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

export function extractLiveRuns(
  capsulesDir: string,
  currentRunRoot: string,
  nowMs: number,
): LiveRunSummary[] {
  const currentBasename = basename(currentRunRoot);
  if (!existsSync(capsulesDir) || !lstatSync(capsulesDir).isDirectory()) {
    return [];
  }
  const entries = readdirSync(capsulesDir, { withFileTypes: true });
  const summaries: LiveRunSummary[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    if (
      entry.name === currentBasename ||
      entry.name.startsWith("mind-") ||
      entry.name.startsWith(".")
    ) {
      continue;
    }
    const runPath = join(capsulesDir, entry.name);
    try {
      const loaded = loadRun(runPath, false);
      const state = loaded.state;
      const completion = state.completion_result as { status?: string } | undefined;
      if (completion?.status === "complete") continue;

      const tasksRecord = (state.tasks ?? {}) as Record<string, Record<string, unknown>>;
      const tasks = Object.values(tasksRecord);
      const tasksCount = tasks.length;
      const leasedCount = tasks.filter((t) => t.lease !== undefined).length;
      const escalatedCount = tasks.filter((t) => t.status === "escalated").length;
      const readyTasksCount = tasks.filter(
        (t) => t.status === "ready" || t.status === "retry_ready",
      ).length;

      let hasStaleLease = false;
      for (const t of tasks) {
        if (t.lease && typeof t.lease === "object") {
          const expiresAt = (t.lease as Record<string, unknown>).expires_at;
          if (typeof expiresAt === "string" && Date.parse(expiresAt) < nowMs) {
            hasStaleLease = true;
          }
        }
      }

      let openFindingsCount = 0;
      for (const t of tasks) {
        if (Array.isArray(t.open_finding_ids)) {
          openFindingsCount += t.open_finding_ids.length;
        }
      }

      const gatesRecord = (state.gates ?? {}) as Record<string, Record<string, unknown>>;
      const gates = Object.values(gatesRecord);
      const greenGatesCount = gates.filter(
        (g) => g.status === "passed" || g.exit_code === 0,
      ).length;
      const failingGatesCount = gates.filter(
        (g) => g.status === "failed" || (typeof g.exit_code === "number" && g.exit_code !== 0),
      ).length;
      const totalGatesCount = gates.length;

      const phase = tasks.some((t) => t.status === "validating")
        ? "validating"
        : state.graph
          ? "executing"
          : "planning";

      summaries.push({
        runId: entry.name,
        runRoot: runPath,
        phase,
        tasksCount,
        leasedCount,
        escalatedCount,
        greenGatesCount,
        totalGatesCount,
        hasStaleLease,
        readyTasksCount,
        openFindingsCount,
        failingGatesCount,
      });
    } catch {
      // Ignore unreadable or non-run directories
    }
  }

  return summaries;
}
