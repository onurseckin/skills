import { join } from "node:path";
import { refreshHandoff } from "../../reporting/index.ts";
import { runGit } from "../../workflow/index.ts";
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

export async function executeGracefulSoftExit(
  params: SoftExitExecutionParams,
): Promise<SoftExitExecutionResult> {
  const { runRoot, repoRoot, lowestQuota } = params;
  let handoffPath = "";
  try {
    handoffPath = refreshHandoff(runRoot) ?? join(runRoot, "handoff.md");
  } catch {
    handoffPath = join(runRoot, "handoff.md");
  }

  try {
    const commitMsg = `chore(freeze): graceful soft exit at ${lowestQuota}% quota [skip ci]`;
    const addRes = runGit(repoRoot, ["add", "-A"]);
    if (addRes.status !== 0) {
      return {
        handoffPath,
        error: `git add failed: ${addRes.stderr}`,
      };
    }
    const commitRes = runGit(repoRoot, ["commit", "-m", commitMsg]);
    const revParse = runGit(repoRoot, ["rev-parse", "HEAD"]);
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
