import { normalize } from "node:path";
import {
  DEFAULT_CHARTER_RELATIVE_PATH,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  loadCharter,
  parseCharter,
  resolveCharterPath,
  type MindBudget,
  type ParsedCharter,
} from "../lifecycle/charter/index.ts";

export const CHARTER_AUDIT_PASSED = "CHARTER_AUDIT_PASSED" as const;
export const CHARTER_UNRESOLVED_GOALS = "CHARTER_UNRESOLVED_GOALS" as const;
export const CHARTER_BUDGET_EXCEEDED = "CHARTER_BUDGET_EXCEEDED" as const;
export const CHARTER_INTEGRITY_DRIFT = "CHARTER_INTEGRITY_DRIFT" as const;
export const CHARTER_SCOPE_VIOLATION = "CHARTER_SCOPE_VIOLATION" as const;
export const CHARTER_PROHIBITION_VIOLATION = "CHARTER_PROHIBITION_VIOLATION" as const;
export const DEFECT_MIND_AUDITING_MISSING_STATE_CHARTER =
  "defect-mind-auditing-missing-state-charter" as const;

export const CANONICAL_CHARTER_GOAL_IDS = Object.freeze(["G1", "G2", "G3"] as const);
export const STANDARD_CHARTER_GOALS = CANONICAL_CHARTER_GOAL_IDS;

export {
  DEFAULT_CHARTER_RELATIVE_PATH,
  DEFAULT_MIND_BUDGET,
  DEFAULT_PROHIBITIONS,
  loadCharter,
  parseCharter,
  resolveCharterPath,
  type MindBudget,
  type ParsedCharter,
};

export interface CharterAuditOptions {
  readonly repoRoot?: string | undefined;
  readonly customCharterPath?: string | undefined;
  readonly pinnedSha256?: string | undefined;
  readonly enforceBudgets?: boolean | undefined;
  readonly referencedGoals?: readonly string[] | undefined;
  readonly requiredGoals?: readonly string[] | undefined;
  readonly checkStandardGoals?: boolean | undefined;
  readonly touchedPaths?: readonly string[] | undefined;
  readonly budgetUsage?: CharterBudgetUsageMetrics | undefined;
  readonly hasOwnerAuthorization?: boolean | undefined;
}

export interface CharterBudgetUsageMetrics {
  readonly agentsInFlight?: number | undefined;
  readonly roundsSpent?: number | undefined;
  readonly wallClockMsSpent?: number | undefined;
  readonly openProposalsCount?: number | undefined;
}

export interface CharterGoalAuditResult {
  readonly valid: boolean;
  readonly definedGoals: readonly string[];
  readonly referencedGoals: readonly string[];
  readonly unmappedGoals: readonly string[];
  readonly missingRequiredGoals?: readonly string[] | undefined;
  readonly findings: readonly string[];
}

export interface CharterBudgetComplianceResult {
  readonly compliant: boolean;
  readonly violations: readonly string[];
  readonly metrics: CharterBudgetUsageMetrics;
}

export interface CharterIntegrityAuditResult {
  readonly intact: boolean;
  readonly pinnedSha256: string;
  readonly currentSha256: string;
  readonly driftDetected: boolean;
  readonly authorized: boolean;
  readonly findings: readonly string[];
}

export interface CharterRepoRootsAuditResult {
  readonly valid: boolean;
  readonly allowedRoots: readonly string[];
  readonly outOfBoundsPaths: readonly string[];
  readonly findings: readonly string[];
}

export interface CharterProhibitionAuditResult {
  readonly permitted: boolean;
  readonly matchedProhibitions: readonly string[];
  readonly findings: readonly string[];
}

export interface CharterAuditReport {
  readonly valid: boolean;
  readonly charterSha256: string;
  readonly goalAudit: CharterGoalAuditResult;
  readonly integrityAudit: CharterIntegrityAuditResult;
  readonly repoRootsAudit: CharterRepoRootsAuditResult;
  readonly budgetAudit?: CharterBudgetComplianceResult | undefined;
  readonly findings: readonly string[];
  readonly timestamp: string;
}

