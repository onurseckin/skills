import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { findCommand } from "../../../olt/scripts/src/cli/registry/index.ts";
import type { CommandSpec } from "../../../olt/scripts/src/cli/registry/types.ts";
import type { Flags } from "../../../olt/scripts/src/cli/options.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  isCognitiveValidatorRole,
  isMechanicValidatorRole,
  isExecutionCommand,
  isExecutionToolCategory,
  isProhibitedCognitiveTool,
  validateHierarchicalSpawning,
  assertHierarchicalSpawning,
  assertCognitiveValidatorHardlock,
  assertRoleMayInvoke,
  assertGrantedCommand,
} from "../../../olt/scripts/src/packets/command-authority.ts";
import {
  auditSingleRole,
  createRoleBoundaryWatchdog,
  validateParentChildSupervision,
  assertParentChildBoundary,
  type RoleBoundaryAction,
} from "../../../olt/scripts/src/mind/auditing/roles/index.ts";
import {
  isBoundaryLeakViolation,
  validateBoundaryIntegrity,
  assertNoBoundaryLeak,
  type BoundaryLeakCheck,
} from "../../../olt/scripts/src/validation/anti-leak/index.ts";
import { transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { emptyGrantRun } from "../packets/grant-run-fixture.ts";
import type { DynamicRoleSpec } from "../../../olt/scripts/src/mind/roles/dynamic/index.ts";

function spec(invocation: string): CommandSpec {
  const found = findCommand(invocation);
  if (!found) throw new Error(`Registry has no command named ${invocation}`);
  return found;
}

describe("Hierarchical Boundary Supervision & Cognitive Validator Hard-Lock", () => {
  describe("1. Hierarchical Parent-Child Boundary Supervision", () => {
    it("validates direct hierarchical spawning transitions across all 4 tiers", () => {
      // Tier 0 Mind -> Tier 1 Orchestrator
      const mindToOrch = validateHierarchicalSpawning("mind", "orchestrator");
      expect(mindToOrch.valid).toBe(true);
      expect(mindToOrch.parentTier).toBe(0);
      expect(mindToOrch.childTier).toBe(1);

      // Tier 0 Mind -> Tier 2 Coordinator [REJECT]
      const mindToCoord = validateHierarchicalSpawning("mind", "coordinator");
      expect(mindToCoord.valid).toBe(false);
      expect(mindToCoord.reason).toContain(
        "Tier 0 Mind (mind) may only dispatch Tier 1 Orchestrators",
      );

      // Tier 0 Mind -> Tier 3 Implementer [REJECT]
      const mindToImpl = validateHierarchicalSpawning("mind", "implementer");
      expect(mindToImpl.valid).toBe(false);

      // Tier 1 Orchestrator -> Tier 2 Coordinator
      const orchToCoord = validateHierarchicalSpawning("orchestrator", "coordinator");
      expect(orchToCoord.valid).toBe(true);
      expect(orchToCoord.parentTier).toBe(1);
      expect(orchToCoord.childTier).toBe(2);

      // Tier 1 Orchestrator -> Tier 0 Mind [REJECT]
      const orchToMind = validateHierarchicalSpawning("orchestrator", "mind");
      expect(orchToMind.valid).toBe(false);

      // Tier 1 Orchestrator -> Tier 3 Implementer [REJECT: must dispatch Coordinator]
      const orchToImpl = validateHierarchicalSpawning("orchestrator", "implementer");
      expect(orchToImpl.valid).toBe(false);
      expect(orchToImpl.reason).toContain(
        "Tier 1 Orchestrator (orchestrator) may only dispatch Tier 2 Coordinators",
      );

      // Tier 2 Coordinator -> Tier 3 Implementer / Validator / Critic / Repairer
      expect(validateHierarchicalSpawning("coordinator", "implementer").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "validator").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "completeness-critic").valid).toBe(true);
      expect(validateHierarchicalSpawning("coordinator", "repairer").valid).toBe(true);

      // Tier 2 Coordinator -> Tier 2 Coordinator [REJECT]
      expect(validateHierarchicalSpawning("coordinator", "coordinator").valid).toBe(false);

      // Tier 3 workers -> leaf execution workers [REJECT]
      expect(validateHierarchicalSpawning("implementer", "sub-worker").valid).toBe(false);
      expect(validateHierarchicalSpawning("validator", "sub-validator").valid).toBe(false);
      expect(validateHierarchicalSpawning("repairer", "sub-repairer").valid).toBe(false);
    });

    it("assertHierarchicalSpawning throws ROLE_CONFINEMENT_VIOLATION on cross-tier spawning", () => {
      expect(() =>
        assertHierarchicalSpawning("mind", "implementer", "mind-lead", "impl-1"),
      ).toThrow(HarnessError);

      expect(() =>
        assertHierarchicalSpawning("orchestrator", "validator", "orch-lead", "val-1"),
      ).toThrow("Hierarchical Parent-Child Boundary Violation");

      expect(() =>
        assertHierarchicalSpawning("implementer", "sub-worker", "impl-1", "sub-1"),
      ).toThrow("leaf execution worker");

      expect(() =>
        assertHierarchicalSpawning("orchestrator", "coordinator", "orch-1", "coord-1"),
      ).not.toThrow();
    });

    it("validateParentChildSupervision and assertParentChildBoundary in role-auditing maintain strict tier supervision", () => {
      expect(validateParentChildSupervision("mind", "orchestrator").valid).toBe(true);
      expect(validateParentChildSupervision("orchestrator", "coordinator").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "implementer").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "validator").valid).toBe(true);

      expect(validateParentChildSupervision("mind", "coordinator").valid).toBe(false);
      expect(validateParentChildSupervision("orchestrator", "implementer").valid).toBe(false);
      expect(validateParentChildSupervision("implementer", "sub-implementer").valid).toBe(false);

      expect(() =>
        assertParentChildBoundary("orchestrator", "implementer", "orch-1", "impl-1"),
      ).toThrow("Active Hierarchical Parent-Child Boundary Violation");
    });

    it("audits dynamic role specs for spawning hierarchy and parent role compliance", () => {
      // Valid Tier 0 Mind
      const validMindSpec: DynamicRoleSpec = {
        name: "test-mind",
        archetype: "tier_0_mind",
        tier: 0,
        title: "Test Mind",
        summary: "Mind supervisor",
        domain: "general",
        grantedCommands: ["mind:init", "whoami"],
        permittedActivities: ["Observe state"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["orchestrator"],
        cognitivePillars: ["Observational Integrity", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const mindFindings = auditSingleRole(validMindSpec);
      expect(mindFindings.some((f) => f.category === "spawning_hierarchy")).toBe(false);

      // Invalid Tier 0 Mind with cross-tier spawns
      const invalidMindSpec: DynamicRoleSpec = {
        ...validMindSpec,
        name: "invalid-mind",
        spawns: ["coordinator", "implementer"],
      };
      const invalidMindFindings = auditSingleRole(invalidMindSpec);
      expect(
        invalidMindFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN0"),
        ),
      ).toBe(true);

      // Invalid Tier 1 Orchestrator with cross-tier spawns
      const invalidOrchSpec: DynamicRoleSpec = {
        name: "invalid-orch",
        archetype: "tier_1_orchestrator",
        tier: 1,
        title: "Invalid Orch",
        summary: "Orchestrator lead",
        domain: "general",
        grantedCommands: ["plan:compile", "whoami"],
        permittedActivities: ["Compile plans"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["implementer", "validator"],
        cognitivePillars: ["Plan Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const invalidOrchFindings = auditSingleRole(invalidOrchSpec);
      expect(
        invalidOrchFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN1"),
        ),
      ).toBe(true);

      // Invalid Tier 2 Coordinator with supervisor spawns
      const invalidCoordSpec: DynamicRoleSpec = {
        name: "invalid-coord",
        archetype: "tier_2_coordinator",
        tier: 2,
        title: "Invalid Coord",
        summary: "Coordinator lead",
        domain: "general",
        grantedCommands: ["queue:pop", "whoami"],
        permittedActivities: ["Dispatch tasks"],
        prohibitedActions: ["Direct file write"],
        invariants: ["Zero-Tolerance"],
        spawns: ["orchestrator", "mind"],
        cognitivePillars: ["Queue Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "forbidden",
      };
      const invalidCoordFindings = auditSingleRole(invalidCoordSpec);
      expect(
        invalidCoordFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN2"),
        ),
      ).toBe(true);

      // Invalid Tier 3 Implementer with spawns (leaf violation)
      const invalidImplSpec: DynamicRoleSpec = {
        name: "invalid-impl",
        archetype: "tier_3_implementer",
        tier: 3,
        title: "Invalid Impl",
        summary: "Implementer worker",
        domain: "general",
        grantedCommands: ["task:claim", "task:submit", "whoami"],
        permittedActivities: ["Write code"],
        prohibitedActions: ["Run broad tests"],
        invariants: ["Zero-Tolerance"],
        spawns: ["sub-worker"],
        cognitivePillars: ["Code Discipline", "Zero-Any Discipline"],
        writeScopePolicy: "assigned_only",
      };
      const invalidImplFindings = auditSingleRole(invalidImplSpec);
      expect(
        invalidImplFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-SPAWN3"),
        ),
      ).toBe(true);

      // Invalid Tier 3 role with non-adjacent parentRole (e.g. parentRole: "mind")
      const invalidParentSpec: DynamicRoleSpec = {
        ...invalidImplSpec,
        name: "invalid-parent-impl",
        spawns: [],
        parentRole: "mind",
      };
      const invalidParentFindings = auditSingleRole(invalidParentSpec);
      expect(
        invalidParentFindings.some(
          (f) => f.category === "spawning_hierarchy" && f.id.startsWith("FIND-HIER-PARENT3"),
        ),
      ).toBe(true);
    });

    it("enforces hierarchical spawning in real-time RoleBoundaryWatchdog", () => {
      const watchdog = createRoleBoundaryWatchdog();

      // Tier 3 Leaf spawning
      const leafAction: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "spawning",
        targetRole: "sub-worker",
        targetTier: 3,
      };
      const leafViolation = watchdog.auditAction(leafAction);
      expect(leafViolation).not.toBeNull();
      expect(leafViolation?.violationType).toBe("leaf_spawning");
      expect(leafViolation?.severity).toBe("CRITICAL");

      // Tier 0 Mind cross-tier spawning (attempting to spawn implementer)
      const mindAction: RoleBoundaryAction = {
        agentId: "mind-1",
        role: "mind",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      const mindViolation = watchdog.auditAction(mindAction);
      expect(mindViolation).not.toBeNull();
      expect(mindViolation?.violationType).toBe("cross_tier_spawning");
      expect(mindViolation?.observation).toContain("Mind may only dispatch Tier 1 Orchestrators");

      // Tier 1 Orchestrator cross-tier spawning (attempting to spawn implementer directly)
      const orchAction: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      const orchViolation = watchdog.auditAction(orchAction);
      expect(orchViolation).not.toBeNull();
      expect(orchViolation?.violationType).toBe("cross_tier_spawning");
      expect(orchViolation?.observation).toContain(
        "Orchestrators may only dispatch Tier 2 Coordinators",
      );

      // Tier 2 Coordinator spawning Tier 3 Implementer [VALID]
      const validCoordAction: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "spawning",
        targetRole: "implementer",
        targetTier: 3,
      };
      expect(watchdog.auditAction(validCoordAction)).toBeNull();
    });

    it("enforces hierarchical spawning on agent:register in active capsule ledger", async () => {
      const { run } = await emptyGrantRun("hierarchical-reg-");
      transact(run, "test-setup", "grant-hierarchy", {}, (draft) => {
        draft.agents = [
          {
            id: "mind-lead",
            role: "mind",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "orch-lead",
            role: "orchestrator",
            parent_agent_id: "mind-lead",
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "coord-lead",
            role: "coordinator",
            parent_agent_id: "orch-lead",
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      // Valid registration: Coordinator registering Implementer
      const validRegFlags: Flags = {
        run,
        actor: "coord-lead",
        agent: "worker-1",
        role: "implementer",
        "parent-agent": "coord-lead",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), validRegFlags, {
          actor: "coord-lead",
          verified: true,
        }),
      ).not.toThrow();

      // Invalid registration: Orchestrator attempting to directly register Implementer
      const invalidOrchRegFlags: Flags = {
        run,
        actor: "orch-lead",
        agent: "worker-2",
        role: "implementer",
        "parent-agent": "orch-lead",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), invalidOrchRegFlags, {
          actor: "orch-lead",
          verified: true,
        }),
      ).toThrow("Hierarchical Parent-Child Boundary Violation");

      // Invalid registration: Tier 3 Implementer dispatched with no parent agent
      const orphanRegFlags: Flags = {
        run,
        actor: "mind-lead",
        agent: "worker-orphan",
        role: "implementer",
        host: "claude-code",
      };
      expect(() =>
        assertGrantedCommand(spec("agent:register"), orphanRegFlags, {
          actor: "mind-lead",
          verified: true,
        }),
      ).toThrow("Hierarchical supervision violation");
    });
  });

  describe("2. Cognitive Validator Hard-Lock Interlock", () => {
    const cognitiveValidatorRoles = [
      "validator",
      "ui-validator",
      "validator-code-quality",
      "validator-ui-design",
      "validator-security",
      "validator-product",
      "validator-system-design",
    ] as const;

    const mechanicValidatorRoles = [
      "mechanic-validator",
      "ui-mechanic-validator",
      "mechanic_validator",
    ] as const;

    it("correctly differentiates cognitive validators from mechanic validators", () => {
      for (const role of cognitiveValidatorRoles) {
        expect(isCognitiveValidatorRole(role)).toBe(true);
        expect(isMechanicValidatorRole(role)).toBe(false);
      }

      for (const role of mechanicValidatorRoles) {
        expect(isMechanicValidatorRole(role)).toBe(true);
        expect(isCognitiveValidatorRole(role)).toBe(false);
      }
    });

    it("prohibits cognitive validators from invoking run:exec via assertRoleMayInvoke", () => {
      const execSpec = spec("run:exec");
      expect(isExecutionCommand(execSpec)).toBe(true);

      for (const role of cognitiveValidatorRoles) {
        expect(() => assertRoleMayInvoke(role, execSpec, `${role}-agent`)).toThrow(
          "cognitive validators are strictly banned from executing bash/shell commands or running test suites",
        );
      }

      // Mechanic validator is permitted to execute run:exec
      expect(() =>
        assertRoleMayInvoke("mechanic-validator", execSpec, "mechanic-validator-agent"),
      ).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock via assertCognitiveValidatorHardlock helper", () => {
      expect(() => assertCognitiveValidatorHardlock("validator", "run:exec", "val-1")).toThrow(
        "Cognitive Validator Hard-Lock Interlock",
      );

      expect(() => assertCognitiveValidatorHardlock("ui-validator", "shell", "ui-val-1")).toThrow(
        "Cognitive Validator Hard-Lock Interlock",
      );

      expect(() =>
        assertCognitiveValidatorHardlock("validator-security", "test-runner", "sec-val"),
      ).toThrow("Cognitive Validator Hard-Lock Interlock");

      expect(() =>
        assertCognitiveValidatorHardlock("validator-code-quality", "run_command", "cq-val"),
      ).toThrow("Cognitive Validator Hard-Lock Interlock");

      // Mechanic validators do not throw
      expect(() =>
        assertCognitiveValidatorHardlock("mechanic-validator", "run:exec", "mech-1"),
      ).not.toThrow();
      expect(() =>
        assertCognitiveValidatorHardlock("ui-mechanic-validator", "test-runner", "ui-mech"),
      ).not.toThrow();
    });

    it("blocks prohibited tool categories and execution tools in assertGrantedCommand", async () => {
      const { run } = await emptyGrantRun("validator-hardlock-tools-");
      transact(run, "test-setup", "grant-validator", {}, (draft) => {
        draft.agents = [
          {
            id: "val-cog-1",
            role: "validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
          {
            id: "mech-val-1",
            role: "mechanic-validator",
            parent_agent_id: null,
            parent_task_id: null,
            host: "claude-code",
            granted_at: new Date().toISOString(),
            status: "active",
          },
        ];
      });

      const prohibitedCategories = [
        "shell",
        "test-runner",
        "build",
        "package-manager",
        "bash",
        "terminal",
      ];
      for (const cat of prohibitedCategories) {
        expect(isExecutionToolCategory(cat)).toBe(true);
        const flags: Flags = {
          run,
          validator: "val-cog-1",
          "tool-category": cat,
        };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, {
            actor: "val-cog-1",
            verified: true,
          }),
        ).toThrow("may not invoke execution tool category");
      }

      const prohibitedTools = ["run_command", "bash", "sh", "test_runner", "bun_test"];
      for (const tool of prohibitedTools) {
        expect(isProhibitedCognitiveTool(tool)).toBe(true);
        const flags: Flags = {
          run,
          validator: "val-cog-1",
          tool,
        };
        expect(() =>
          assertGrantedCommand(spec("task:probe"), flags, {
            actor: "val-cog-1",
            verified: true,
          }),
        ).toThrow("may not invoke execution tool");
      }

      // Mechanic validator invoking execution tool category succeeds
      const mechFlags: Flags = {
        run,
        actor: "mech-val-1",
        "tool-category": "test-runner",
      };
      expect(() =>
        assertGrantedCommand(spec("run:exec"), mechFlags, {
          actor: "mech-val-1",
          verified: true,
        }),
      ).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock in validation/anti-leak", () => {
      const cogChecks: BoundaryLeakCheck[] = [
        {
          agent_id: "validator-1",
          role: "validator",
          action: "run:exec",
          task_id: "task-1",
        },
        {
          agent_id: "ui-validator-1",
          role: "ui-validator",
          action: "bun test tests/unit/auth.test.ts",
          task_id: "task-2",
        },
        {
          agent_id: "val-security",
          role: "validator-security",
          action: "task:probe",
          metadata: { tool_category: "shell" },
          task_id: "task-3",
        },
      ];

      for (const check of cogChecks) {
        expect(isBoundaryLeakViolation(check)).toBe(true);
        const res = validateBoundaryIntegrity(check);
        expect(res.valid).toBe(false);
        expect(res.violations.length).toBeGreaterThan(0);
        expect(res.violations[0]?.violation_type).toBe("validator_hardlock_violation");
        expect(res.violations[0]?.severity).toBe("critical");
        expect(res.violations[0]?.observation).toContain("Cognitive Validator Hard-Lock Violation");
        expect(() => assertNoBoundaryLeak(check)).toThrow(HarnessError);
      }

      // Mechanic validator executing test command does not trigger boundary leak violation
      const mechCheck: BoundaryLeakCheck = {
        agent_id: "mechanic-val-1",
        role: "mechanic-validator",
        action: "bun test tests/unit/auth.test.ts",
        task_id: "task-1",
      };
      expect(isBoundaryLeakViolation(mechCheck)).toBe(false);
      expect(validateBoundaryIntegrity(mechCheck).valid).toBe(true);
      expect(() => assertNoBoundaryLeak(mechCheck)).not.toThrow();
    });

    it("enforces Cognitive Validator Hard-Lock in RoleBoundaryWatchdog", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const cogAction: RoleBoundaryAction = {
        agentId: "val-cog-1",
        role: "validator",
        actionType: "test_run",
        argv: ["bun", "test", "tests/unit/example.test.ts"],
      };

      const violation = watchdog.auditAction(cogAction);
      expect(violation).not.toBeNull();
      expect(violation?.invariant).toBe("validator_hardlock");
      expect(violation?.violationType).toBe("validator_hardlock_violation");
      expect(violation?.severity).toBe("CRITICAL");
      expect(violation?.observation).toContain("Cognitive Validator Hard-Lock Violation");

      // Mechanic validator executing test does not violate watchdog
      const mechAction: RoleBoundaryAction = {
        agentId: "mech-val-1",
        role: "mechanic-validator",
        actionType: "command_exec",
        argv: ["bun", "test", "tests/unit/example.test.ts"],
      };
      expect(watchdog.auditAction(mechAction)).toBeNull();
    });
  });

  describe("3. Static Code Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
    const filesToAudit = [
      "olt/scripts/src/mind/auditing/roles/index.ts",
      "olt/scripts/src/packets/command-authority.ts",
      "olt/scripts/src/validation/anti-leak/index.ts",
    ];

    it("verifies zero TypeScript any and zero compiler/linter suppressions across touched files", () => {
      const anyTypeRegex = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>|Record<string,\\s*any>");
      const suppressionRegex = new RegExp(
        [
          "@ts" + "-ignore",
          "@ts" + "-expect-error",
          "@ts" + "-nocheck",
          "eslint" + "-disable",
          "oxlint" + "-disable",
          "biome" + "-ignore",
        ].join("|"),
      );

      for (const relativePath of filesToAudit) {
        const content = readFileSync(relativePath, "utf8");
        const lines = content.split("\n");

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i]!;
          if (line.includes("anyTypeRegex") || line.includes("suppressionRegex")) continue;

          expect(anyTypeRegex.test(line)).toBe(false);
          expect(suppressionRegex.test(line)).toBe(false);
        }
      }
    });
  });
});
