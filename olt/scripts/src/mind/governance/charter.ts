import { HarnessError } from "../../core/errors/index.ts";
import {
  DEFAULT_CHARTER_RELATIVE_PATH,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  loadCharter,
  parseBudgetsObject,
  parseCharter,
  parseCharterFromYaml,
  parseCharterYaml,
  parseDurationOrNumber,
  resolveCharterPath,
} from "../lifecycle/charter/index.ts";
import type {
  CharterGoal,
  MindBudget,
  MindBudgetOverrides,
  ParsedCharter,
  StabilityCheck,
} from "../lifecycle/charter/index.ts";

export const DEFECT_REF = "defect-stale-governance-charter-imports" as const;
export const ERROR_CODE = "STALE_GOVERNANCE_CHARTER_IMPORTS" as const;
export const CANONICAL_GOVERNANCE_CHARTER_PATH = "olt/scripts/src/mind/governance/charter.ts" as const;
export const CANONICAL_LIFECYCLE_CHARTER_PATH = "olt/scripts/src/mind/lifecycle/charter/index.ts" as const;

export type {
  CharterGoal,
  StabilityCheck,
  MindBudgetOverrides,
  MindBudget,
  ParsedCharter,
};

export {
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  parseDurationOrNumber,
  parseBudgetsObject,
  parseCharterFromYaml,
  parseCharter,
  parseCharterYaml,
  DEFAULT_CHARTER_RELATIVE_PATH,
  resolveCharterPath,
  loadCharter,
};

export function validateGovernanceCharter(parsed: ParsedCharter): boolean {
  if (!parsed || typeof parsed !== "object") {
    return false;
  }
  if (typeof parsed.identity !== "string" || !parsed.identity.trim()) {
    return false;
  }
  if (!Array.isArray(parsed.goals) || parsed.goals.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.goalIds) || parsed.goalIds.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.nonGoals) || parsed.nonGoals.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.repoRoots) || parsed.repoRoots.length === 0) {
    return false;
  }
  if (typeof parsed.sha256 !== "string" || parsed.sha256.length !== 64) {
    return false;
  }
  return true;
}

export function assertGovernanceCharter(parsed: ParsedCharter): void {
  if (!validateGovernanceCharter(parsed)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "Governance charter validation failed: missing or invalid mandatory charter sections",
    );
  }
}

export function resolveGovernanceCharter(
  repoRoot: string,
  charterSourceRel?: string,
  charterRepoRoots?: readonly string[],
): ParsedCharter {
  const charter = loadCharter(repoRoot, charterSourceRel, charterRepoRoots);
  assertGovernanceCharter(charter);
  return charter;
}

export function getCharterGoal(
  parsed: ParsedCharter,
  goalId: string,
): CharterGoal | undefined {
  const targetId = goalId.toUpperCase().trim();
  return parsed.goals.find((g) => g.id === targetId);
}

export function hasCharterGoal(
  parsed: ParsedCharter,
  goalId: string,
): boolean {
  return getCharterGoal(parsed, goalId) !== undefined;
}

export function formatCharterSummary(parsed: ParsedCharter): string {
  const goalSummary = parsed.goals.map((g) => `${g.id}: ${g.statement}`).join("; ");
  return `Identity: ${parsed.identity} | Goals (${parsed.goals.length}): [${goalSummary}] | Repo Roots: [${parsed.repoRoots.join(", ")}]`;
}

export interface CharterIntegrityResult {
  readonly valid: boolean;
  readonly actualSha256: string;
  readonly expectedSha256?: string | undefined;
  readonly charterPath: string;
}

export function verifyCharterIntegrity(
  repoRoot: string,
  expectedSha256?: string,
  charterSourceRel?: string,
): CharterIntegrityResult {
  const charterPath = resolveCharterPath(repoRoot, charterSourceRel);
  const charter = loadCharter(repoRoot, charterSourceRel);
  const actualSha256 = charter.sha256;
  const valid = expectedSha256 ? actualSha256 === expectedSha256 : true;
  return {
    valid,
    actualSha256,
    expectedSha256,
    charterPath,
  };
}
