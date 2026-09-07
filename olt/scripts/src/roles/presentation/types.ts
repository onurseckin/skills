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
