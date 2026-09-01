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

  describe("13. Invariant 15: Mandatory 3-Round Socratic Laddering", () => {
    it("flags consensus recorded at L1 without traversing L2 and L3 rounds", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          socratic: {
            consensusReached: true,
            history: [
              { id: "ex-1", level: "L1_TRADE_OFF_VERIFICATION", inquiry: "Q1" }, // Skipped L2 and L3
            ],
          },
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find(
        (f) => f.code === "MANDATORY_3_ROUND_SOCRATIC_LADDERING",
      );
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain(
        "Consensus recorded without traversing all 3 mandatory dialectical rounds",
      );
    });
  });

  describe("14. Invariant 16: Direct 1-on-1 Conversational Audits", () => {
    it("flags Tier 0 Mind directly granting Tier 3 Implementer as cross-tier bypass", () => {
      const options: AntiStagnationDoctorOptions = {
        state: {
          mind: { generation: 1 },
          grants: [
            { id: "mind-1", role: "mind", parent_agent_id: null },
            { id: "impl-bypass-1", role: "implementer", parent_agent_id: "mind-1" }, // Direct bypass of Coordinator
          ],
        },
      };

      const result = checkAntiStagnationDoctor(options);
      expect(result.passed).toBe(false);
      const finding = result.findings.find((f) => f.code === "DIRECT_1_ON_1_CONVERSATIONAL_AUDITS");
      expect(finding).toBeDefined();
      expect(finding?.severity).toBe("ERROR");
      expect(finding?.message).toContain("Cross-tier bypass");
    });
  });

  describe("15. auditAntiStagnationHealth Sub-Report Aggregations", () => {
    it("compiles structured AntiStagnationAuditReport with all sub-reports", () => {
      const runRoot = initRun(
        tempDir,
        "test-mind-run",
        new TextEncoder().encode("Mind test prompt"),
        "file",
        true,
      );

      const memory = new HistoricalDebateMemory([], []);
      const index = new SupersessionIndex([
        {
          id: "inv-1",
          title: "Invariant 1",
          status: "ACTIVE",
          timestamp: new Date().toISOString(),
        },
      ]);

      const report: AntiStagnationAuditReport = auditAntiStagnationHealth(runRoot, {
        repoRoot: tempDir,
        socraticMemory: memory,
        supersessionIndex: index,
      });

      expect(report).toBeDefined();
      expect(report.runRoot).toBe(runRoot);
      expect(report.invariantsChecked).toBe(16);
      expect(typeof report.healthy).toBe("boolean");
      expect(report.supervisoryPurity).toBeDefined();
      expect(report.supervisoryPurity.pure).toBe(true);
      expect(report.socraticMemoryHealth).toBeDefined();
      expect(report.socraticMemoryHealth.intact).toBe(true);
      expect(report.supersessionIndexingHealth).toBeDefined();
      expect(report.supersessionIndexingHealth.acyclic).toBe(true);
      expect(report.supersessionIndexingHealth.nodeCount).toBe(1);
    });
  });

  describe("16. Full Integration with runDoctor", () => {
    it("invokes checkAntiStagnationDoctor as part of runDoctor engine collection", async () => {
      const runRoot = initRun(
        tempDir,
        "test-mind-doctor-run",
        new TextEncoder().encode("Doctor prompt"),
        "file",
        true,
      );

      transact(runRoot, "mind", "mind-initialized", {}, (state) => {
        state.mind = { generation: 1 };
        state.pulse = { counter: 1 };
        state.graph = { revision: 1, gates: [] };
      });

      const report = await runDoctor(runRoot, { repoRoot: tempDir });
      expect(report.engine_results).toBeDefined();
      const engineResults = report.engine_results as Record<
        string,
        { engine: string; passed: boolean }
      >;
      expect(engineResults.checkAntiStagnationDoctor).toBeDefined();
      expect(engineResults.checkAntiStagnationDoctor?.engine).toBe("checkAntiStagnationDoctor");
    });
  });
});