export function auditCharterGoals(
  charter: ParsedCharter,
  referencedGoalIds: readonly string[] = [],
  requiredGoalIds?: readonly string[] | undefined,
): CharterGoalAuditResult {
  const definedGoals = charter.goalIds;
  const definedSet = new Set(definedGoals);
  const unmappedGoals = referencedGoalIds.filter((g) => !definedSet.has(g));
  const missingRequiredGoals = (requiredGoalIds ?? []).filter((g) => !definedSet.has(g));
  const findings: string[] = [];

  if (definedGoals.length === 0) {
    findings.push("Charter contains no defined goals.");
  }
  for (const unmapped of unmappedGoals) {
    findings.push(
      `Referenced goal '${unmapped}' is not defined in charter goals [${definedGoals.join(", ")}].`,
    );
  }
  for (const missing of missingRequiredGoals) {
    findings.push(
      `Mandatory charter goal '${missing}' is not defined in charter goals [${definedGoals.join(", ")}].`,
    );
  }

  return {
    valid: findings.length === 0,
    definedGoals: Object.freeze([...definedGoals]),
    referencedGoals: Object.freeze([...referencedGoalIds]),
    unmappedGoals: Object.freeze(unmappedGoals),
    missingRequiredGoals: Object.freeze(missingRequiredGoals),
    findings: Object.freeze(findings),
  };
}

export function auditCharterBudgetCompliance(
  charter: ParsedCharter,
  metrics: CharterBudgetUsageMetrics = {},
): CharterBudgetComplianceResult {
  const budget = charter.budgets ?? DEFAULT_MIND_BUDGET;
  const violations: string[] = [];

  const maxAgents = budget.max_agents_in_flight ?? DEFAULT_MIND_BUDGET.max_agents_in_flight;
  if (
    metrics.agentsInFlight !== undefined &&
    typeof maxAgents === "number" &&
    metrics.agentsInFlight > maxAgents
  ) {
    violations.push(
      `Active agents in flight (${metrics.agentsInFlight}) exceeds charter limit (${maxAgents}).`,
    );
  }

  const maxRounds = budget.max_rounds_per_objective ?? DEFAULT_MIND_BUDGET.max_rounds_per_objective;
  if (
    metrics.roundsSpent !== undefined &&
    typeof maxRounds === "number" &&
    metrics.roundsSpent > maxRounds
  ) {
    violations.push(
      `Rounds spent (${metrics.roundsSpent}) exceeds charter objective limit (${maxRounds}).`,
    );
  }

  const maxWallClock = budget.wall_clock_ms_per_day ?? DEFAULT_MIND_BUDGET.wall_clock_ms_per_day;
  if (
    metrics.wallClockMsSpent !== undefined &&
    typeof maxWallClock === "number" &&
    metrics.wallClockMsSpent > maxWallClock
  ) {
    violations.push(
      `Wall clock duration (${metrics.wallClockMsSpent}ms) exceeds daily budget (${maxWallClock}ms).`,
    );
  }

  const maxProposals = budget.max_open_proposals ?? DEFAULT_MIND_BUDGET.max_open_proposals;
  if (
    metrics.openProposalsCount !== undefined &&
    typeof maxProposals === "number" &&
    metrics.openProposalsCount > maxProposals
  ) {
    violations.push(
      `Open proposals count (${metrics.openProposalsCount}) exceeds charter limit (${maxProposals}).`,
    );
  }

  return {
    compliant: violations.length === 0,
    violations: Object.freeze(violations),
    metrics,
  };
}

export function auditCharterIntegrity(
  pinnedSha256: string,
  currentSha256: string,
  hasOwnerAuthorization: boolean = false,
): CharterIntegrityAuditResult {
  const driftDetected =
    pinnedSha256.length > 0 && currentSha256.length > 0 && pinnedSha256 !== currentSha256;
  const findings: string[] = [];

  if (driftDetected && !hasOwnerAuthorization) {
    findings.push(
      `Charter sha256 changed from pinned ${pinnedSha256} to ${currentSha256} without owner authorization.`,
    );
  }

  return {
    intact: findings.length === 0,
    pinnedSha256,
    currentSha256,
    driftDetected,
    authorized: hasOwnerAuthorization,
    findings: Object.freeze(findings),
  };
}

