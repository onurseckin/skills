import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_SOFT_DRAIN_THRESHOLD,
  type SoftExitExecutionParams,
  type SoftExitExecutionResult,
  type SubagentSpawnDecision,
  type TaskAdmissionDecision,
} from "./types.ts";

export function isSoftDrainActive(
  quotaPercentage: number,
  threshold = DEFAULT_SOFT_DRAIN_THRESHOLD,
): boolean {
  return quotaPercentage <= threshold;
}

export function canAdmitTask(
  quotaPercentage: number,
  threshold = DEFAULT_SOFT_DRAIN_THRESHOLD,
): TaskAdmissionDecision {
  if (isSoftDrainActive(quotaPercentage, threshold)) {
    return {
      allowed: false,
      reason: `Quota remaining (${quotaPercentage.toFixed(1)}%) is at or below soft drain threshold (${threshold}%). Task admission halted.`,
    };
  }
  return { allowed: true };
}

export function canSpawnSubagent(
  quotaPercentage: number,
  threshold = DEFAULT_SOFT_DRAIN_THRESHOLD,
): SubagentSpawnDecision {
  if (isSoftDrainActive(quotaPercentage, threshold)) {
    return {
      allowed: false,
      reason: `Quota remaining (${quotaPercentage.toFixed(1)}%) is at or below soft drain threshold (${threshold}%). Subagent spawn halted.`,
    };
  }
  return { allowed: true };
}

export function throttleConcurrency(
  currentP: number,
  quotaPercentage: number,
  threshold = DEFAULT_SOFT_DRAIN_THRESHOLD,
): number {
  if (isSoftDrainActive(quotaPercentage, threshold)) {
    return 1;
  }
  return currentP;
}

function runGitLocal(
  cwd: string,
  argv: readonly string[],
): { status: number; stdout: string; stderr: string } {
  try {
    const env = { ...process.env };
    delete env.GIT_DIR;
    delete env.GIT_WORK_TREE;
    delete env.GIT_INDEX_FILE;
    delete env.GIT_PREFIX;
    const res = spawnSync("git", argv as string[], { cwd, env, encoding: "utf-8" });
    return {
      status: res.status ?? -1,
      stdout: res.stdout ?? "",
      stderr: res.stderr ?? "",
    };
  } catch (err) {
    return {
      status: -1,
      stdout: "",
      stderr: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function executeGracefulSoftExit(
  params: SoftExitExecutionParams,
): Promise<SoftExitExecutionResult> {
  const { runRoot, repoRoot, lowestQuota, refreshHandoffFn, gitRunner } = params;
  const runner = gitRunner ?? runGitLocal;
  const handoffPath = join(runRoot, "handoff.md");

  try {
    if (typeof refreshHandoffFn === "function") {
      refreshHandoffFn(runRoot);
    } else if (!existsSync(handoffPath)) {
      writeFileSync(
        handoffPath,
        `# Harness handoff\n\nFrozen due to low quota (${lowestQuota}% remaining).\n`,
        "utf-8",
      );
    }
  } catch {
    // best-effort handoff refresh
  }

  try {
    const commitMsg = `chore(freeze): graceful soft exit at ${lowestQuota}% quota [skip ci]`;
    const addRes = runner(repoRoot, ["add", "-A"]);
    if (addRes.status !== 0) {
      return {
        handoffPath,
        error: `git add failed: ${addRes.stderr}`,
      };
    }
    const commitRes = runner(repoRoot, ["commit", "-m", commitMsg]);
    const revParse = runner(repoRoot, ["rev-parse", "HEAD"]);
    const stagedCommitSha = revParse.status === 0 ? revParse.stdout.trim() : undefined;
    return {
      handoffPath,
      stagedCommitSha,
      error: commitRes.status !== 0 && !stagedCommitSha ? commitRes.stderr : undefined,
    };
  } catch (error) {
    return {
      handoffPath,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
