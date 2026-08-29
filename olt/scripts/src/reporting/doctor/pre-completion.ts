import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { autoHealGitState, checkGitIndexIntegrity } from "./git-index-engine.ts";
import { checkRepositoryHygiene } from "./hygiene-engine.ts";
import { cleanseDanglingLocks } from "./lock-cleaner.ts";
import { checkPushbackQuotas } from "./pushback-quotas-engine.ts";
import { autoHealWorktreeState, checkWorktreeHealth } from "./worktree-health-engine.ts";
import { autoHealMailboxState, checkMailboxHealth } from "./mailbox-health-engine.ts";
import { generateRemedialGuidance, type DoctorRemedialAction } from "./guidance.ts";
import type { DoctorDiagnosticFinding } from "./types.ts";

export interface PreCompletionDiagnosticsOptions {
  readonly runRoot: string;
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly Readonly<Record<string, unknown>>[] | undefined;
  readonly autoHeal?: boolean | undefined;
}

export interface PreCompletionBlocker {
  readonly category: string;
  readonly code: string;
  readonly message: string;
  readonly autoHealable: boolean;
  readonly remedyCommand?: string | undefined;
}

export interface PreCompletionDiagnosticsResult {
  readonly readyForCompletion: boolean;
  readonly blockers: readonly PreCompletionBlocker[];
  readonly autoHealedItems: readonly string[];
  readonly remedialGuidance: readonly string[];
  readonly remedialActions: readonly DoctorRemedialAction[];
  readonly findings: readonly DoctorDiagnosticFinding[];
}

