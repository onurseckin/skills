import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  DOCTOR_SUPERVISOR_CODE_CONTAMINATION,
  isMindRole,
  isCoordinatorRole,
  isOrchestratorRole,
  isImplementerRole,
  isValidatorRole,
  isTier3Role,
  isFullTestSuiteCommand,
  isSourceCodeFile,
  auditCrossTierSpawning,
  auditCoordinatorConfinement,
  auditOrchestratorConfinement,
  auditImplementerConfinement,
  auditPulseTerminationConfinement,
  auditSupervisorCodeContamination,
  auditTierConfinement,
  summarizeTierConfinement,
  assertSupervisorRoleConfinement,
  type TierConfinementFinding,
} from "../../../olt/scripts/src/reporting/doctor/tier-confinement.ts";
import * as DoctorIndex from "../../../olt/scripts/src/reporting/doctor/index.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { CommandRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { TaskRecord } from "../../../olt/scripts/src/workflow/types.ts";
import type { JsonObject } from "../../../olt/scripts/src/core/contracts/index.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

const SCRATCH_DIR = resolve(join(process.cwd(), "coverage", "scratch", "tier-confinement-tests"));

describe("doctor/tier-confinement and doctor/index", () => {
  beforeEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
    mkdirSync(SCRATCH_DIR, { recursive: true });
  });

  afterEach(() => {
    rmSync(SCRATCH_DIR, { recursive: true, force: true });
  });

  it("exports doctor index modules correctly", () => {
    expect(DoctorIndex.verifyStrictRepositoryCapsuleRoot).toBeDefined();
    expect(DoctorIndex.verifyUnifiedEvidenceLocation).toBeDefined();
    expect(DoctorIndex.auditTierConfinement).toBeDefined();
  });

  describe("Role predicate helpers", () => {
    it("identifies Mind roles", () => {
      expect(isMindRole("mind")).toBe(true);
      expect(isMindRole("mind-planner")).toBe(true);
      expect(isMindRole("coordinator")).toBe(false);
    });

    it("identifies Coordinator roles", () => {
      expect(isCoordinatorRole("coordinator")).toBe(true);
      expect(isCoordinatorRole("coordinator-1")).toBe(true);
      expect(isCoordinatorRole("coord-core")).toBe(true);
      expect(isCoordinatorRole("implementer")).toBe(false);
    });

    it("identifies Orchestrator roles", () => {
      expect(isOrchestratorRole("orchestrator")).toBe(true);
      expect(isOrchestratorRole("orch-loop")).toBe(true);
      expect(isOrchestratorRole("orchestrator-main")).toBe(true);
      expect(isOrchestratorRole("mind")).toBe(false);
    });

    it("identifies Implementer roles", () => {
      expect(isImplementerRole("implementer")).toBe(true);
      expect(isImplementerRole("repairer")).toBe(true);
      expect(isImplementerRole("sub-implementer")).toBe(true);
      expect(isImplementerRole("worker")).toBe(true);
      expect(isImplementerRole("validator")).toBe(false);
    });

    it("identifies Validator roles", () => {
      expect(isValidatorRole("validator")).toBe(true);
      expect(isValidatorRole("sub-validator")).toBe(true);
      expect(isValidatorRole("plan-validator")).toBe(true);
      expect(isValidatorRole("completeness-critic")).toBe(true);
      expect(isValidatorRole("mind-auditor")).toBe(true);
      expect(isValidatorRole("implementer")).toBe(false);
    });

    it("identifies Tier 3 roles", () => {
      expect(isTier3Role("implementer")).toBe(true);
      expect(isTier3Role("validator")).toBe(true);
      expect(isTier3Role("planner")).toBe(true);
      expect(isTier3Role("sub-investigator")).toBe(true);
      expect(isTier3Role("coordinator")).toBe(false);
    });
  });

  describe("isFullTestSuiteCommand", () => {
    it("returns false for empty argv", () => {
      expect(isFullTestSuiteCommand([])).toBe(false);
    });

    it("detects exact and coverage full test commands", () => {
      expect(isFullTestSuiteCommand(["bun", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "run", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "test", "--coverage"])).toBe(true);
      expect(isFullTestSuiteCommand(["npm", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["npm", "run", "test:unit"])).toBe(true);
      expect(isFullTestSuiteCommand(["yarn", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["pnpm", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["pytest"])).toBe(true);
      expect(isFullTestSuiteCommand(["vitest"])).toBe(true);
      expect(isFullTestSuiteCommand(["cargo", "test"])).toBe(true);
      expect(isFullTestSuiteCommand(["go", "test", "./..."])).toBe(true);
    });

    it("detects test runners targeting whole directories vs single test files", () => {
      expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/"])).toBe(true);
      expect(isFullTestSuiteCommand(["bun", "test", "tests/unit/foo.test.ts"])).toBe(false);
      expect(isFullTestSuiteCommand(["npm", "run", "test", "--", "tests/unit/foo.spec.ts"])).toBe(
        false,
      );
      expect(isFullTestSuiteCommand(["jest", "tests/unit/bar.spec.tsx"])).toBe(false);
      expect(isFullTestSuiteCommand(["pytest", "test_feature.py"])).toBe(false);
    });

    it("returns false for non-test commands", () => {
      expect(isFullTestSuiteCommand(["bun", "run", "build"])).toBe(false);
      expect(isFullTestSuiteCommand(["git", "status"])).toBe(false);
    });
  });

  describe("isSourceCodeFile", () => {
    it("returns false for capsule files", () => {
      expect(isSourceCodeFile(".capsules/run-1/manifest.json")).toBe(false);
      expect(isSourceCodeFile("/repo/.capsules/run-1/evidence/file.txt")).toBe(false);
    });

    it("identifies code files inside and outside src", () => {
      expect(isSourceCodeFile("src/index.ts")).toBe(true);
      expect(isSourceCodeFile("scripts/src/runner.js")).toBe(true);
      expect(isSourceCodeFile("core/engine.py")).toBe(true);
      expect(isSourceCodeFile("native/lib.rs")).toBe(true);
      expect(isSourceCodeFile("scripts/build.sh")).toBe(true);
    });

    it("identifies non-code documentation and metadata files", () => {
      expect(isSourceCodeFile("README.md")).toBe(false);
      expect(isSourceCodeFile("config.json")).toBe(false);
      expect(isSourceCodeFile("schema.yaml")).toBe(false);
      expect(isSourceCodeFile("notes.txt")).toBe(false);
      expect(isSourceCodeFile("scripts/src/schema.json")).toBe(true);
      expect(isSourceCodeFile("packages/src/docs.md")).toBe(true);
    });
  });

  describe("auditCrossTierSpawning", () => {
    it("flags invalid direct cross-tier spawning", () => {
      const roleMap = new Map<string, string>([
        ["orch-1", "orchestrator"],
        ["impl-1", "implementer"],
      ]);
      const grants: AgentGrantRecord[] = [
        {
          id: "impl-1",
          role: "implementer",
          parent_agent_id: "orch-1",
          registered_at: "2026-08-24T00:00:00Z",
          status: "active",
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditCrossTierSpawning(roleMap, grants, findings);

      expect(findings.length).toBe(1);
      expect(findings[0]?.violation_type).toBe("cross_tier_spawning_violation");
      expect(findings[0]?.severity).toBe("critical");
      expect(findings[0]?.evidence?.parent_role).toBe("orchestrator");
    });

    it("allows valid hierarchy spawning (Coordinator -> Implementer)", () => {
      const roleMap = new Map<string, string>([
        ["coord-1", "coordinator"],
        ["impl-1", "implementer"],
      ]);
      const grants: AgentGrantRecord[] = [
        {
          id: "impl-1",
          role: "implementer",
          parent_agent_id: "coord-1",
          registered_at: "2026-08-24T00:00:00Z",
          status: "active",
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditCrossTierSpawning(roleMap, grants, findings);

      expect(findings.length).toBe(0);
    });
  });

  describe("auditCoordinatorConfinement", () => {
    it("flags coordinator tool usage and grants for file editing", () => {
      const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
      const grants: AgentGrantRecord[] = [
        {
          id: "coord-1",
          role: "coordinator",
          registered_at: "2026-08-24T00:00:00Z",
          status: "active",
          tools_used: [
            {
              name: "write_to_file",
              category: "file-edit",
              count: 1,
              first_reported_at: "2026-08-24T00:00:00Z",
            },
          ],
          tools_granted: {
            evidence_class: "harness_observed",
            value: [{ name: "edit_file", category: "file-edit" }],
          },
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditCoordinatorConfinement(roleMap, grants, [], [], findings);

      expect(findings.length).toBe(2);
      expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
      expect(findings[1]?.violation_type).toBe("coordinator_code_writing");
    });

    it("flags coordinator executing file edit commands and full test suites", () => {
      const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
      const commands: CommandRecord[] = [
        {
          id: "cmd-edit",
          actor: "coord-1",
          status: "succeeded",
          task_id: null,
          tool: "write_to_file",
          argv: ["write_to_file", "src/foo.ts"],
        },
        {
          id: "cmd-full-test",
          actor: "coord-1",
          status: "succeeded",
          task_id: null,
          argv: ["bun", "test"],
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditCoordinatorConfinement(roleMap, [], commands, [], findings);

      expect(findings.some((f) => f.violation_type === "coordinator_code_writing")).toBe(true);
      expect(findings.some((f) => f.violation_type === "role_confinement_violation")).toBe(true);
    });

    it("flags coordinator holding implementation task lease", () => {
      const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
      const tasks: TaskRecord[] = [
        {
          id: "task-1",
          type: "task",
          status: "leased",
          label: "Task 1",
          effort: 1,
          priority: 50,
          created_order: 1,
          dependencies: [],
          write_scope: ["src/**"],
          requirement_ids: [],
          resource_scope: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "coord-1",
            role: "coordinator",
            attempt: 1,
            issued_at: "2026-08-24T00:00:00Z",
            expires_at: "2026-08-24T01:00:00Z",
            heartbeat_at: "2026-08-24T00:00:00Z",
            duration_seconds: 3600,
            write_scope: ["src/**"],
            resource_scope: [],
            token_digest: "0".repeat(64),
            write_scope_content_hash: { evidence_class: "harness_observed", value: "0".repeat(64) },
          },
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditCoordinatorConfinement(roleMap, [], [], tasks, findings);

      expect(findings.length).toBe(1);
      expect(findings[0]?.violation_type).toBe("coordinator_code_writing");
    });
  });

  describe("auditOrchestratorConfinement", () => {
    it("flags orchestrator file-editing tool usage and task lease holding", () => {
      const roleMap = new Map<string, string>([["orch-1", "orchestrator"]]);
      const grants: AgentGrantRecord[] = [
        {
          id: "orch-1",
          role: "orchestrator",
          registered_at: "2026-08-24T00:00:00Z",
          status: "active",
          tools_used: [
            {
              name: "patch",
              category: "file-edit",
              count: 1,
              first_reported_at: "2026-08-24T00:00:00Z",
            },
          ],
        },
      ];
      const tasks: TaskRecord[] = [
        {
          id: "task-2",
          type: "task",
          status: "leased",
          label: "Task 2",
          effort: 1,
          priority: 50,
          created_order: 1,
          dependencies: [],
          write_scope: [],
          requirement_ids: [],
          resource_scope: [],
          attempts: [],
          history: [],
          repair_round: 0,
          lease: {
            agent_id: "orch-1",
            role: "orchestrator",
            attempt: 1,
            issued_at: "2026-08-24T00:00:00Z",
            expires_at: "2026-08-24T01:00:00Z",
            heartbeat_at: "2026-08-24T00:00:00Z",
            duration_seconds: 3600,
            write_scope: [],
            resource_scope: [],
            token_digest: "0".repeat(64),
            write_scope_content_hash: { evidence_class: "harness_observed", value: "0".repeat(64) },
          },
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditOrchestratorConfinement(roleMap, grants, [], tasks, findings);

      expect(findings.length).toBe(2);
      expect(findings[0]?.violation_type).toBe("orchestrator_direct_implementation");
      expect(findings[1]?.violation_type).toBe("orchestrator_direct_implementation");
    });

    it("flags orchestrator executing task commands, graph mutations, and full tests", () => {
      const roleMap = new Map<string, string>([["orch-1", "orchestrator"]]);
      const commands: CommandRecord[] = [
        {
          id: "cmd-task-bound",
          actor: "orch-1",
          status: "succeeded",
          task_id: "task-1",
          argv: ["echo", "test"],
        },
        {
          id: "cmd-graph-mutation",
          actor: "orch-1",
          status: "succeeded",
          task_id: null,
          argv: ["bun", "harness.ts", "plan:compile"],
        },
        {
          id: "cmd-file-edit",
          actor: "orch-1",
          status: "succeeded",
          task_id: null,
          tool_category: "file-edit",
          argv: ["edit"],
        },
        {
          id: "cmd-full-test",
          actor: "orch-1",
          status: "succeeded",
          task_id: null,
          argv: ["pytest"],
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditOrchestratorConfinement(roleMap, [], commands, [], findings);

      expect(findings.length).toBe(4);
    });
  });

  describe("auditImplementerConfinement", () => {
    it("flags implementer self-grading on previously implemented tasks", () => {
      const roleMap = new Map<string, string>([["impl-1", "implementer"]]);
      const tasks: TaskRecord[] = [
        {
          id: "task-self-grade",
          type: "task",
          status: "done",
          label: "Task SG",
          effort: 1,
          priority: 50,
          created_order: 1,
          dependencies: [],
          write_scope: [],
          requirement_ids: [],
          resource_scope: [],
          original_implementer: "impl-1",
          attempts: [],
          history: [],
          repair_round: 0,
          validations: [
            {
              validator_id: "impl-1",
              domain: "code-quality",
              attempt: 1,
              verdict: "pass",
              findings: [],
              started_at: "2026-08-24T00:00:00Z",
              completed_at: "2026-08-24T00:01:00Z",
            },
          ],
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditImplementerConfinement(roleMap, tasks, [], [], findings);

      expect(findings.length).toBe(1);
      expect(findings[0]?.violation_type).toBe("implementer_self_grading");
    });

    it("flags implementer executing validation and graph mutation commands/events", () => {
      const roleMap = new Map<string, string>([["impl-1", "implementer"]]);
      const commands: CommandRecord[] = [
        {
          id: "cmd-val",
          actor: "impl-1",
          status: "succeeded",
          task_id: null,
          argv: ["bun", "harness.ts", "task:review"],
        },
        {
          id: "cmd-graph",
          actor: "impl-1",
          status: "succeeded",
          task_id: null,
          argv: ["bun", "harness.ts", "plan:add"],
        },
      ];
      const events: JsonObject[] = [
        {
          kind: "plan-compiled",
          actor: "impl-1",
          sequence: 1,
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditImplementerConfinement(roleMap, [], commands, events, findings);

      expect(findings.some((f) => f.violation_type === "implementer_self_grading")).toBe(true);
      expect(findings.filter((f) => f.violation_type === "implementer_graph_mutation").length).toBe(
        2,
      );
    });

    it("flags implementer self-grading when implementer ID is found in attempts or history", () => {
      const roleMap = new Map<string, string>([
        ["impl-attempt", "implementer"],
        ["impl-hist", "implementer"],
      ]);
      const tasks: TaskRecord[] = [
        {
          id: "task-attempt-sg",
          type: "task",
          status: "done",
          label: "Task SG 2",
          effort: 1,
          priority: 50,
          created_order: 1,
          dependencies: [],
          write_scope: [],
          requirement_ids: [],
          resource_scope: [],
          attempts: [
            {
              agent_id: "impl-attempt",
              role: "implementer",
              attempt: 1,
              kind: "implementation",
              started_at: "2026-08-24T00:00:00Z",
            },
          ],
          history: [
            {
              actor: "impl-hist",
              at: "2026-08-24T00:00:00Z",
              from: "ready",
              to: "leased",
              reason: "claimed",
            },
          ],
          repair_round: 0,
          validations: [
            {
              validator_id: "impl-attempt",
              domain: "code-quality",
              attempt: 1,
              verdict: "pass",
              findings: [],
              started_at: "2026-08-24T00:00:00Z",
              completed_at: "2026-08-24T00:01:00Z",
            },
            {
              validator_id: "impl-hist",
              domain: "code-quality",
              attempt: 1,
              verdict: "pass",
              findings: [],
              started_at: "2026-08-24T00:00:00Z",
              completed_at: "2026-08-24T00:01:00Z",
            },
          ],
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditImplementerConfinement(roleMap, tasks, [], [], findings);

      expect(findings.length).toBe(2);
      expect(findings.every((f) => f.violation_type === "implementer_self_grading")).toBe(true);
    });
  });

  describe("auditPulseTerminationConfinement", () => {
    it("flags subagent pulse termination in state and commands", () => {
      const roleMap = new Map<string, string>([["impl-1", "implementer"]]);
      const state: JsonObject = {
        pulse: {
          last: {
            outcome: "halted",
            actor: "impl-1",
            terminal_reason: "user abort requested by subagent",
          },
        },
      };
      const commands: CommandRecord[] = [
        {
          id: "cmd-pulse-close",
          actor: "impl-1",
          status: "succeeded",
          task_id: null,
          argv: ["bun", "harness.ts", "mind:pulse-close", "--outcome", "halted"],
        },
        {
          id: "cmd-kill-mind",
          actor: "impl-1",
          status: "succeeded",
          task_id: null,
          argv: ["pkill", "-f", "pulse.sh"],
        },
      ];
      const findings: TierConfinementFinding[] = [];
      auditPulseTerminationConfinement(roleMap, state, commands, findings);

      expect(findings.length).toBe(3);
      for (const finding of findings) {
        expect(finding.violation_type).toBe("subagent_pulse_termination");
      }
    });
  });

  describe("auditSupervisorCodeContamination", () => {
    it("detects supervisor git diff modifications to source files", () => {
      const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
      const gitDiffs = [
        { path: "src/engine/index.ts", actor: "coord-1", role: "coordinator" },
        { path: "docs/architecture.md", actor: "coord-1", role: "coordinator" },
      ];
      const findings = auditSupervisorCodeContamination(roleMap, [], [], [], gitDiffs);

      expect(findings.length).toBe(1);
      expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
      expect(findings[0]?.observation).toContain(DOCTOR_SUPERVISOR_CODE_CONTAMINATION);
    });

    it("detects supervisor repository content SHA mutations during commands", () => {
      const roleMap = new Map<string, string>([["coord-1", "coordinator"]]);
      const commands: CommandRecord[] = [
        {
          id: "cmd-mut",
          actor: "coord-1",
          status: "succeeded",
          task_id: null,
          argv: ["echo", "mutation"],
          repository_before: { content_sha256: "1".repeat(64), evidence_class: "harness_observed" },
          repository_after: { content_sha256: "2".repeat(64), evidence_class: "harness_observed" },
        },
      ];
      const findings = auditSupervisorCodeContamination(roleMap, [], commands, []);

      expect(findings.length).toBe(1);
      expect(findings[0]?.violation_type).toBe("supervisor_code_contamination");
    });
  });

  describe("auditTierConfinement & summarizeTierConfinement", () => {
    it("runs audit on in-memory state and returns empty array on clean run", () => {
      const state: JsonObject = {
        agents: [],
        tasks: {},
        commands: {},
      };
      const findings = auditTierConfinement("", state);
      expect(findings).toEqual([]);

      const summary = summarizeTierConfinement(findings);
      expect(summary.healthy).toBe(true);
      expect(summary.violation_count).toBe(0);
      expect(summary.issues).toEqual([]);
    });

    it("infers roles from state packets, leases, attempts, and name heuristics", () => {
      const state: JsonObject = {
        packets: {
          "p-1": { agent_id: "agent-packet-val", role: "validator" },
        },
        tasks: {
          "t-1": {
            id: "t-1",
            lease: { agent_id: "agent-lease-impl", role: "implementer" },
            attempts: [{ agent_id: "agent-attempt-repair", role: "repairer" }],
          },
        },
        commands: {
          "cmd-p": {
            id: "cmd-p",
            actor: "agent-packet-val",
            status: "succeeded",
            argv: ["bun", "test"],
          },
          "cmd-coord-regex": {
            id: "cmd-coord-regex",
            actor: "coord-unmapped",
            status: "succeeded",
            tool_category: "file-edit",
            argv: ["edit"],
          },
          "cmd-orch-regex": {
            id: "cmd-orch-regex",
            actor: "orch-unmapped",
            status: "succeeded",
            argv: ["pytest"],
          },
          "cmd-mind-regex": {
            id: "cmd-mind-regex",
            actor: "mind-unmapped",
            status: "succeeded",
            tool: "write_to_file",
            argv: ["write"],
          },
          "cmd-worker-regex": {
            id: "cmd-worker-regex",
            actor: "worker-unmapped",
            status: "succeeded",
            argv: ["bun", "harness.ts", "task:review"],
          },
          "cmd-critic-regex": {
            id: "cmd-critic-regex",
            actor: "critic-unmapped",
            status: "succeeded",
            argv: ["echo", "critique"],
          },
          "cmd-plan-regex": {
            id: "cmd-plan-regex",
            actor: "plan-unmapped",
            status: "succeeded",
            argv: ["echo", "plan"],
          },
          "cmd-unknown": {
            id: "cmd-unknown",
            actor: "unknown-unmapped",
            status: "succeeded",
            argv: ["echo", "unknown"],
          },
        },
      };

      const findings = auditTierConfinement("", state);
      expect(findings.length).toBeGreaterThan(0);
    });

    it("runs audit on disk capsuleRoot with rich ledgers", () => {
      const runRoot = initRun(
        SCRATCH_DIR,
        "tc-disk-run-rich",
        new TextEncoder().encode("Rich tier confinement disk prompt"),
        "file",
        true,
      );

      // Add commands and tasks to disk run
      transact(
        runRoot,
        "coord-1",
        "agent-registered",
        {
          agent_id: "coord-1",
          role: "coordinator",
        },
        (state) => {
          state.tasks = {
            "t-1": {
              id: "t-1",
              status: "leased",
              label: "T1",
              effort: 1,
              priority: 1,
              created_order: 1,
              dependencies: [],
              write_scope: ["src/file.ts"],
              requirement_ids: [],
              resource_scope: [],
              attempts: [],
              history: [],
              repair_round: 0,
              lease: {
                agent_id: "coord-1",
                role: "coordinator",
                attempt: 1,
                issued_at: "2026-08-24T00:00:00Z",
                expires_at: "2026-08-24T01:00:00Z",
                heartbeat_at: "2026-08-24T00:00:00Z",
                duration_seconds: 3600,
                write_scope: ["src/file.ts"],
                resource_scope: [],
                token_digest: "0".repeat(64),
                write_scope_content_hash: {
                  evidence_class: "harness_observed",
                  value: "0".repeat(64),
                },
              },
            },
          };
        },
      );

      const findings = auditTierConfinement(runRoot);
      expect(findings.some((f) => f.violation_type === "coordinator_code_writing")).toBe(true);

      const summary = summarizeTierConfinement(findings);
      expect(summary.healthy).toBe(false);
      expect(summary.violation_count).toBeGreaterThan(0);
      expect(summary.issues.length).toBeGreaterThan(0);
    });
  });

  describe("assertSupervisorRoleConfinement", () => {
    it("passes cleanly when no supervisor violations exist", () => {
      expect(() => assertSupervisorRoleConfinement([])).not.toThrow();
    });

    it("throws HarnessError with ROLE_CONFINEMENT_VIOLATION on supervisor contamination", () => {
      const violations: TierConfinementFinding[] = [
        {
          agent_id: "coord-1",
          role: "coordinator",
          tier: 2,
          violation_type: "coordinator_code_writing",
          severity: "critical",
          observation: "Coordinator modified file",
          remediation: "Revert edits",
        },
      ];

      expect(() => assertSupervisorRoleConfinement(violations)).toThrow(HarnessError);
      try {
        assertSupervisorRoleConfinement(violations);
      } catch (err: unknown) {
        expect(err instanceof HarnessError).toBe(true);
        if (err instanceof HarnessError) {
          expect(err.code).toBe("ROLE_CONFINEMENT_VIOLATION");
        }
      }
    });

    it("infers role from task lease and task attempt records in state", () => {
      const state: JsonObject = {
        tasks: {
          "t-lease": {
            id: "t-lease",
            lease: { agent_id: "unregistered-leased-coord", role: "coordinator" },
            attempts: [{ agent_id: "unregistered-attempt-coord", role: "coordinator" }],
          },
        },
        commands: {
          "cmd-1": {
            id: "cmd-1",
            actor: "unregistered-leased-coord",
            tool: "write_to_file",
            argv: ["write_to_file", "src/foo.ts"],
            status: "succeeded",
          },
          "cmd-2": {
            id: "cmd-2",
            actor: "unregistered-attempt-coord",
            argv: ["kill", "-9", "pulse.sh"],
            status: "succeeded",
          },
        },
      };

      const findings = auditTierConfinement("", state);
      expect(findings.some((f) => f.agent_id === "unregistered-leased-coord")).toBe(true);
      expect(findings.some((f) => f.agent_id === "unregistered-attempt-coord")).toBe(true);
    });
  });
});
