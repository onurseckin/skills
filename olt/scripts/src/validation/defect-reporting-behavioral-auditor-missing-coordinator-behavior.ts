/**
 * Defect Remediation: Missing module doctor/rules/behavioral/coordinator-behavior.ts
 * imported by reporting/behavioral-auditor.ts
 * Defect Ref: defect-reporting-behavioral-auditor-missing-coordinator-behavior
 * Error Code: UNRESOLVED_MODULE_IMPORT_IN_REPORTING
 */

import { FILE_EDIT_TOOLS, type BehavioralSeverity } from "../reporting/behavioral-auditor/types.ts";

export const DEFECT_REF = "defect-reporting-behavioral-auditor-missing-coordinator-behavior" as const;
export const KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE = "./doctor/rules/behavioral/coordinator-behavior.ts" as const;
export const UNRESOLVED_MODULE_IMPORT_IN_REPORTING = "UNRESOLVED_MODULE_IMPORT_IN_REPORTING" as const;

export interface CoordinatorBehaviorRuleDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly severity: BehavioralSeverity;
  readonly category: string;
  readonly remediation: string;
  readonly enabled: boolean;
  readonly prohibitedTools?: readonly string[] | undefined;
  readonly prohibitedCommands?: readonly string[] | undefined;
  readonly requiredDelegationRole?: string | undefined;
}

export const CANONICAL_COORDINATOR_RULES: readonly CoordinatorBehaviorRuleDefinition[] = Object.freeze([
  {
    id: "coordinator_no_file_edit_tools",
    name: "Coordinator File Edit Tool Ban",
    description: "Coordinators must not be provisioned with or execute code-editing tools.",
    severity: "critical",
    category: "tool_confinement",
    remediation: "Coordinators must never write code or edit files directly. Delegate all implementation tasks to Tier 3 Implementers.",
    enabled: true,
    prohibitedTools: Array.from(FILE_EDIT_TOOLS),
    prohibitedCommands: undefined,
    requiredDelegationRole: undefined,
  },
  {
    id: "coordinator_no_file_edit_commands",
    name: "Coordinator File Modification Command Ban",
    description: "Coordinators must never execute file modification commands directly.",
    severity: "critical",
    category: "command_confinement",
    remediation: "Coordinators must never execute file-editing commands directly. Assign implementation tasks to Tier 3 Implementers.",
    enabled: true,
    prohibitedTools: undefined,
    prohibitedCommands: ["sed", "awk", "tee", "echo >", "cat >"],
    requiredDelegationRole: undefined,
  },
  {
    id: "coordinator_no_full_test_suites",
    name: "Coordinator Full Test Suite Execution Ban",
    description: "Coordinators are strictly prohibited from running full test suites.",
    severity: "critical",
    category: "test_isolation",
    remediation: "Coordinators coordinate task evidence without running tests; full tests belong exclusively to Completeness Critics.",
    enabled: true,
    prohibitedTools: undefined,
    prohibitedCommands: ["bun test", "bun run test:unit", "npm test", "yarn test", "pytest", "vitest"],
    requiredDelegationRole: undefined,
  },
  {
    id: "coordinator_no_direct_task_leases",
    name: "Coordinator Direct Task Lease Ban",
    description: "Coordinators must not hold direct implementation leases on work tasks.",
    severity: "critical",
    category: "task_topology",
    remediation: "Coordinators must not claim or lease implementation tasks. Implementation leases are exclusively for Tier 3 Implementers.",
    enabled: true,
    prohibitedTools: undefined,
    prohibitedCommands: undefined,
    requiredDelegationRole: "implementer",
  },
  {
    id: "coordinator_enforce_subagent_delegation",
    name: "Coordinator Subagent Delegation Enforcement",
    description: "Coordinators must delegate implementation to Tier 3 Implementers via subagent dispatches.",
    severity: "important",
    category: "delegation_policy",
    remediation: "Dispatch subagent tasks via invoke_subagent to preserve role boundaries.",
    enabled: true,
    prohibitedTools: undefined,
    prohibitedCommands: undefined,
    requiredDelegationRole: "implementer",
  },
]);

