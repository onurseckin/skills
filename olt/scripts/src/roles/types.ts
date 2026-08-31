import type { AgentModelTier, Evidenced, ThinkingLevel } from "../core/contracts/index.ts";

export type AbstractProfile = "deliberate" | "default" | "adversarial" | "cheap_bulk";

export interface ProfileBinding {
  readonly model?: string;
  readonly model_tier?: AgentModelTier;
  readonly thinking_level?: ThinkingLevel;
  readonly effort?: string;
  readonly context_window?: number;
}

export type ProfileBindings = Partial<Record<AbstractProfile, ProfileBinding>>;

export interface ResolvedProfile {
  readonly profile: AbstractProfile;
  readonly bound: boolean;
  readonly model: string | "unknown";
  readonly model_tier: AgentModelTier | "unknown";
  readonly thinking_level: ThinkingLevel | "unknown";
  readonly effort?: string;
  readonly context_window?: number;
}

export interface AgentProfileResolution {
  readonly role: string;
  readonly profile: AbstractProfile | "unknown";
  readonly supportedOnHost: boolean;
  readonly limitation?: string;
  readonly model?: Evidenced<string>;
  readonly model_tier?: Evidenced<AgentModelTier>;
  readonly thinking_level?: Evidenced<ThinkingLevel>;
  readonly context_window?: Evidenced<number>;
  readonly telemetryRecords: Record<string, Evidenced<unknown>>;
}

export interface RoleCheatSheetOptions {
  readonly compact?: boolean | undefined;
  readonly rolesDir?: string | undefined;
  readonly agentsDir?: string | undefined;
}

export interface RoleCommandCheatSheet {
  readonly name: string;
  readonly summary: string;
  readonly syntax: string;
  readonly requiredFlags: readonly string[];
  readonly optionalFlags: readonly string[];
  readonly examples: readonly string[];
}

export interface RoleCheatSheet {
  readonly role: string;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly grantedCommands: readonly string[];
  readonly commandDetails: readonly RoleCommandCheatSheet[];
  readonly permittedActivities: readonly string[];
  readonly forbiddenActions: readonly string[];
  readonly invariants: readonly string[];
  readonly authorityRules: readonly string[];
  readonly spawns: readonly string[];
  readonly cognitivePillars?: readonly string[] | undefined;
  readonly markdown: string;
}

export interface RoleSummary {
  readonly role: string;
  readonly tier: number;
  readonly commandCount: number;
  readonly spawnsCount: number;
  readonly spawns: readonly string[];
  readonly invariantsCount: number;
  readonly domain?: string | undefined;
}

export interface UniversalRoleSpec {
  readonly name: string;
  readonly tier: number;
  readonly title: string;
  readonly summary: string;
  readonly domain?: string | undefined;
  readonly archetype?: string | undefined;
  readonly writeScopePolicy?: string | undefined;
  readonly grantedCommands: readonly string[];
  readonly permittedActivities: readonly string[];
  readonly prohibitedActions?: readonly string[] | undefined;
  readonly forbiddenActions?: readonly string[] | undefined;
  readonly invariants: readonly string[];
  readonly authorityRules?: readonly string[] | undefined;
  readonly spawns: readonly string[];
  readonly cognitivePillars?: readonly string[] | undefined;
}

export interface CommandSyntaxInfo {
  readonly syntax: string;
  readonly requiredFlags: readonly string[];
  readonly optionalFlags: readonly string[];
}

export type RoleExecutionTier = 0 | 1 | 2 | 3 | "independent";

export type RoleActionType =
  | "code_write"
  | "command_exec"
  | "subagent_spawn"
  | "lease_claim"
  | "lease_submit"
  | "repairer_assign"
  | "state_mutate"
  | "file_read"
  | "message_send";

export interface RoleCapabilityEntry {
  readonly role: string;
  readonly tier: RoleExecutionTier;
  readonly profile: AbstractProfile;
  readonly canWriteCode: boolean;
  readonly canExecuteCommands: boolean;
  readonly canSpawnSubagents: boolean;
  readonly canClaimLeases: boolean;
  readonly allowedCommands: readonly string[];
  readonly forbiddenCommands: readonly string[];
  readonly allowedSpawns: readonly string[];
  readonly invariants: readonly string[];
}

export type RoleCapabilityMatrix = Readonly<Record<string, RoleCapabilityEntry>>;

export interface RoleBoundaryViolation {
  readonly role: string;
  readonly action: RoleActionType;
  readonly target?: string | undefined;
  readonly ruleId: string;
  readonly message: string;
}

export interface PersonaSignatureInput {
  readonly name: string;
  readonly role: string;
  readonly tier: RoleExecutionTier;
  readonly may: readonly string[];
  readonly mustNot: readonly string[];
  readonly commands: readonly string[];
  readonly spawns: readonly string[];
  readonly invariants: readonly string[];
  readonly writeToolsEnabled?: boolean | undefined;
  readonly subagentToolsEnabled?: boolean | undefined;
  readonly domain?: string | undefined;
}

export interface PersonaSignatureDigest {
  readonly role: string;
  readonly tier: RoleExecutionTier;
  readonly canonicalJson: string;
  readonly signatureHash: string;
  readonly computedAt: string;
}

export interface PersonaIntegrityReport {
  readonly valid: boolean;
  readonly role: string;
  readonly expectedHash?: string | undefined;
  readonly actualHash: string;
  readonly mismatches: readonly string[];
}

export interface ManifestSchemaError {
  readonly field: string;
  readonly message: string;
  readonly receivedValue?: unknown;
}

export interface ManifestSchemaValidationResult {
  readonly valid: boolean;
  readonly errors: readonly ManifestSchemaError[];
  readonly warnings: readonly string[];
  readonly role?: string | undefined;
  readonly tier?: RoleExecutionTier | undefined;
}
