import { basename, dirname, join, resolve } from "node:path";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  validateHierarchicalSpawning,
} from "../../../../packets/command-authority.ts";
import {
  validateDynamicRoleSpec,
  type DynamicRoleContract,
  type DynamicRoleSpec,
} from "../../../dynamic-roles.ts";
import type {
  RoleAuditFinding,
  RoleAuditOptions,
} from "./slice_13.ts";
import {
  isCoordinatorRole,
  isMindRole,
  isOrchestratorRole,
  roleToTier,
} from "./slice_17.ts";

export function auditSingleRole(
  role: DynamicRoleSpec | DynamicRoleContract,
  options: RoleAuditOptions = {},
): readonly RoleAuditFinding[] {
  const findings: RoleAuditFinding[] = [];
  const spec: DynamicRoleSpec = "spec" in role ? role.spec : role;

  const minPillars = options.minCognitivePillars ?? 2;
  const strictAntiLeak = options.strictAntiLeak ?? true;
  const checkHierarchy = options.checkHierarchy ?? true;
  const checkCommands = options.checkCommands ?? true;

  // 1. Basic Specification Validation
  const specValidation = validateDynamicRoleSpec(spec);
  if (!specValidation.valid) {
    for (const err of specValidation.errors) {
      findings.push({
        id: `FIND-SPEC-${spec.name}-${findings.length + 1}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "boundary",
        severity: "CRITICAL",
        title: "Dynamic Role Specification Invalid",
        description: err,
        recommendation: "Update role specification to comply with dynamic role constraints.",
      });
    }
  }

  // 2. Anti-Boundary-Leak Enforcement & Cognitive Validator Hard-Lock for Validators & Critics
  if (
    strictAntiLeak &&
    (spec.archetype === "tier_3_validator" ||
      spec.archetype === "tier_3_critic" ||
      isCognitiveValidatorRole(spec.name))
  ) {
    if (spec.writeScopePolicy !== "forbidden") {
      findings.push({
        id: `FIND-LEAK-WRITE-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "CRITICAL",
        title: "Anti-Boundary-Leak: Write Scope Policy Violation",
        description: `Validator role '${spec.name}' declared writeScopePolicy '${spec.writeScopePolicy}'. Validators must be strictly read-only ('forbidden').`,
        recommendation: "Set writeScopePolicy to 'forbidden' for all validators and critics.",
        evidence: { writeScopePolicy: spec.writeScopePolicy },
      });
    }

    const hasWritePermission = spec.permittedActivities.some(
      (act) =>
        act.toLowerCase().includes("write") ||
        act.toLowerCase().includes("edit") ||
        act.toLowerCase().includes("claim lease") ||
        act.toLowerCase().includes("modify file"),
    );
    if (hasWritePermission) {
      findings.push({
        id: `FIND-LEAK-MAY-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "CRITICAL",
        title: "Anti-Boundary-Leak: Write Permission in Permitted Activities",
        description: `Validator role '${spec.name}' contains file write/edit actions in permitted activities.`,
        recommendation: "Remove file modification permissions from validator permitted activities.",
      });
    }

    const hasAntiLeakMustNot = spec.prohibitedActions.some(
      (act) =>
        act.toLowerCase().includes("claim code write lease") ||
        act.toLowerCase().includes("edit source") ||
        act.toLowerCase().includes("write files") ||
        act.toLowerCase().includes("anti-boundary-leak"),
    );
    if (!hasAntiLeakMustNot) {
      findings.push({
        id: `FIND-LEAK-MUSTNOT-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "anti_boundary_leak",
        severity: "HIGH",
        title: "Anti-Boundary-Leak: Missing Explicit Prohibition",
        description: `Validator role '${spec.name}' lacks explicit Anti-Boundary-Leak prohibition in must_not declarations.`,
        recommendation:
          "Add explicit prohibition 'Claim code write leases or edit source files (Anti-Boundary-Leak Rule)' to must_not.",
      });
    }

    // Cognitive Validator Hard-Lock Interlock verification
    if (!isMechanicValidatorRole(spec.name)) {
      const prohibitedExecutionCmds = spec.grantedCommands.filter((cmd) => {
        const c = cmd.toLowerCase().trim();
        return (
          c === "run:exec" ||
          c === "bash" ||
          c === "sh" ||
          c === "zsh" ||
          c === "exec" ||
          c === "bun test" ||
          c === "npm test" ||
          c === "pytest" ||
          c === "cargo test" ||
          c.includes("test-runner") ||
          c.startsWith("run:exec")
        );
      });
      if (prohibitedExecutionCmds.length > 0) {
        findings.push({
          id: `FIND-HARDLOCK-CMD-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "validator_hardlock",
          severity: "CRITICAL",
          title: "Cognitive Validator Hard-Lock: Execution Command Granted",
          description: `Cognitive validator role '${spec.name}' was granted prohibited execution command(s) [${prohibitedExecutionCmds.join(", ")}]. Cognitive Validators and Critics are strictly banned from executing bash, shell commands, test runners, build tools, or package managers.`,
          recommendation:
            "Remove all execution commands ('run:exec', test runners, shell commands) from cognitive validator granted commands. Test execution authority belongs exclusively to Mechanic Validators.",
          evidence: {
            grantedCommands: spec.grantedCommands,
            prohibitedCommands: prohibitedExecutionCmds,
          },
        });
      }

      const hasHardlockMustNot = spec.prohibitedActions.some((act) => {
        const a = act.toLowerCase();
        return (
          a.includes("run:exec") ||
          a.includes("execute bash") ||
          a.includes("shell command") ||
          a.includes("test suite") ||
          a.includes("validator hard-lock") ||
          a.includes("hard-lock") ||
          a.includes("package manager") ||
          a.includes("build tool")
        );
      });
      if (!hasHardlockMustNot) {
        findings.push({
          id: `FIND-HARDLOCK-MUSTNOT-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "validator_hardlock",
          severity: "HIGH",
          title: "Cognitive Validator Hard-Lock: Missing Explicit Prohibition",
          description: `Validator role '${spec.name}' lacks explicit Cognitive Validator Hard-Lock prohibition in must_not declarations.`,
          recommendation:
            "Add explicit prohibition 'Execute test suites, bash/shell commands, build tools, or package managers (Cognitive Validator Hard-Lock Rule)' to must_not.",
        });
      }
    }
  }

  // 3. Spawning Hierarchy & Parent-Child Boundary Validation
  if (checkHierarchy) {
    if (spec.tier === 3 && spec.spawns.length > 0) {
      findings.push({
        id: `FIND-HIER-SPAWN3-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 3 Leaf Spawning Violation",
        description: `Tier 3 role '${spec.name}' declared child spawns [${spec.spawns.join(", ")}]. Tier 3 roles are leaf execution workers and cannot spawn subagents.`,
        recommendation: "Clear spawns array for Tier 3 roles.",
      });
    }

    if (spec.tier === 0 && spec.spawns.some((s) => !isOrchestratorRole(s))) {
      findings.push({
        id: `FIND-HIER-SPAWN0-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 0 Cross-Tier Spawning Violation",
        description: `Tier 0 Mind declared child spawns [${spec.spawns.join(", ")}]. Mind may only dispatch Tier 1 Orchestrator.`,
        recommendation: "Set spawns to strictly ['orchestrator'].",
      });
    }

    if (spec.tier === 1 && spec.spawns.some((s) => !isCoordinatorRole(s))) {
      findings.push({
        id: `FIND-HIER-SPAWN1-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 1 Cross-Tier Spawning Violation",
        description: `Tier 1 Orchestrator declared child spawns [${spec.spawns.join(", ")}]. Orchestrator may only dispatch Tier 2 Coordinator.`,
        recommendation: "Set spawns to strictly ['coordinator'].",
      });
    }

    if (
      spec.tier === 2 &&
      spec.spawns.some(
        (s) => isMindRole(s) || isOrchestratorRole(s) || isCoordinatorRole(s) || roleToTier(s) < 3,
      )
    ) {
      findings.push({
        id: `FIND-HIER-SPAWN2-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "spawning_hierarchy",
        severity: "CRITICAL",
        title: "Tier 2 Cross-Tier Spawning Violation",
        description: `Tier 2 Coordinator declared non-Tier-3 child spawns [${spec.spawns.join(", ")}]. Coordinators may only dispatch Tier 3 workers (Implementers, Validators, Critics, Repairers).`,
        recommendation: "Set spawns to strictly Tier 3 role names.",
      });
    }

    if (spec.parentRole) {
      if (spec.tier === 0) {
        findings.push({
          id: `FIND-HIER-PARENT0-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 0 Root Hierarchy Violation",
          description: `Tier 0 Mind declared parent role '${spec.parentRole}'. Tier 0 Mind is root supervisory authority and cannot have a parent role.`,
          recommendation: "Remove parentRole from Tier 0 Mind role specification.",
        });
      } else if (spec.tier === 1 && !isMindRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT1-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 1 Parent Supervision Violation",
          description: `Tier 1 Orchestrator declared invalid parent role '${spec.parentRole}'. Orchestrator must be supervised by Tier 0 Mind.`,
          recommendation: "Set parentRole to 'mind'.",
        });
      } else if (spec.tier === 2 && !isOrchestratorRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT2-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 2 Parent Supervision Violation",
          description: `Tier 2 Coordinator declared invalid parent role '${spec.parentRole}'. Coordinator must be supervised by Tier 1 Orchestrator.`,
          recommendation: "Set parentRole to 'orchestrator'.",
        });
      } else if (spec.tier === 3 && !isCoordinatorRole(spec.parentRole)) {
        findings.push({
          id: `FIND-HIER-PARENT3-${spec.name}`,
          roleName: spec.name,
          tier: spec.tier,
          category: "spawning_hierarchy",
          severity: "CRITICAL",
          title: "Tier 3 Parent Supervision Violation",
          description: `Tier 3 worker declared invalid parent role '${spec.parentRole}'. Tier 3 workers must be supervised by Tier 2 Coordinator.`,
          recommendation: "Set parentRole to 'coordinator'.",
        });
      }
    }
  }

  // 4. Command Authorization & Forbidden Commands
  if (checkCommands) {
    if (spec.grantedCommands.includes("orchestrator:run")) {
      findings.push({
        id: `FIND-CMD-ORCHRUN-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "command_authorization",
        severity: "CRITICAL",
        title: "Forbidden Command 'orchestrator:run' Granted",
        description: `Role '${spec.name}' was granted 'orchestrator:run', which is strictly forbidden across all role specifications.`,
        recommendation: "Remove 'orchestrator:run' from granted commands.",
      });
    }

    if (spec.tier < 3 && spec.grantedCommands.includes("task:claim")) {
      findings.push({
        id: `FIND-CMD-SUPERCLAIM-${spec.name}`,
        roleName: spec.name,
        tier: spec.tier,
        category: "command_authorization",
        severity: "HIGH",
        title: "Supervisory Task Claiming Command Granted",
        description: `Supervisory role '${spec.name}' (Tier ${spec.tier}) was granted 'task:claim'. Supervisors must delegate tasks, not claim them.`,
        recommendation: "Remove 'task:claim' from supervisory role commands.",
      });
    }
  }

  // 5. Cognitive Pillars & Zero-Any Discipline
  if (spec.cognitivePillars.length < minPillars) {
    findings.push({
      id: `FIND-PILLAR-COUNT-${spec.name}`,
      roleName: spec.name,
      tier: spec.tier,
      category: "cognitive_pillars",
      severity: "MEDIUM",
      title: "Insufficient Cognitive Pillars",
      description: `Role '${spec.name}' has ${spec.cognitivePillars.length} cognitive pillars defined (minimum recommended: ${minPillars}).`,
      recommendation: "Add explicit cognitive pillars to guide role execution posture.",
    });
  }

  const hasZeroAnyPillar =
    spec.cognitivePillars.some(
      (p) =>
        p.toLowerCase().includes("zero-any") || p.toLowerCase().includes("zero-unknown") ||
        p.toLowerCase().includes("type safety") ||
        p.toLowerCase().includes("strict type"),
    ) ||
    spec.invariants.some(
      (i) => i.toLowerCase().includes("zero-any") || i.toLowerCase().includes("zero any") || i.toLowerCase().includes("zero-unknown"),
    );

  if (spec.tier === 3 && spec.archetype === "tier_3_implementer" && !hasZeroAnyPillar) {
    findings.push({
      id: `FIND-PILLAR-ZEROANY-${spec.name}`,
      roleName: spec.name,
      tier: spec.tier,
      category: "cognitive_pillars",
      severity: "LOW",
      title: "Missing Explicit Zero-Any TypeScript Pillar",
      description: `Implementer role '${spec.name}' does not explicitly cite the Zero-Any TypeScript discipline.`,
      recommendation:
        "Include 'Strict Zero-Any & Zero-Suppression TypeScript Discipline' in cognitive pillars.",
    });
  }

  return findings;
}