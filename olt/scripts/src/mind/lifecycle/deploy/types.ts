import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isAgentRole, type AgentRole } from "../../../core/contracts/index.ts";
import { evidenced, type Evidenced } from "../../../core/contracts/index.ts";
import { canonicalJsonBytes } from "../../../core/json.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { DEFAULT_PROHIBITIONS, type MindBudget, type ParsedCharter } from "../charter/index.ts";
import type { CandidateRecord } from "../../proposals/gates/index.ts";
import {
  loadRoleContract,
  parseRoleContract,
  type RoleContract,
} from "../../../packets/role-contract.ts";

/**
 * Mapping of canonical agent roles to their designated hierarchy tier (0 to 3).
 *
 * Tier 0: Mind (observe, admit, and deploy tier-1 orchestrators)
 * Tier 1: Orchestrator (owns chain of round capsules for one objective)
 * Tier 2: Coordinator and task planners/critics (owns one run capsule)
 * Tier 3: Implementers and validators (task execution and verification)
 */
export const ROLE_TIER_MAP: Readonly<Record<AgentRole, number>> = {
  mind: 0,
  "skill-auditor": 0,
  orchestrator: 1,
  "mind-auditor": 1,
  coordinator: 2,
  planner: 2,
  "plan-validator": 2,
  repairer: 2,
  "completeness-critic": 2,
  implementer: 3,
  validator: 3,
  "mechanic-validator": 3,
  "sub-implementer": 3,
  "sub-validator": 3,
  "sub-investigator": 3,
};

/**
 * Strict tier hierarchy spawn authority.
 * Rule: A tier may deploy ONLY the tier directly beneath it.
 * - Mind (Tier 0) -> Orchestrator (Tier 1) only.
 * - Orchestrator (Tier 1) -> Coordinator (Tier 2), and Implementer/Validator exclusively on Fast-Path ($N = 1$).
 * - Coordinator (Tier 2) -> Tier 3 execution roles (implementer, validator, etc.).
 * - Implementer / Validator (Tier 3) -> sub-roles only.
 */
export const ALLOWED_TIER_SPAWNS: Readonly<Record<AgentRole, readonly AgentRole[]>> = {
  mind: ["orchestrator"],
  "skill-auditor": [],
  orchestrator: ["coordinator"],
  "mind-auditor": [],
  coordinator: [
    "implementer",
    "validator",
    "mechanic-validator",
    "planner",
    "plan-validator",
    "repairer",
    "completeness-critic",
  ],
  implementer: ["sub-implementer", "sub-investigator"],
  validator: ["sub-validator"],
  "mechanic-validator": ["sub-validator"],
  planner: [],
  "plan-validator": [],
  repairer: [],
  "completeness-critic": [],
  "sub-implementer": [],
  "sub-validator": [],
  "sub-investigator": [],
};

/**
 * Abstract profile names defined per PLAN.md §10.
 * Profile maps to abstract behavior categories, never concrete model names.
 */
export const ABSTRACT_PROFILES = ["deliberate", "default", "adversarial", "cheap_bulk"] as const;

export type AbstractProfile = (typeof ABSTRACT_PROFILES)[number];

export const PROHIBITED_MODEL_PATTERNS: readonly RegExp[] = [
  /\bclaude\b/iu,
  /\bgpt\b/iu,
  /\bgemini\b/iu,
  /\bopus\b/iu,
  /\bsonnet\b/iu,
  /\bhaiku\b/iu,
  /\bllama\b/iu,
  /\bdeepseek\b/iu,
  /\bqwen\b/iu,
  /\bmistral\b/iu,
  /\bo1(?:-preview|-mini)?\b/iu,
  /\bo3(?:-mini)?\b/iu,
  /\bflash(?:_lite)?\b/iu,
  /\bpro\b/iu,
  /\binherit\b/iu,
];

export const PROHIBITED_TELEMETRY_KEYS: ReadonlySet<string> = new Set([
  "model",
  "model_tier",
  "thinking_level",
  "provider",
  "context_window",
]);

export interface TierSpawnValidationResult {
  readonly ok: boolean;
  readonly reason?: string;
  readonly parentRole: AgentRole;
  readonly childRole: AgentRole;
  readonly parentTier: number;
  readonly childTier: number;
}

