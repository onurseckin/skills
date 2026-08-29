import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { CircuitBreakerEvaluation } from "../circuit-breaker.ts";
import {
  STANDARD_SUPERVISORY_CRONS,
  type CaptureDagSnapshotOptions,
  type QuotaDagSnapshot,
  type QuotaDagSnapshotAgent,
  type QuotaDagSnapshotTask,
  type QuotaDagSnapshotWave,
} from "./types.ts";
import { isOwnCode } from "./snapshot-lock.ts";
import { requiredText, timestamp } from "./snapshot-persistence.ts";

export async function captureDagSnapshot(
  options: CaptureDagSnapshotOptions,
): Promise<QuotaDagSnapshot> {
  const runRoot = resolve(requiredText(options.runRoot, "runRoot"));
  const repositoryRoot = resolve(requiredText(options.repositoryRoot, "repositoryRoot"));
  if (
    options.lowestQuotaObserved !== null &&
    (!Number.isFinite(options.lowestQuotaObserved) || options.lowestQuotaObserved < 0)
  )
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "lowestQuotaObserved must be null or finite and non-negative",
    );
  const resetTime = timestamp(options.resetTime, "resetTime");
  let tasks: QuotaDagSnapshotTask[] = [];
  let agents: QuotaDagSnapshotAgent[] = [];
  let activeWave: QuotaDagSnapshotWave | undefined;
  try {
    const raw = readFileSync(join(runRoot, "memory.json"), "utf8");
    const memory: unknown = JSON.parse(raw);
    if (!memory || typeof memory !== "object" || Array.isArray(memory))
      throw new HarnessError("INTEGRITY", "run memory is invalid");
    const data = memory as Record<string, unknown>;
    if (data.tasks !== undefined) {
      if (!Array.isArray(data.tasks))
        throw new HarnessError("INTEGRITY", "run memory tasks is invalid");
      tasks = data.tasks as QuotaDagSnapshotTask[];
    }
    if (data.agents !== undefined) {
      if (!Array.isArray(data.agents))
        throw new HarnessError("INTEGRITY", "run memory agents is invalid");
      agents = data.agents as QuotaDagSnapshotAgent[];
    }
    if (data.activeWave !== undefined) {
      if (!data.activeWave || typeof data.activeWave !== "object" || Array.isArray(data.activeWave))
        throw new HarnessError("INTEGRITY", "run memory activeWave is invalid");
      activeWave = data.activeWave as QuotaDagSnapshotWave;
    }
  } catch (error) {
    if (!isOwnCode(error, "ENOENT")) {
      if (error instanceof HarnessError) throw error;
      throw new HarnessError("INTEGRITY", "could not capture run memory evidence");
    }
  }
  const git = spawnSync("git", ["status", "--porcelain"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    cwd: repositoryRoot,
    shell: false,
  });
  if (git.status !== 0)
    throw new HarnessError("INTEGRITY", "could not capture repository status evidence");
  return {
    version: "2",
    repositoryRoot,
    runRoot,
    frozenAt: new Date().toISOString(),
    status: "frozen",
    tasks,
    agents,
    cronsSuspended: STANDARD_SUPERVISORY_CRONS.map((cron) => ({ ...cron })),
    uncommittedFiles: (git.stdout ?? "")
      .split("\n")
      .filter(Boolean)
      .map((line) => line.slice(3).trim()),
    lowestQuotaObserved: options.lowestQuotaObserved,
    constrainedModels: [...options.constrainedModels],
    autoWakeSchedule: {
      resetTime,
      resumeTime: new Date(Date.parse(resetTime) + 60_000).toISOString(),
    },
    ...(activeWave ? { activeWave } : {}),
  };
}

export function formatDagSnapshotMarkdown(
  snapshot: QuotaDagSnapshot,
  evaluation: CircuitBreakerEvaluation,
  detailed = false,
): string {
  let markdown = `## Quota DAG Snapshot\n\n- **Status**: ${snapshot.status}\n- **Frozen At**: ${snapshot.frozenAt}\n- **Lowest Quota Observed**: ${evaluation.lowestRemainingQuota ?? "None"}%\n- **Constrained Models**: ${snapshot.constrainedModels.join(", ") || "None"}\n- **Auto-Wake Resume Time**: ${snapshot.autoWakeSchedule.resumeTime}\n\n`;
  if (detailed) {
    markdown += "### Tasks\n";
    if (!snapshot.tasks.length) markdown += "*No active tasks*\n";
    for (const task of snapshot.tasks)
      markdown += `- **${task.id}**: ${task.status} (Effort: ${task.effortMath})\n`;
    markdown += "\n### Uncommitted Files\n";
    if (!snapshot.uncommittedFiles.length) markdown += "*None*\n";
    for (const file of snapshot.uncommittedFiles) markdown += `- \`${file}\`\n`;
  }
  return markdown;
}
