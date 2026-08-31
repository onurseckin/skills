import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
export const CANONICAL_GOVERNANCE_CHARTER_PATH =
  "olt/scripts/src/mind/governance/charter.ts" as const;
export const CANONICAL_LIFECYCLE_CHARTER_PATH =
  "olt/scripts/src/mind/lifecycle/charter/index.ts" as const;

export type { CharterGoal, StabilityCheck, MindBudgetOverrides, MindBudget, ParsedCharter };

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

export function normalizeCharterContent(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function computeCharterSha256(content: string): string {
  const normalized = normalizeCharterContent(content);
  return createHash("sha256").update(normalized, "utf8").digest("hex");
}

export function validateGovernanceCharter(parsed: ParsedCharter): boolean {
  if (!parsed) {
    return false;
  }
  if (typeof parsed !== "object") {
    return false;
  }
  if (typeof parsed.identity !== "string") {
    return false;
  }
  if (parsed.identity.trim().length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.goals)) {
    return false;
  }
  if (parsed.goals.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.goalIds)) {
    return false;
  }
  if (parsed.goalIds.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.nonGoals)) {
    return false;
  }
  if (parsed.nonGoals.length === 0) {
    return false;
  }
  if (!Array.isArray(parsed.repoRoots)) {
    return false;
  }
  if (parsed.repoRoots.length === 0) {
    return false;
  }
  if (typeof parsed.sha256 !== "string") {
    return false;
  }
  if (parsed.sha256.length !== 64) {
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

export function getCharterGoal(parsed: ParsedCharter, goalId: string): CharterGoal | undefined {
  const targetId = goalId.toUpperCase().trim();
  return parsed.goals.find((g) => g.id === targetId);
}

export function hasCharterGoal(parsed: ParsedCharter, goalId: string): boolean {
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
  let actualSha256: string;
  if (existsSync(charterPath)) {
    try {
      const raw = readFileSync(charterPath, "utf8");
      actualSha256 = computeCharterSha256(raw);
    } catch {
      const charter = loadCharter(repoRoot, charterSourceRel);
      actualSha256 = charter.sha256;
    }
  } else {
    const charter = loadCharter(repoRoot, charterSourceRel);
    actualSha256 = charter.sha256;
  }
  const valid = expectedSha256 ? actualSha256 === expectedSha256 : true;
  return {
    valid,
    actualSha256,
    expectedSha256,
    charterPath,
  };
}
