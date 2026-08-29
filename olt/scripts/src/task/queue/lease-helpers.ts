import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { HarnessError } from "../../core/errors/index.ts";
import type { CompletionReceipts, TaskQueueItem } from "./types.ts";

export function assertValidActiveLease(task: TaskQueueItem, expectedToken?: string): void {
  if (!task.lease) {
    throw new HarnessError("INVALID_STATE", `Task '${task.id}' does not have an active lease`);
  }
  if (expectedToken && task.lease.token !== expectedToken) {
    throw new HarnessError("INVALID_STATE", `Lease token mismatch for task '${task.id}'`);
  }
  const expMs = Date.parse(task.lease.expires_at);
  if (Number.isFinite(expMs) && expMs <= Date.now()) {
    throw new HarnessError("INVALID_STATE", `Lease expired for task '${task.id}'`);
  }
}

export function validateCompletionReceipts(receipts?: CompletionReceipts): void {
  if (!receipts) return;
  if (receipts.exit_code !== undefined && receipts.exit_code !== 0) {
    throw new HarnessError(
      "INTEGRITY",
      `Mechanical exit code must be 0, got ${receipts.exit_code}`,
    );
  }
  if (receipts.cognitive_verdict !== undefined && receipts.cognitive_verdict !== "PASS") {
    throw new HarnessError(
      "INTEGRITY",
      `Cognitive verdict must be PASS, got ${receipts.cognitive_verdict}`,
    );
  }
}

export function assertWriteScopeASTPurity(repoRoot: string, writeScope: readonly string[]): void {
  for (const relPath of writeScope) {
    const fullPath = resolve(repoRoot, relPath);
    if (existsSync(fullPath) && (fullPath.endsWith(".ts") || fullPath.endsWith(".tsx") || fullPath.endsWith(".js"))) {
      const content = readFileSync(fullPath, "utf8");
      if (content.includes("/*") || content.includes("//")) {
        throw new HarnessError("INTEGRITY", `AST purity invariant violated in ${relPath}`);
      }
    }
  }
}

export function stageWorktreeProgress(worktreePath: string): void {
  if (existsSync(worktreePath)) {
    try {
      const proc = spawnSync("git", ["add", "-A"], { cwd: worktreePath });
      if (proc.status !== 0) {
        throw new HarnessError("INTEGRITY", `Failed to stage worktree in ${worktreePath}`);
      }
    } catch (error) {
      if (error instanceof HarnessError) throw error;
    }
  }
}

export function translateSuspendedLeases(
  tasks: readonly TaskQueueItem[],
  frozenDurationMs: number,
): { readonly translatedCount: number; readonly tasks: readonly TaskQueueItem[] } {
  if (frozenDurationMs <= 0) return { translatedCount: 0, tasks: [...tasks] };
  let count = 0;
  const updated = tasks.map((task) => {
    if (task.lease && (task.status === "IN_PROGRESS" || task.status === "RUNNING" || task.status === "VALIDATING")) {
      const expMs = Date.parse(task.lease.expires_at);
      if (Number.isFinite(expMs)) {
        count++;
        return {
          ...task,
          lease: { ...task.lease, expires_at: new Date(expMs + frozenDurationMs).toISOString() },
        };
      }
    }
    return task;
  });
  return { translatedCount: count, tasks: updated };
}
