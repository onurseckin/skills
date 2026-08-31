import { describe, it, expect } from "bun:test";
import {
  RoleBoundaryWatchdog,
  createRoleBoundaryWatchdog,
  verifyRoleBoundaryAction,
  auditRoleBoundaryActions,
  validateParentChildSupervision,
  assertParentChildBoundary,
  isMindRole,
  isOrchestratorRole,
  isCoordinatorRole,
  isImplementerRole,
  isValidatorRole,
  isMechanicValidatorRole,
  isCognitiveValidatorRole,
  isFullTestSuiteCommand,
  roleToTier,
  type RoleBoundaryAction,
} from "../../olt/scripts/src/mind/auditing/roles/index.ts";
import { HarnessError } from "../../olt/scripts/src/core/errors/index.ts";

describe("mind/role-auditing > RoleBoundaryWatchdog and Zero-Tolerance Invariants", () => {
  describe("Role classification predicates and tier detection", () => {
    it("classifies mind roles and tiers", () => {
      expect(isMindRole("mind")).toBe(true);
      expect(isMindRole("mind-pulse")).toBe(true);
      expect(isMindRole("worker")).toBe(false);
      expect(roleToTier("mind")).toBe(0);
    });

    it("classifies orchestrator roles and tiers", () => {
      expect(isOrchestratorRole("orchestrator")).toBe(true);
      expect(isOrchestratorRole("orch-lead")).toBe(true);
      expect(isOrchestratorRole("worker")).toBe(false);
      expect(roleToTier("orchestrator")).toBe(1);
    });

    it("classifies coordinator roles and tiers", () => {
      expect(isCoordinatorRole("coordinator")).toBe(true);
      expect(isCoordinatorRole("coord-1")).toBe(true);
      expect(isCoordinatorRole("worker")).toBe(false);
      expect(roleToTier("coordinator")).toBe(2);
    });

    it("classifies implementer roles and tiers", () => {
      expect(isImplementerRole("implementer")).toBe(true);
      expect(isImplementerRole("repairer")).toBe(true);
      expect(isImplementerRole("sub-implementer")).toBe(true);
      expect(isImplementerRole("worker")).toBe(true);
      expect(isImplementerRole("impl-1")).toBe(true);
      expect(roleToTier("implementer")).toBe(3);
    });

    it("classifies validator roles (mechanic vs cognitive)", () => {
      expect(isValidatorRole("validator")).toBe(true);
      expect(isValidatorRole("sub-validator")).toBe(true);
      expect(isValidatorRole("completeness-critic")).toBe(true);
      expect(isValidatorRole("mind-auditor")).toBe(true);

      expect(isMechanicValidatorRole("mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("ui-mechanic-validator")).toBe(true);
      expect(isMechanicValidatorRole("mechanic_validator")).toBe(true);
      expect(isMechanicValidatorRole("validator")).toBe(false);

      expect(isCognitiveValidatorRole("validator")).toBe(true);
      expect(isCognitiveValidatorRole("ui-validator")).toBe(true);
      expect(isCognitiveValidatorRole("mechanic-validator")).toBe(false);
    });

    it("identifies full test suite commands", () => {
      expect(isFullTestSuiteCommand([])).toBe(false);
      expect(isFullTestSuiteCommand(["bun", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "run", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "run", "test:unit"])).toBe(true);
      expect(isFullTestSuiteCommand(["npm", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["yarn", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["pnpm", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["pytest"])).toBe(true);
      expect(isFullTestSuiteCommand(["vitest"])).toBe(true);
      expect(isFullTestSuiteCommand(["cargo", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["go", "test", "./..."])).toBe(true);

      // Single file test command is NOT full test suite
      expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/mind/foo.test.ts"])).toBe(false);
      expect(isFullTestSuiteCommand(["npm", "test", "test_file.spec.js"])).toBe(false);
    });
  });

  describe("RoleBoundaryWatchdog Invariant Verification", () => {
    it("enforces 0 coordinator code writing invariant", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const editAction: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "tool_use",
        toolName: "replace_file_content",
      };
      const v1 = watchdog.auditAction(editAction);
      expect(v1).not.toBeNull();
      expect(v1?.invariant).toBe("0_coordinator_code_writing");
      expect(v1?.violationType).toBe("coordinator_code_writing");

      const leaseAction: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "task_lease",
        taskId: "task-001",
      };
      const v2 = watchdog.auditAction(leaseAction);
      expect(v2).not.toBeNull();
      expect(v2?.invariant).toBe("0_coordinator_code_writing");

      const fileWriteAction: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "file_write",
        targetFile: "src/app.ts",
      };
      const v3 = watchdog.auditAction(fileWriteAction);
      expect(v3).not.toBeNull();
    });

    it("enforces 0 orchestrator task implementation invariant", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const orchAction: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "command_exec",
        taskId: "task-100",
        argv: ["task:claim"],
      };
      const v1 = watchdog.auditAction(orchAction);
      expect(v1).not.toBeNull();
      expect(v1?.invariant).toBe("0_orchestrator_task_implementation");

      const orchGraphAction: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "graph_mutation",
      };
      const v2 = watchdog.auditAction(orchGraphAction);
      expect(v2).not.toBeNull();
    });

    it("enforces 0 unassigned test running invariant", () => {
      const watchdog = createRoleBoundaryWatchdog();

      // Supervisory agent running test
      const supervisorTest: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "test_run",
        argv: ["bun", "test"],
      };
      const v1 = watchdog.auditAction(supervisorTest);
      expect(v1).not.toBeNull();
      expect(v1?.invariant).toBe("0_unassigned_test_running");

      // Implementer running full test suite
      const implFullSuite: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "test_run",
        argv: ["bun", "test"],
      };
      const v2 = watchdog.auditAction(implFullSuite);
      expect(v2).not.toBeNull();
      expect(v2?.invariant).toBe("0_unassigned_test_running");

      // Implementer running unassigned test file
      const implUnassigned: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "test_run",
        argv: ["bun", "test", "tests/unit/other.test.ts"],
        assignedTestFiles: ["tests/unit/assigned.test.ts"],
      };
      const v3 = watchdog.auditAction(implUnassigned);
      expect(v3).not.toBeNull();
      expect(v3?.invariant).toBe("0_unassigned_test_running");

      // Implementer running assigned test file passes
      const implAssigned: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "test_run",
        argv: ["bun", "test", "tests/unit/assigned.test.ts"],
        assignedTestFiles: ["tests/unit/assigned.test.ts"],
      };
      const v4 = watchdog.auditAction(implAssigned);
      expect(v4).toBeNull();
    });

    it("enforces anti-boundary leak for validators and implementers", () => {
      const watchdog = createRoleBoundaryWatchdog();

      // Validator write attempt
      const valWrite: RoleBoundaryAction = {
        agentId: "val-1",
        role: "validator",
        actionType: "file_write",
        targetFile: "src/code.ts",
      };
      const v1 = watchdog.auditAction(valWrite);
      expect(v1).not.toBeNull();
      expect(v1?.invariant).toBe("anti_boundary_leak");

      // Implementer self-grading with validation command
      const implSelfGrade: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "command_exec",
        argv: ["task:review", "--result", "pass"],
      };
      const v2 = watchdog.auditAction(implSelfGrade);
      expect(v2).not.toBeNull();
      expect(v2?.invariant).toBe("anti_boundary_leak");
    });

    it("enforces cognitive validator hardlock interlock", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const cogValExec: RoleBoundaryAction = {
        agentId: "val-1",
        role: "validator",
        actionType: "command_exec",
        toolName: "run_command",
        argv: ["bun", "test"],
      };
      const v = watchdog.auditAction(cogValExec);
      expect(v).not.toBeNull();
      expect(v?.invariant).toBe("validator_hardlock");

      // Mechanic validator is allowed
      const mechValExec: RoleBoundaryAction = {
        agentId: "mech-1",
        role: "mechanic-validator",
        actionType: "command_exec",
        toolName: "run_command",
        argv: ["bun", "test", "tests/unit/mind/foo.test.ts"],
      };
      const vMech = watchdog.auditAction(mechValExec);
      expect(vMech).toBeNull();
    });

    it("enforces spawning hierarchy invariants across all tiers", () => {
      const watchdog = createRoleBoundaryWatchdog();

      // Tier 3 Leaf spawning
      const leafSpawn: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "spawning",
        targetRole: "sub-worker",
      };
      const v1 = watchdog.auditAction(leafSpawn);
      expect(v1?.violationType).toBe("leaf_spawning");

      // Tier 0 Mind spawning non-orchestrator
      const mindSpawn: RoleBoundaryAction = {
        agentId: "mind-1",
        role: "mind",
        actionType: "spawning",
        targetRole: "coordinator",
      };
      const v2 = watchdog.auditAction(mindSpawn);
      expect(v2?.violationType).toBe("cross_tier_spawning");

      // Tier 1 Orchestrator spawning non-coordinator
      const orchSpawn: RoleBoundaryAction = {
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "spawning",
        targetRole: "implementer",
      };
      const v3 = watchdog.auditAction(orchSpawn);
      expect(v3?.violationType).toBe("cross_tier_spawning");

      // Tier 2 Coordinator spawning non-tier-3
      const coordSpawn: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "spawning",
        targetRole: "orchestrator",
      };
      const v4 = watchdog.auditAction(coordSpawn);
      expect(v4?.violationType).toBe("cross_tier_spawning");
    });

    it("detects forbidden commands orchestrator:run and supervisory task:claim", () => {
      const watchdog = createRoleBoundaryWatchdog();

      const orchRun: RoleBoundaryAction = {
        agentId: "agent-1",
        role: "worker",
        actionType: "command_exec",
        argv: ["orchestrator:run"],
      };
      const v1 = watchdog.auditAction(orchRun);
      expect(v1?.violationType).toBe("forbidden_command_execution");

      const superClaim: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "command_exec",
        argv: ["task:claim", "--task", "t1"],
      };
      const v2 = watchdog.auditAction(superClaim);
      expect(v2?.violationType).toBe("supervisory_task_claim");
    });

    it("supports strictZeroTolerance throwing HarnessError", () => {
      const watchdog = createRoleBoundaryWatchdog({ strictZeroTolerance: true });

      const coordEdit: RoleBoundaryAction = {
        agentId: "coord-1",
        role: "coordinator",
        actionType: "tool_use",
        toolName: "replace_file_content",
      };

      expect(() => watchdog.auditAction(coordEdit)).toThrow(HarnessError);
    });

    it("supports autoLogDefect and custom defect logger", () => {
      let logged = false;
      const watchdog = createRoleBoundaryWatchdog({
        autoLogDefect: true,
        defectLogger: (v) => {
          logged = true;
          return {
            id: `def-${v.id}`,
            category: "boundary_violation",
            severity: "critical",
            type: "role_violation",
            timestamp: new Date().toISOString(),
            status: "open",
            count: 1,
            observation: v.observation,
            remediation: v.remediation,
            occurrences: [],
          };
        },
      });

      const violation = watchdog.auditAction({
        agentId: "orch-1",
        role: "orchestrator",
        actionType: "command_exec",
        argv: ["task:claim"],
      });

      expect(violation?.defectEntry).toBeDefined();
      expect(logged).toBe(true);
    });

    it("audits batch actions and formats violation reports", () => {
      const watchdog = createRoleBoundaryWatchdog();
      const actions: RoleBoundaryAction[] = [
        {
          agentId: "coord-1",
          role: "coordinator",
          actionType: "tool_use",
          toolName: "replace_file_content",
        },
        {
          agentId: "impl-1",
          role: "implementer",
          actionType: "tool_use",
          toolName: "replace_file_content",
        },
      ];

      const res = watchdog.auditActions(actions);
      expect(res.valid).toBe(false);
      expect(res.violations.length).toBe(1);
      expect(res.actionsAuditedCount).toBe(2);

      const report = watchdog.formatViolationReport();
      expect(report).toContain("ACTION REQUIRED");

      const compact = watchdog.formatViolationReport({ compact: true });
      expect(compact).toContain("ACTION REQUIRED");

      expect(watchdog.getViolations().length).toBe(1);
      watchdog.clearViolations();
      expect(watchdog.getViolations().length).toBe(0);

      const cleanReport = watchdog.formatViolationReport();
      expect(cleanReport).toContain("ZERO VIOLATIONS");
    });

    it("audits snapshot state object", () => {
      const watchdog = createRoleBoundaryWatchdog();
      const cleanState = {
        agents: [
          { id: "orch-1", role: "orchestrator" },
          { id: "coord-1", role: "coordinator", parent_agent_id: "orch-1" },
        ],
        commands: {},
        tasks: {},
      };

      const resultClean = watchdog.auditState(cleanState);
      expect(resultClean.valid).toBe(true);

      const nonObject = watchdog.auditState(null);
      expect(nonObject.valid).toBe(true);
    });
  });

  describe("Parent-Child Supervision Boundaries", () => {
    it("validates valid hierarchical transitions", () => {
      expect(validateParentChildSupervision("mind", "orchestrator").valid).toBe(true);
      expect(validateParentChildSupervision("orchestrator", "coordinator").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "implementer").valid).toBe(true);
      expect(validateParentChildSupervision("coordinator", "validator").valid).toBe(true);
    });

    it("invalidates illegal hierarchical transitions", () => {
      expect(validateParentChildSupervision("mind", "coordinator").valid).toBe(false);
      expect(validateParentChildSupervision("orchestrator", "implementer").valid).toBe(false);
      expect(validateParentChildSupervision("implementer", "sub-worker").valid).toBe(false);
    });

    it("assertParentChildBoundary passes for valid and throws HarnessError for invalid", () => {
      expect(() =>
        assertParentChildBoundary("orchestrator", "coordinator", "orch-1", "coord-1"),
      ).not.toThrow();

      expect(() =>
        assertParentChildBoundary("orchestrator", "implementer", "orch-1", "impl-1"),
      ).toThrow(HarnessError);
    });

    it("standalone helper functions verifyRoleBoundaryAction and auditRoleBoundaryActions work", () => {
      const action: RoleBoundaryAction = {
        agentId: "impl-1",
        role: "implementer",
        actionType: "tool_use",
        toolName: "replace_file_content",
      };

      const res1 = verifyRoleBoundaryAction(action);
      expect(res1).toBeNull();

      const res2 = auditRoleBoundaryActions([action]);
      expect(res2.valid).toBe(true);
    });
  });
});
