import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  AutonomousMindInitializer,
  executeAutonomousMindInit,
  type MindInitFlowResult,
} from "../../../../olt/scripts/src/mind/lifecycle/mind-init-flow.ts";
import { readDashboardState } from "../../../../olt/scripts/src/mind/reporting/index.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Sovereign Lifecycle & Autonomous Single-Touch Bootstrap Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let testRepoRoot: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    testRepoRoot = "/virtual/mind-lifecycle-test-sub3";
    vfs.mkdirSync(testRepoRoot, { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".olt"), { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".olt", "mailboxes"), { recursive: true });
    vfs.mkdirSync(join(testRepoRoot, ".olt", "snapshots"), { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("5. Zero-Parameter Autonomous Bootstrap Execution", () => {
    it("executes single-touch initialization from scratch without requiring human prompts", async () => {
      const initResult: MindInitFlowResult = await executeAutonomousMindInit({
        repo: testRepoRoot,
        simulateProbes: true,
        actor: "owner",
        mindId: "mind-sovereign-01",
      });

      expect(initResult.mind_id).toBe("mind-sovereign-01");
      expect(initResult.generation).toBe(1);
      expect(initResult.charter_sha256).toBeDefined();
      expect(initResult.governance.ready).toBe(true);

      expect(initResult.companions.deployed).toBe(true);
      expect(initResult.companions.mindAuditorId).toBe("mind-sovereign-01-mind-auditor");
      expect(initResult.companions.skillAuditorId).toBe("mind-sovereign-01-skill-auditor");

      const roles = initResult.mobilized_hierarchy.map((g) => g.role);
      expect(roles).toContain("mind");
      expect(roles).toContain("mind-auditor");
      expect(roles).toContain("skill-auditor");
      expect(roles).toContain("orchestrator");

      expect(initResult.p1_deliverable.priority).toBe("P1");
      expect(initResult.deficit_topology.summary.healthStatus).toBeDefined();

      expect(vfs.existsSync(initResult.dashboard.md_path)).toBe(true);
      expect(vfs.existsSync(initResult.dashboard.json_path)).toBe(true);

      const dashboardState = await readDashboardState(testRepoRoot);
      expect(dashboardState).not.toBeNull();
      expect(dashboardState?.trajectory.activeMode).toContain("SOVEREIGN");
      expect(dashboardState?.portfolio.balanceStatus).toBe("BALANCED");

      expect(initResult.cadence_initialized).toBe(true);
      expect(initResult.markdown).toContain("SOVEREIGN AUTONOMOUS MIND INITIALIZED");
    });

    it("operates modularly via AutonomousMindInitializer class", async () => {
      const initializer = new AutonomousMindInitializer({
        repo: testRepoRoot,
        simulateProbes: true,
      });

      const inFlight = await initializer.ingestInFlight(testRepoRoot);
      expect(inFlight.snapshot).toBeDefined();
      expect(inFlight.intent).toBeDefined();
      expect(inFlight.deliverable.priority).toBe("P1");

      const probeResult = await initializer.probeBaseline(testRepoRoot, { simulate: true });
      expect(probeResult.topologyMatrix).toBeDefined();

      const fullResult = await initializer.initialize();
      expect(fullResult.mind_id).toBe("mind-gen-1");
      expect(fullResult.cadence_initialized).toBe(true);
      expect(fullResult.governance.ready).toBe(true);
    });
  });
});