function resolveStateObject(
  runRoot: string,
  stateOption?: Readonly<Record<string, unknown>> | null,
): Record<string, unknown> | null {
  if (stateOption && typeof stateOption === "object") {
    return stateOption as Record<string, unknown>;
  }
  const statePath = join(runRoot, "state.json");
  if (existsSync(statePath)) {
    try {
      const content = readFileSync(statePath, "utf-8");
      return JSON.parse(content) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

export function checkPreCompletionDiagnostics(
  options: PreCompletionDiagnosticsOptions,
): PreCompletionDiagnosticsResult {
  const runRoot = options.runRoot;
  const repoRoot = options.repoRoot ?? resolve(runRoot, "..", "..");
  const autoHeal = options.autoHeal ?? true;

  const blockers: PreCompletionBlocker[] = [];
  const autoHealedItems: string[] = [];
  const findings: DoctorDiagnosticFinding[] = [];

  if (autoHeal) {
    const gitHeal = autoHealGitState({ repoRoot, cleanIndexLock: true, stageModified: true });
    if (gitHeal.indexLockCleaned) autoHealedItems.push("Healed stale .git/index.lock");
    if (gitHeal.stagedFiles.length > 0) {
      autoHealedItems.push(`Auto-staged ${gitHeal.stagedFiles.length} file(s) for reflog safety`);
    }

    const clearedLocks = cleanseDanglingLocks({ repoRoot });
    if (clearedLocks.length > 0) {
      autoHealedItems.push(`Cleared dangling lock(s): ${clearedLocks.join(", ")}`);
    }

    const wtHeal = autoHealWorktreeState({ repoRoot });
    if (wtHeal.repaired.length > 0) {
      autoHealedItems.push(...wtHeal.repaired);
    }

    const mbHeal = autoHealMailboxState({ repoRoot });
    if (mbHeal.length > 0) {
      autoHealedItems.push(...mbHeal);
    }
  }

  let orphanEvidenceList: string[] = [];
  let missingRunGatesList: string[] = [];
  let criticStatusVal: string | null = null;

  const stateObj = resolveStateObject(runRoot, options.state);
  if (stateObj) {
    const rawOrphans = Array.isArray(stateObj.orphan_evidence)
      ? (stateObj.orphan_evidence as unknown[])
      : [];
    const rawDispositions = Array.isArray(stateObj.orphan_evidence_dispositions)
      ? (stateObj.orphan_evidence_dispositions as unknown[])
      : [];

    const dispositionSet = new Set<string>();
    for (const d of rawDispositions) {
      if (d && typeof d === "object") {
        const dObj = d as Record<string, unknown>;
        if (typeof dObj.orphan_sha256 === "string") dispositionSet.add(dObj.orphan_sha256);
      }
    }

    for (const item of rawOrphans) {
      let sha = "";
      if (typeof item === "string") sha = item;
      else if (item && typeof item === "object") {
        const itemObj = item as Record<string, unknown>;
        if (typeof itemObj.orphan_sha256 === "string") sha = itemObj.orphan_sha256;
      }
      if (sha.length > 0 && !dispositionSet.has(sha)) {
        orphanEvidenceList.push(sha);
        blockers.push({
          category: "EVIDENCE",
          code: "ORPHAN_EVIDENCE_UNDISPOSITIONED",
          message: `Orphan evidence ${sha} requires explicit disposition prior to run completion.`,
          autoHealable: false,
          remedyCommand: `bun harness.ts evidence:disposition --run ${runRoot}`,
        });
        findings.push({
          code: "ORPHAN_EVIDENCE_UNDISPOSITIONED",
          severity: "ERROR",
          engine: "checkPreCompletionDiagnostics",
          message: `Orphan evidence ${sha} undispositioned`,
          details: { sha },
        });
      }
    }

    if (stateObj.completion_critic && typeof stateObj.completion_critic === "object") {
      const critic = stateObj.completion_critic as Record<string, unknown>;
      const criticId = typeof critic.critic_id === "string" ? critic.critic_id : "unknown-critic";
      const status = typeof critic.status === "string" ? critic.status : "";
      criticStatusVal = status;

      if (status === "expired") {
        blockers.push({
          category: "CRITIC",
          code: "CRITIC_REVIEW_REQUIRED",
          message: "A completeness critic review is required before completion sealing.",
          autoHealable: false,
          remedyCommand: `bun harness.ts critic:start --run ${runRoot}`,
        });
      } else if (status === "assigned" || status === "packet_published") {
        blockers.push({
          category: "CRITIC",
          code: "CRITIC_REVIEW_PENDING",
          message: `Completeness critic '${criticId}' has not submitted a review verdict.`,
          autoHealable: false,
          remedyCommand: `bun harness.ts critic:review --run ${runRoot} --critic ${criticId}`,
        });
      }
    }

    if (stateObj.completion_review && typeof stateObj.completion_review === "object") {
      const review = stateObj.completion_review as Record<string, unknown>;
      const revSha = typeof review.review_sha256 === "string" ? review.review_sha256 : "review";
      if (review.status === "findings") {
        const remediations = Array.isArray(stateObj.completion_remediations)
          ? (stateObj.completion_remediations as Record<string, unknown>[])
          : [];
        if (!remediations.some((r) => r.review_sha256 === revSha)) {
          blockers.push({
            category: "CRITIC",
            code: "CRITIC_FINDINGS_UNADDRESSED",
            message: `Critic review ${revSha} contains unaddressed findings.`,
            autoHealable: false,
            remedyCommand: `bun harness.ts critic:start --run ${runRoot}`,
          });
        }
      }
    }
  }

  const hygiene = checkRepositoryHygiene({ repoRoot });
  for (const v of hygiene.violations) {
    if (v.severity === "ERROR") {
      blockers.push({
        category: "HYGIENE",
        code: v.violationType,
        message: v.message,
        autoHealable: false,
        remedyCommand: `bun harness.ts doctor --fix`,
      });
      findings.push({
        code: v.violationType,
        severity: v.severity,
        engine: "checkRepositoryHygiene",
        message: v.message,
        details: { path: v.path },
      });
    }
  }

  const quotas = checkPushbackQuotas({
    state: stateObj,
    tasks: (stateObj?.tasks as Record<string, unknown> | undefined) ?? null,
    events: options.events ?? null,
    repoRoot,
  });
  for (const f of quotas.findings) {
    if (f.severity === "ERROR") {
      blockers.push({
        category: "QUOTA",
        code: f.code,
        message: f.message,
        autoHealable: false,
        remedyCommand: `bun harness.ts task:probe --run ${runRoot} --task <TASK_ID>`,
      });
      findings.push(f);
    }
  }

  const gitIndex = checkGitIndexIntegrity({ repoRoot });
  for (const f of gitIndex.findings) {
    if (f.severity === "ERROR") {
      blockers.push({
        category: "GIT",
        code: f.code,
        message: f.message,
        autoHealable: true,
        remedyCommand: `git add -A`,
      });
      findings.push(f);
    }
  }

  const worktree = checkWorktreeHealth({ repoRoot });
  for (const f of worktree.findings) {
    if (f.severity === "ERROR") {
      blockers.push({
        category: "WORKTREE",
        code: f.code,
        message: f.message,
        autoHealable: true,
        remedyCommand: `bun harness.ts branch:cleanup`,
      });
      findings.push(f);
    }
  }

  const mailbox = checkMailboxHealth({ repoRoot });
  for (const f of mailbox.findings) {
    if (f.severity === "ERROR") {
      blockers.push({
        category: "MAILBOX",
        code: f.code,
        message: f.message,
        autoHealable: true,
        remedyCommand: `bun harness.ts doctor --fix`,
      });
      findings.push(f);
    }
  }

  const guidance = generateRemedialGuidance({
    runRoot,
    repoRoot,
    findings,
    completionBlockers: blockers.map((b) => b.message),
    missingRunGates: missingRunGatesList,
    orphanEvidence: orphanEvidenceList,
    criticStatus: criticStatusVal,
  });

  return {
    readyForCompletion: blockers.length === 0,
    blockers,
    autoHealedItems,
    remedialGuidance: guidance.guidanceSummary,
    remedialActions: guidance.remedialActions,
    findings,
  };
}

export function executePreCompletionDoctorHook(
  runRoot: string,
  options: Omit<PreCompletionDiagnosticsOptions, "runRoot"> = {},
): PreCompletionDiagnosticsResult {
  return checkPreCompletionDiagnostics({ runRoot, ...options });
}