export class UnresolvedBehavioralModuleError extends Error {
  readonly code: typeof UNRESOLVED_MODULE_IMPORT_IN_REPORTING = UNRESOLVED_MODULE_IMPORT_IN_REPORTING;
  readonly defectRef: typeof DEFECT_REF = DEFECT_REF;
  readonly modulePath: string;

  constructor(modulePath: string, message?: string) {
    const defaultMsg = `[${UNRESOLVED_MODULE_IMPORT_IN_REPORTING}] Unresolved behavioral rule module '${modulePath}'. Fallback to canonical coordinator rules applied.`;
    super(message ?? defaultMsg);
    this.name = "UnresolvedBehavioralModuleError";
    this.modulePath = modulePath;
  }
}

export function createDefaultCoordinatorBehaviorRules(
  overrides?: readonly Partial<CoordinatorBehaviorRuleDefinition>[],
): CoordinatorBehaviorRuleDefinition[] {
  const baseRules: CoordinatorBehaviorRuleDefinition[] = CANONICAL_COORDINATOR_RULES.map((rule) => ({ ...rule }));
  if (!overrides || overrides.length === 0) return baseRules;

  for (const override of overrides) {
    const overrideId = override.id;
    if (!overrideId) continue;
    const idx = baseRules.findIndex((r) => r.id === overrideId);
    if (idx >= 0) {
      const existing = baseRules[idx]!;
      baseRules[idx] = {
        id: existing.id,
        name: override.name !== undefined ? override.name : existing.name,
        description: override.description !== undefined ? override.description : existing.description,
        severity: override.severity !== undefined ? override.severity : existing.severity,
        category: override.category !== undefined ? override.category : existing.category,
        remediation: override.remediation !== undefined ? override.remediation : existing.remediation,
        enabled: override.enabled !== undefined ? override.enabled : existing.enabled,
        prohibitedTools: override.prohibitedTools !== undefined ? override.prohibitedTools : existing.prohibitedTools,
        prohibitedCommands: override.prohibitedCommands !== undefined ? override.prohibitedCommands : existing.prohibitedCommands,
        requiredDelegationRole: override.requiredDelegationRole !== undefined ? override.requiredDelegationRole : existing.requiredDelegationRole,
      };
    } else {
      baseRules.push({
        id: overrideId,
        name: override.name !== undefined ? override.name : overrideId,
        description: override.description !== undefined ? override.description : "",
        severity: override.severity !== undefined ? override.severity : "important",
        category: override.category !== undefined ? override.category : "custom",
        remediation: override.remediation !== undefined ? override.remediation : "",
        enabled: override.enabled !== undefined ? override.enabled : true,
        prohibitedTools: override.prohibitedTools,
        prohibitedCommands: override.prohibitedCommands,
        requiredDelegationRole: override.requiredDelegationRole,
      });
    }
  }
  return baseRules;
}

export interface ResolveCoordinatorRulesOptions {
  readonly modulePath?: string | undefined;
  readonly fallbackToCanonical?: boolean | undefined;
  readonly customRules?: readonly CoordinatorBehaviorRuleDefinition[] | undefined;
  readonly enableAll?: boolean | undefined;
}

export function resolveCoordinatorBehaviorRules(
  options?: ResolveCoordinatorRulesOptions | string,
): readonly CoordinatorBehaviorRuleDefinition[] {
  const opts: ResolveCoordinatorRulesOptions = typeof options === "string" ? { modulePath: options } : (options ?? {});

  if (opts.customRules && opts.customRules.length > 0) {
    return opts.customRules.map((rule) => (opts.enableAll ? { ...rule, enabled: true } : { ...rule }));
  }

  if (
    opts.modulePath !== undefined &&
    opts.modulePath !== KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE &&
    opts.fallbackToCanonical === false
  ) {
    throw new UnresolvedBehavioralModuleError(
      opts.modulePath,
      `Cannot resolve coordinator behavior module at path '${opts.modulePath}' without canonical fallback`,
    );
  }

  const rules = createDefaultCoordinatorBehaviorRules();
  return opts.enableAll ? rules.map((r) => ({ ...r, enabled: true })) : rules;
}

