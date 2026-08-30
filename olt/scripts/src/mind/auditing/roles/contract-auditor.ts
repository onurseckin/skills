import { existsSync, readFileSync } from "node:fs";
import { parseDynamicRoleContract } from "../../roles/dynamic/index.ts";
import {
  isOrchestratorRole,
  isCoordinatorRole,
  isValidatorRole,
  isImplementerRole,
  isMindRole,
} from "./rules/index.ts";
import type { DynamicRoleContract, DynamicRoleSpec } from "../../roles/dynamic/types.ts";
import type { RoleAuditFinding } from "./types.ts";

export interface SingleRoleAuditOptions {
  readonly minCognitivePillars?: number | undefined;
}

export function auditSingleRole(
  roleSource: string | DynamicRoleContract | DynamicRoleSpec,
  options?: SingleRoleAuditOptions,
): readonly RoleAuditFinding[] {
  const findings: RoleAuditFinding[] = [];
  let spec: DynamicRoleSpec;

  if (typeof roleSource === "string") {
    if (existsSync(roleSource)) {
      const content = readFileSync(roleSource, "utf-8");
      const parsed = parseDynamicRoleContract(content);
      spec = parsed.spec;
    } else {
      const parsed = parseDynamicRoleContract(roleSource);
      spec = parsed.spec;
    }
  } else if ("spec" in roleSource) {
    spec = roleSource.spec;
  } else {
    spec = roleSource;
  }

  const roleName =
    typeof roleSource === "object" &&
    roleSource !== null &&
    "role" in roleSource &&
    typeof roleSource.role === "string"
      ? roleSource.role
      : spec.name;
  const tier = spec.tier;
  const granted = spec.grantedCommands ?? [];
  const spawns = spec.spawns ?? [];
  const pillars = spec.cognitivePillars ?? [];
  const activities = spec.permittedActivities ?? [];

  if (tier === 3 && spawns.length > 0) {
    findings.push({
      id: `FIND-HIER-SPAWN3-${roleName}`,
      roleName,
      tier,
      category: "spawning_hierarchy",
      severity: "CRITICAL",
      title: "Tier 3 Leaf Spawning Violation",
      description: `Tier 3 role '${roleName}' declared spawns [${spawns.join(", ")}]. Leaf roles cannot spawn subagents.`,
      recommendation: "Clear spawns for Tier 3 roles.",
    });
  }
  if (tier === 0 && spawns.some((s) => !isOrchestratorRole(s))) {
    findings.push({
      id: `FIND-HIER-SPAWN0-${roleName}`,
      roleName,
      tier,
      category: "spawning_hierarchy",
      severity: "CRITICAL",
      title: "Tier 0 Cross-Tier Spawning Violation",
      description: `Tier 0 role '${roleName}' spawns non-orchestrator roles.`,
      recommendation: "Mind may only spawn Tier 1 Orchestrator.",
    });
  }
  if (tier === 1 && spawns.some((s) => !isCoordinatorRole(s))) {
    findings.push({
      id: `FIND-HIER-SPAWN1-${roleName}`,
      roleName,
      tier,
      category: "spawning_hierarchy",
      severity: "CRITICAL",
      title: "Tier 1 Cross-Tier Spawning Violation",
      description: `Tier 1 role '${roleName}' spawns non-coordinator roles.`,
      recommendation: "Orchestrator may only spawn Tier 2 Coordinator.",
    });
  }
  if (tier === 2 && spawns.some((s) => !isImplementerRole(s) && !isValidatorRole(s))) {
    findings.push({
      id: `FIND-HIER-SPAWN2-${roleName}`,
      roleName,
      tier,
      category: "spawning_hierarchy",
      severity: "CRITICAL",
      title: "Tier 2 Cross-Tier Spawning Violation",
      description: `Tier 2 role '${roleName}' spawns non-leaf roles.`,
      recommendation: "Coordinator may only spawn Tier 3 Implementer or Validator.",
    });
  }

  const parentRole = spec.parentRole;
  if (parentRole) {
    if (tier === 1 && !isMindRole(parentRole)) {
      findings.push({
        id: `FIND-HIER-PARENT1-${roleName}`,
        roleName,
        tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 1 Invalid Parent Role",
        description: `Tier 1 role '${roleName}' declared invalid parent '${parentRole}'.`,
        recommendation: "Tier 1 Orchestrator parent must be Tier 0 Mind.",
      });
    } else if (tier === 2 && !isOrchestratorRole(parentRole)) {
      findings.push({
        id: `FIND-HIER-PARENT2-${roleName}`,
        roleName,
        tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 2 Invalid Parent Role",
        description: `Tier 2 role '${roleName}' declared invalid parent '${parentRole}'.`,
        recommendation: "Tier 2 Coordinator parent must be Tier 1 Orchestrator.",
      });
    } else if (tier === 3 && !isCoordinatorRole(parentRole)) {
      findings.push({
        id: `FIND-HIER-PARENT3-${roleName}`,
        roleName,
        tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 3 Invalid Parent Role",
        description: `Tier 3 role '${roleName}' declared invalid parent '${parentRole}'.`,
        recommendation: "Tier 3 Leaf parent must be Tier 2 Coordinator.",
      });
    }
  }

  if (granted.includes("orchestrator:run")) {
    findings.push({
      id: `FIND-CMD-ORCHRUN-${roleName}`,
      roleName,
      tier,
      category: "command_authorization",
      severity: "CRITICAL",
      title: "Forbidden Command 'orchestrator:run' Granted",
      description: `Role '${roleName}' was granted forbidden command 'orchestrator:run'.`,
      recommendation: "Remove 'orchestrator:run' from granted commands.",
    });
  }
  if (tier < 3 && granted.includes("task:claim")) {
    findings.push({
      id: `FIND-CMD-SUPERCLAIM-${roleName}`,
      roleName,
      tier,
      category: "command_authorization",
      severity: "HIGH",
      title: "Supervisory Role Granted 'task:claim'",
      description: `Supervisory role '${roleName}' was granted 'task:claim'.`,
      recommendation: "Task claim is reserved for Tier 3 Implementers.",
    });
  }

  const isVal = spec.archetype === "tier_3_validator" || isValidatorRole(roleName);
  if (isVal) {
    const hasExplicitWritePolicy =
      spec.writeScopePolicy === "lease_bounded" || spec.writeScopePolicy === "unrestricted";
    const hasWriteActivity = activities.some(
      (a) =>
        a.toLowerCase().includes("write ") ||
        a.toLowerCase().includes("edit ") ||
        a.toLowerCase().includes("fix "),
    );
    if (hasExplicitWritePolicy || hasWriteActivity) {
      findings.push({
        id: `FIND-LEAK-VALWRITE-${roleName}`,
        roleName,
        tier,
        category: "anti_boundary_leak",
        severity: "CRITICAL",
        title: "Validator Write Scope Policy Violation",
        description: `Validator role '${roleName}' declared write permissions or write activities.`,
        recommendation:
          "Validators must have writeScopePolicy set to 'read_only' and zero write permissions.",
      });
    }
  }

  const minPillars = options?.minCognitivePillars ?? 0;
  if (minPillars > 0 && pillars.length < minPillars) {
    findings.push({
      id: `FIND-PILLARS-${roleName}`,
      roleName,
      tier,
      category: "cognitive_pillars",
      severity: "LOW",
      title: "Insufficient Cognitive Pillars",
      description: `Role '${roleName}' has ${pillars.length} pillars, required minimum is ${minPillars}.`,
      recommendation: "Add required cognitive pillars.",
    });
  }

  return findings;
}
