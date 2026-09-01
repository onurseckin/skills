import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  MIND_CHARTER_INVARIANTS,
  auditAntiStagnationHealth,
  checkAntiStagnationDoctor,
  type AntiStagnationAuditReport,
  type AntiStagnationDoctorOptions,
} from "../../../olt/scripts/src/reporting/doctor/anti-stagnation/index.ts";
import {
  HistoricalDebateMemory,
  type StrategicCommitment,
  type StrategicResolution,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  SupersessionIndex,
  type SupersessionIndexState,
} from "../../../olt/scripts/src/mind/memory/index.ts";
import {
  computeSnapshotChecksum,
  type SuspendedAnimationSnapshot,
} from "../../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  createInitialDashboardState,
  type ExecutiveDashboardState,
} from "../../../olt/scripts/src/mind/reporting/index.ts";
import { runDoctor } from "../../../olt/scripts/src/reporting/doctor.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";

describe("Anti-Stagnation Doctor & Mind Charter Invariant Engine", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(join(process.cwd(), "tmp-doctor-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe("1. Canonical Charter Invariants Registry", () => {
    it("exports all 16 canonical Mind Charter Invariants", () => {
      expect(MIND_CHARTER_INVARIANTS).toHaveLength(16);
      expect(MIND_CHARTER_INVARIANTS).toContain("SUPERVISOR_ZERO_CODE_EDITS");
      expect(MIND_CHARTER_INVARIANTS).toContain("SUPERVISOR_ZERO_TEST_RUNS");
      expect(MIND_CHARTER_INVARIANTS).toContain("THREE_STRIKE_MECHANICAL_CONTAINMENT");
      expect(MIND_CHARTER_INVARIANTS).toContain("ANTI_MAKEWORK_GENUINE_VALUE");
      expect(MIND_CHARTER_INVARIANTS).toContain("CUMULATIVE_SOCRATIC_PROGRESSION");
      expect(MIND_CHARTER_INVARIANTS).toContain("PRE_DECLARED_PARETO_ARBITRATION");
      expect(MIND_CHARTER_INVARIANTS).toContain("INNOVATION_PORTFOLIO_70_20_10");
      expect(MIND_CHARTER_INVARIANTS).toContain("ERGONOMIC_WALKTHROUGH_AUDITING");
      expect(MIND_CHARTER_INVARIANTS).toContain("THREE_TIER_SEMANTIC_MEMORY");
      expect(MIND_CHARTER_INVARIANTS).toContain("EPISTEMIC_SUPERSESSION_INDEXING");
      expect(MIND_CHARTER_INVARIANTS).toContain("SUSPENDED_ANIMATION_PROTOCOL");
      expect(MIND_CHARTER_INVARIANTS).toContain("INFLIGHT_WORK_INGESTION");
      expect(MIND_CHARTER_INVARIANTS).toContain("DIAGNOSTIC_CLUSTERING");
      expect(MIND_CHARTER_INVARIANTS).toContain("LIVE_EXECUTIVE_DASHBOARD");
      expect(MIND_CHARTER_INVARIANTS).toContain("MANDATORY_3_ROUND_SOCRATIC_LADDERING");
      expect(MIND_CHARTER_INVARIANTS).toContain("DIRECT_1_ON_1_CONVERSATIONAL_AUDITS");
    });
  });

  describe("2. Clean Baseline & Nominal State Audit", () => {
    it("returns clean health pass on valid nominal Mind state", () => {
      const nowMs = Date.now();
      const socraticMemory = new HistoricalDebateMemory(
        [
          {
            id: "res-01",
            cycleId: "cycle-1",
            topic: "Zero Copy State",
            consensusReached: true,
            winningApproach: "Zero Copy Projection",
            paretoPriorityLevel: 1,
            settledInvariant: "AXIOM-001",
            commitments: [
              {
                id: "comm-01",
                topic: "Zero Copy State",
                agreedResolution: "Adopt zero copy",
                targetMilestone: "M1",
                status: "fulfilled",
                createdAt: new Date(nowMs).toISOString(),
                updatedAt: new Date(nowMs).toISOString(),
              },
            ],
            recordedAt: new Date(nowMs).toISOString(),
          },
        ],
        [],
      );

      const supersessionIndex = new SupersessionIndex([
        {
          id: "node-1",
          title: "Node 1",
          status: "SUPERSEDED",
          supersededBy: "node-2",
          timestamp: new Date(nowMs).toISOString(),
        },
        {
          id: "node-2",
          title: "Node 2",
          status: "ACTIVE",
          timestamp: new Date(nowMs).toISOString(),
        },
      ]);

      const dashState = createInitialDashboardState({
        systemicHealthScore: 0.99,
        uptimeSeconds: 3600,
      });

      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1, active: true },
          pulse: { counter: 5, consecutive_zero_delta: 0, is_stagnant: false },
          portfolio: dashState.portfolio,
          product_craft: dashState.productCraft,
          dashboard: dashState,
          grants: [
            { id: "mind-1", role: "mind", status: "active", parent_agent_id: null },
            { id: "orch-1", role: "orchestrator", status: "active", parent_agent_id: "mind-1" },
            { id: "coord-1", role: "coordinator", status: "active", parent_agent_id: "orch-1" },
            {
              id: "impl-1",
              role: "implementer",
              status: "active",
              parent_agent_id: "coord-1",
              tools_used: ["write_to_file"],
            },
            { id: "val-1", role: "validator", status: "active", parent_agent_id: "coord-1" },
          ],
        },
        socraticMemory,
        supersessionIndex,
        nowMs,
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(true);
      expect(result.findings.filter((f) => f.severity === "ERROR")).toHaveLength(0);
    });

    it("passes cleanly when options are empty (non-mind run)", () => {
      const result = checkAntiStagnationDoctor({});
      expect(result.passed).toBe(true);
      expect(result.findings).toHaveLength(0);
    });
  });

  describe("3. Supervisory Purity: Invariant 1 (Zero Code Edits) & Invariant 2 (Zero Test Runs)", () => {
    it("flags supervisor executing write_to_file tool as SUPERVISOR_ZERO_CODE_EDITS violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          grants: [
            {
              id: "mind-orch-1",
              role: "orchestrator",
              status: "active",
              tools_used: ["write_to_file"],
            },
          ],
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "SUPERVISOR_ZERO_CODE_EDITS");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Supervisor Zero Code Edits violation");
    });

    it("flags coordinator executing replace_file_content in events", () => {
      const options: AntiStagnationDoctorOptions = {
        state: { mind: { generation: 1 } },
        events: [
          {
            actor: "coord-1",
            payload: {
              role: "coordinator",
              tool: "replace_file_content",
            },
          },
        ],
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "SUPERVISOR_ZERO_CODE_EDITS");
      expect(finding).toBeDefined();
    });

    it("flags supervisor directly executing test runner as SUPERVISOR_ZERO_TEST_RUNS violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          commands: {
            "cmd-1": {
              id: "cmd-1",
              actor: "orch-1",
              role: "orchestrator",
              command_line: "bun test tests/unit.test.ts",
            },
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "SUPERVISOR_ZERO_TEST_RUNS");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Supervisor Zero Test Runs violation");
    });

    it("permits implementer and validator roles to edit code and run tests", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          grants: [
            {
              id: "impl-1",
              role: "implementer",
              tools_used: ["write_to_file", "replace_file_content"],
            },
          ],
          commands: {
            "cmd-1": {
              actor: "val-1",
              role: "validator",
              command_line: "bun test tests/unit.test.ts",
            },
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      const editViolations = result.findings.filter((f) => f.code === "SUPERVISOR_ZERO_CODE_EDITS");
      const testViolations = result.findings.filter((f) => f.code === "SUPERVISOR_ZERO_TEST_RUNS");
      expect(editViolations).toHaveLength(0);
      expect(testViolations).toHaveLength(0);
    });
  });

  describe("4. Invariant 3: Three-Strike Mechanical Containment", () => {
    it("flags agent with 3 strikes that remains active as THREE_STRIKE_MECHANICAL_CONTAINMENT violation", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          strikes: {
            "impl-flaky-1": {
              count: 3,
              status: "active",
            },
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "THREE_STRIKE_MECHANICAL_CONTAINMENT");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("impl-flaky-1");
    });
  });
});