export function auditCharterRepoRoots(
  charter: ParsedCharter,
  touchedPaths: readonly string[] = [],
): CharterRepoRootsAuditResult {
  const allowedRoots = charter.repoRoots;
  const outOfBoundsPaths: string[] = [];
  const findings: string[] = [];

  const allowsAll =
    allowedRoots.length === 0 ||
    allowedRoots.includes(".") ||
    allowedRoots.includes("./") ||
    allowedRoots.includes("*");

  for (const touched of touchedPaths) {
    if (allowsAll) {
      continue;
    }
    const normalized = normalize(touched).replace(/^[./\\]+/, "");
    const inBounds = allowedRoots.some((root) => {
      const trimmed = normalize(root)
        .replace(/^[./\\]+/, "")
        .replace(/[/\\]+$/, "");
      if (!trimmed || trimmed === ".") {
        return true;
      }
      return normalized === trimmed || normalized.startsWith(`${trimmed}/`);
    });
    if (!inBounds) {
      outOfBoundsPaths.push(touched);
      findings.push(
        `Touched path '${touched}' is outside declared charter repo_roots [${allowedRoots.join(", ")}].`,
      );
    }
  }

  return {
    valid: findings.length === 0,
    allowedRoots: Object.freeze([...allowedRoots]),
    outOfBoundsPaths: Object.freeze(outOfBoundsPaths),
    findings: Object.freeze(findings),
  };
}

export function auditCharterProhibitions(
  charter: ParsedCharter,
  actionText: string,
): CharterProhibitionAuditResult {
  const prohibitionsText = charter.prohibitions || DEFAULT_PROHIBITIONS;
  const lines = prohibitionsText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.endsWith(":"));

  const matchedProhibitions: string[] = [];
  const findings: string[] = [];
  const lowerAction = actionText.toLowerCase();

  for (const rule of lines) {
    const ruleKeywords = rule
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3);
    const matches =
      ruleKeywords.length > 0 && ruleKeywords.filter((w) => lowerAction.includes(w)).length >= 2;
    if (matches) {
      matchedProhibitions.push(rule);
      findings.push(`Action violates charter prohibition: "${rule}".`);
    }
  }

  return {
    permitted: findings.length === 0,
    matchedProhibitions: Object.freeze(matchedProhibitions),
    findings: Object.freeze(findings),
  };
}

export function auditCharterManifest(
  charterInput: string | ParsedCharter,
  options: CharterAuditOptions = {},
): CharterAuditReport {
  const charter = typeof charterInput === "string" ? parseCharter(charterInput) : charterInput;
  const requiredGoals =
    options.requiredGoals !== undefined
      ? options.requiredGoals
      : options.checkStandardGoals
        ? CANONICAL_CHARTER_GOAL_IDS
        : undefined;
  const goalAudit = auditCharterGoals(charter, options.referencedGoals ?? [], requiredGoals);
  const integrityAudit = auditCharterIntegrity(
    options.pinnedSha256 ?? charter.sha256,
    charter.sha256,
    options.hasOwnerAuthorization ?? false,
  );
  const repoRootsAudit = auditCharterRepoRoots(charter, options.touchedPaths ?? []);
  const budgetAudit = options.budgetUsage
    ? auditCharterBudgetCompliance(charter, options.budgetUsage)
    : undefined;

  const findings: string[] = [
    ...goalAudit.findings,
    ...integrityAudit.findings,
    ...repoRootsAudit.findings,
    ...(budgetAudit ? budgetAudit.violations : []),
  ];

  return {
    valid: findings.length === 0,
    charterSha256: charter.sha256,
    goalAudit,
    integrityAudit,
    repoRootsAudit,
    budgetAudit,
    findings: Object.freeze(findings),
    timestamp: new Date().toISOString(),
  };
}

export function auditLiveCharter(
  repoRoot?: string,
  options: CharterAuditOptions = {},
): CharterAuditReport {
  const root = repoRoot ?? options.repoRoot ?? process.cwd();
  const charter = loadCharter(root, options.customCharterPath);
  return auditCharterManifest(charter, {
    ...options,
    requiredGoals: options.requiredGoals ?? CANONICAL_CHARTER_GOAL_IDS,
  });
}
