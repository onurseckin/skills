export type {
  RoleCheatSheet,
  RoleCheatSheetOptions,
  RoleCommandCheatSheet,
} from "../../../roles/index.ts";

export type RoleArchetype =
  | "tier_0_mind"
  | "tier_1_orchestrator"
  | "tier_2_coordinator"
  | "tier_3_implementer"
  | "tier_3_validator"
  | "tier_3_repairer"
  | "tier_3_critic"
  | "tier_3_specialist";

export type RoleSpecializationDomain =
  | "code-quality"
  | "security"
  | "system-design"
  | "product"
  | "ui-design"
  | "performance"
  | "reliability"
  | "documentation"
  | "defect-investigation"
  | "concurrency"
  | "type-safety"
  | "general";

export type WriteScopePolicy = "forbidden" | "lease_bounded" | "unrestricted" | "domain_isolated";

export interface RoleLineageEntry {
  readonly version: number;
  readonly timestamp: string;
  readonly mutationReason: string;
  readonly previousSha256: string;
  readonly changedFields: readonly string[];
}

export interface DynamicRoleSpec {
  readonly name: string;
  readonly archetype: RoleArchetype;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly grantedCommands: readonly string[];
  readonly permittedActivities: readonly string[];
  readonly prohibitedActions: readonly string[];
  readonly invariants: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars: readonly string[];
  readonly writeScopePolicy: WriteScopePolicy;
  readonly version?: number | undefined;
  readonly parentRole?: string | undefined;
  readonly lineage?: readonly RoleLineageEntry[] | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface DynamicRoleContract {
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly may: readonly string[];
  readonly must_not: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars: readonly string[];
  readonly writeScopePolicy: WriteScopePolicy;
  readonly spec: DynamicRoleSpec;
  readonly markdown: string;
  readonly rawFrontmatter: string;
  readonly rawBody: string;
  readonly sha256: string;
}

export interface DynamicRoleValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
  readonly roleName: string;
  readonly tier: number;
}

export interface SynthesizeRoleOptions {
  readonly name: string;
  readonly archetype: RoleArchetype;
  readonly tier?: number | undefined;
  readonly title?: string | undefined;
  readonly summary?: string | undefined;
  readonly domain?: string | undefined;
  readonly grantedCommands?: readonly string[] | undefined;
  readonly permittedActivities?: readonly string[] | undefined;
  readonly prohibitedActions?: readonly string[] | undefined;
  readonly invariants?: readonly string[] | undefined;
  readonly spawns?: readonly string[] | undefined;
  readonly cognitivePillars?: readonly string[] | undefined;
  readonly writeScopePolicy?: WriteScopePolicy | undefined;
  readonly version?: number | undefined;
  readonly parentRole?: string | undefined;
  readonly metadata?: Readonly<Record<string, unknown>> | undefined;
}

export interface TaskRoleSynthesisParams {
  readonly taskId: string;
  readonly taskTitle: string;
  readonly writeScope: readonly string[];
  readonly gate: string;
  readonly domain?: string | undefined;
  readonly complexity?: "low" | "medium" | "high" | "critical" | undefined;
  readonly requiresRepair?: boolean | undefined;
  readonly candidateId?: string | undefined;
  readonly feedbackId?: string | undefined;
  readonly charterGoals?: readonly string[] | undefined;
}

export interface DynamicRoleSynthesisPlan {
  readonly taskId: string;
  readonly implementerRole: DynamicRoleContract;
  readonly validatorRole: DynamicRoleContract;
  readonly validationSummary: string;
  readonly antiBatchingCompliant: boolean;
  readonly antiBoundaryLeakGuaranteed: boolean;
}

export interface DefectRoleSynthesisParams {
  readonly defectId: string;
  readonly defectType: string;
  readonly rootCause: string;
  readonly affectedScope: readonly string[];
  readonly correctiveAction: string;
  readonly requiredInvariants?: readonly string[] | undefined;
}

export interface RoleMutationFeedback {
  readonly mutationReason: string;
  readonly newInvariants?: readonly string[] | undefined;
  readonly newPillars?: readonly string[] | undefined;
  readonly additionalCommands?: readonly string[] | undefined;
  readonly removedCommands?: readonly string[] | undefined;
  readonly additionalProhibitions?: readonly string[] | undefined;
  readonly metadataUpdate?: Readonly<Record<string, unknown>> | undefined;
}

export interface DynamicRoleCatalogExport {
  readonly exportedAt: string;
  readonly totalRoles: number;
  readonly roles: readonly DynamicRoleSpec[];
}

export interface DynamicRoleFilter {
  readonly tier?: number | undefined;
  readonly domain?: string | undefined;
  readonly archetype?: RoleArchetype | undefined;
  readonly writeScopePolicy?: WriteScopePolicy | undefined;
}

export const ARCHETYPE_TIER_MAP: Readonly<Record<RoleArchetype, number>> = {
  tier_0_mind: 0,
  tier_1_orchestrator: 1,
  tier_2_coordinator: 2,
  tier_3_implementer: 3,
  tier_3_validator: 3,
  tier_3_repairer: 3,
  tier_3_critic: 3,
  tier_3_specialist: 3,
};

export const ARCHETYPE_DEFAULT_COMMANDS: Readonly<Record<RoleArchetype, readonly string[]>> = {
  tier_0_mind: [
    "mind:round-open",
    "mind:round-close",
    "mind:pulse",
    "mind:wake",
    "mind:quiesce",
    "mind:self-evolve",
    "mind:audit",
    "doctor",
    "summary:export",
  ],
  tier_1_orchestrator: [
    "mind:round-open",
    "mind:round-close",
    "orchestrator:supervise",
    "recover",
    "doctor",
    "summary:export",
  ],
  tier_2_coordinator: [
    "plan:compile",
    "queue:wave",
    "task:ready",
    "task:retry",
    "gate:check",
    "doctor",
    "summary:export",
  ],
  tier_3_implementer: ["task:claim", "task:heartbeat", "task:submit", "run:exec"],
  tier_3_validator: ["gate:check", "validator:findings", "evidence:record", "critic:evaluate"],
  tier_3_repairer: ["task:claim", "task:heartbeat", "task:submit", "run:exec", "recover"],
  tier_3_critic: ["critic:evaluate", "gate:check", "evidence:record"],
  tier_3_specialist: ["task:claim", "task:heartbeat", "task:submit", "run:exec"],
};

export const ARCHETYPE_DEFAULT_SPAWNS: Readonly<Record<RoleArchetype, readonly string[]>> = {
  tier_0_mind: ["orchestrator"],
  tier_1_orchestrator: ["coordinator"],
  tier_2_coordinator: [
    "planner",
    "implementer",
    "validator",
    "repairer",
    "completeness-critic",
    "plan-validator",
  ],
  tier_3_implementer: [],
  tier_3_validator: [],
  tier_3_repairer: [],
  tier_3_critic: [],
  tier_3_specialist: [],
};

export const ARCHETYPE_DEFAULT_WRITE_POLICY: Readonly<Record<RoleArchetype, WriteScopePolicy>> = {
  tier_0_mind: "forbidden",
  tier_1_orchestrator: "forbidden",
  tier_2_coordinator: "forbidden",
  tier_3_implementer: "lease_bounded",
  tier_3_validator: "forbidden",
  tier_3_repairer: "lease_bounded",
  tier_3_critic: "forbidden",
  tier_3_specialist: "lease_bounded",
};

export const FORBIDDEN_COMMANDS = new Set<string>(["orchestrator:run"]);

export const ROLE_NAME_PATTERN = /^[a-z][a-z0-9_-]*$/u;
