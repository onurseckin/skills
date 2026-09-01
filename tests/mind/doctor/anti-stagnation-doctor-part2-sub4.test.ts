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