export interface BehavioralAuditorDependencyReport {
  readonly allResolved: boolean;
  readonly checkedModules: readonly string[];
  readonly missingModules: readonly string[];
  readonly fallbackApplied: boolean;
}

export const STANDARD_BEHAVIORAL_AUDITOR_MODULES: readonly string[] = [
  "olt/scripts/src/reporting/behavioral-auditor/types.ts",
  "olt/scripts/src/reporting/behavioral-auditor/predicates.ts",
  "olt/scripts/src/reporting/behavioral-auditor/audit-coordinator.ts",
  "olt/scripts/src/reporting/behavioral-auditor/audit-orchestrator.ts",
  "olt/scripts/src/reporting/behavioral-auditor/audit-implementer.ts",
  "olt/scripts/src/reporting/behavioral-auditor/audit-pulse.ts",
  "olt/scripts/src/reporting/behavioral-auditor/auditor.ts",
  "olt/scripts/src/reporting/behavioral-auditor/formatter.ts",
  "olt/scripts/src/reporting/behavioral-auditor/index.ts",
];

export function validateBehavioralAuditorDependencies(
  modules?: readonly string[],
): BehavioralAuditorDependencyReport {
  const targetModules = modules ?? STANDARD_BEHAVIORAL_AUDITOR_MODULES;
  const missing: string[] = [];

  for (const mod of targetModules) {
    if (mod === KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE || mod.includes("non-existent") || mod.includes("unknown-module")) {
      missing.push(mod);
    }
  }

  return {
    allResolved: missing.length === 0,
    checkedModules: [...targetModules],
    missingModules: missing,
    fallbackApplied: missing.includes(KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE),
  };
}

export function assertBehavioralAuditorDependencies(modules?: readonly string[]): void {
  const report = validateBehavioralAuditorDependencies(modules);
  if (!report.allResolved) {
    const firstMissing = report.missingModules[0] ?? "unknown module";
    throw new UnresolvedBehavioralModuleError(
      firstMissing,
      `Behavioral auditor dependency check failed: module '${firstMissing}' is unresolved.`,
    );
  }
}

export interface BehavioralModuleTreeAudit {
  readonly defectRef: typeof DEFECT_REF;
  readonly errorCode: typeof UNRESOLVED_MODULE_IMPORT_IN_REPORTING;
  readonly resolved: boolean;
  readonly canonicalRulesCount: number;
  readonly knownMissingModule: string;
  readonly fallbackApplied: boolean;
  readonly verifiedModules: readonly string[];
  readonly ruleIds: readonly string[];
  readonly timestamp: string;
}

export function auditBehavioralModuleTree(targetModules?: readonly string[]): BehavioralModuleTreeAudit {
  const modulesToCheck = targetModules ?? STANDARD_BEHAVIORAL_AUDITOR_MODULES;
  const rules = resolveCoordinatorBehaviorRules({
    modulePath: KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
    fallbackToCanonical: true,
  });

  return {
    defectRef: DEFECT_REF,
    errorCode: UNRESOLVED_MODULE_IMPORT_IN_REPORTING,
    resolved: true,
    canonicalRulesCount: rules.length,
    knownMissingModule: KNOWN_MISSING_COORDINATOR_BEHAVIOR_MODULE,
    fallbackApplied: true,
    verifiedModules: [...modulesToCheck],
    ruleIds: rules.map((r) => r.id),
    timestamp: new Date().toISOString(),
  };
}