/**
 * Validates parent-child spawn authority against strict tier rules.
 */
export function validateTierSpawn(
  parentRole: AgentRole,
  childRole: AgentRole,
): TierSpawnValidationResult {
  if (!isAgentRole(parentRole) || !isAgentRole(childRole)) {
    const parentTier = isAgentRole(parentRole) ? ROLE_TIER_MAP[parentRole] : -1;
    const childTier = isAgentRole(childRole) ? ROLE_TIER_MAP[childRole] : -1;
    return {
      ok: false,
      reason: `unrecognized agent role(s): parent=${String(parentRole)}, child=${String(childRole)}`,
      parentRole,
      childRole,
      parentTier,
      childTier,
    };
  }

  const parentTier = ROLE_TIER_MAP[parentRole];
  const childTier = ROLE_TIER_MAP[childRole];

  if (parentRole === childRole) {
    return {
      ok: false,
      reason: `a role cannot deploy itself: ${parentRole}`,
      parentRole,
      childRole,
      parentTier,
      childTier,
    };
  }

  const allowedChildren = ALLOWED_TIER_SPAWNS[parentRole];
  if (!allowedChildren.includes(childRole)) {
    if (parentRole === "mind") {
      return {
        ok: false,
        reason: `tier 0 mind may only deploy tier 1 orchestrator; attempted to deploy ${childRole} (tier ${childTier})`,
        parentRole,
        childRole,
        parentTier,
        childTier,
      };
    }
    if (parentRole === "orchestrator") {
      return {
        ok: false,
        reason: `tier 1 orchestrator may only deploy tier 2 coordinator; attempted to deploy ${childRole} (tier ${childTier})`,
        parentRole,
        childRole,
        parentTier,
        childTier,
      };
    }
    if (parentRole === "coordinator" && (childRole === "mind" || childRole === "orchestrator")) {
      return {
        ok: false,
        reason: `tier 2 coordinator cannot deploy higher-tier role ${childRole} (tier ${childTier})`,
        parentRole,
        childRole,
        parentTier,
        childTier,
      };
    }
    return {
      ok: false,
      reason: `role ${parentRole} (tier ${parentTier}) cannot deploy ${childRole} (tier ${childTier}); violates strict tier hierarchy`,
      parentRole,
      childRole,
      parentTier,
      childTier,
    };
  }

  return {
    ok: true,
    parentRole,
    childRole,
    parentTier,
    childTier,
  };
}

/**
 * Asserts that a parent role is authorized to spawn a child role under strict tier rules.
 * Throws HarnessError if the spawn violates hierarchy constraints.
 */
export function assertTierSpawn(parentRole: AgentRole, childRole: AgentRole): void {
  const result = validateTierSpawn(parentRole, childRole);
  if (!result.ok) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      result.reason ?? `role ${parentRole} cannot spawn ${childRole}`,
    );
  }
}

/**
 * Validates that a profile string is an abstract profile name and contains no concrete model names.
 */
export function validateAbstractProfile(profile: string): { ok: boolean; reason?: string } {
  if (typeof profile !== "string" || profile.trim() === "") {
    return { ok: false, reason: "profile must be a non-empty abstract profile name" };
  }
  const trimmed = profile.trim();
  for (const pattern of PROHIBITED_MODEL_PATTERNS) {
    if (pattern.test(trimmed)) {
      return {
        ok: false,
        reason: `profile "${trimmed}" contains concrete model identifier matching ${pattern.toString()}; must be an abstract profile name`,
      };
    }
  }
  return { ok: true };
}

/**
 * Asserts that a profile string is abstract and contains no concrete model names.
 */
export function assertAbstractProfile(profile: string): void {
  const result = validateAbstractProfile(profile);
  if (!result.ok) {
    throw new HarnessError("INVALID_ARGUMENT", result.reason ?? "invalid abstract profile");
  }
}

export function enforceIsolatedTaskDispatch(candidateId: string): {
  implementerTaskId: string;
  validatorTaskId: string;
  writeScope: string[];
} {
  return {
    implementerTaskId: `${candidateId}-impl`,
    validatorTaskId: `${candidateId}-val`,
    writeScope: [`src/${candidateId}`],
  };
}

export function atomicAdmissionToDispatch(candidateId: string): boolean {
  return candidateId.trim().length > 0;
}
