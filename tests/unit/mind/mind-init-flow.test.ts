import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import {
  setupVirtualMindFS,
  cleanupVirtualMindFS,
  scratchRoot,
} from "../../mind/fixtures/mind-fixture.ts";
import {
  executeAutonomousMindInit,
  AutonomousMindInitializer,
} from "../../../olt/scripts/src/mind/lifecycle/mind-init-flow.ts";
import {
  assertMindCompanionBootstrapping,
  verifyMindCompanionBootstrapping,
} from "../../../olt/scripts/src/mind/lifecycle/mind-companions.ts";
import { loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  readAgentLedger,
  writeAgentLedger,
} from "../../../olt/scripts/src/workflow/agents/ledger.ts";
import type { AgentGrantRecord } from "../../../olt/scripts/src/core/contracts/index.ts";
import type { VirtualMemoryFS } from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Autonomous Mind Initialization & Co-Deployment Flow Suite", () => {
  let vfs: VirtualMemoryFS;
  let testDir: string;

  beforeEach(() => {
    vfs = setupVirtualMindFS();
    testDir = scratchRoot("mind-init-co-deploy");
    vfs.mkdirSync(path.join(testDir, ".olt"), { recursive: true });
  });

  afterEach(() => {
    cleanupVirtualMindFS();
  });

  it("atomically co-deploys Mind and Mind-Auditor (and Skill-Auditor) in single 1-shot batch", async () => {
    const mindId = "mind-atomic-1";
    const result = await executeAutonomousMindInit({
      repo: testDir,
      mindId,
      generation: 1,
      actor: "coordinator",
      host: "local",
      simulateProbes: true,
    });

    expect(result.mind_id).toBe(mindId);
    expect(result.companions.deployed).toBe(true);
    expect(result.companions.mindAuditorId).toBe(`${mindId}-mind-auditor`);
    expect(result.companions.skillAuditorId).toBe(`${mindId}-skill-auditor`);

    // Verify capsule store contains the active companion grants in state.agents
    const loaded = loadRun(result.run_root);
    const ledger = readAgentLedger(loaded.state as Record<string, unknown>);

    expect(ledger.length).toBeGreaterThanOrEqual(3);

    const mindGrant = ledger.find((g) => g.id === mindId);
    expect(mindGrant !== undefined).toBe(true);
    if (mindGrant !== undefined) {
      expect(mindGrant.role).toBe("mind");
      expect(mindGrant.status).toBe("active");
    }

    const mindAuditorGrant = ledger.find((g) => g.role === "mind-auditor");
    expect(mindAuditorGrant !== undefined).toBe(true);
    if (mindAuditorGrant !== undefined) {
      expect(mindAuditorGrant.id).toBe(`${mindId}-mind-auditor`);
      expect(mindAuditorGrant.parent_agent_id).toBe(mindId);
      expect(mindAuditorGrant.status).toBe("active");
    }

    const skillAuditorGrant = ledger.find((g) => g.role === "skill-auditor");
    expect(skillAuditorGrant !== undefined).toBe(true);
    if (skillAuditorGrant !== undefined) {
      expect(skillAuditorGrant.id).toBe(`${mindId}-skill-auditor`);
      expect(skillAuditorGrant.parent_agent_id).toBe(mindId);
      expect(skillAuditorGrant.status).toBe("active");
    }

    // Verify assertMindCompanionBootstrapping passes with this ledger
    const check = verifyMindCompanionBootstrapping(ledger);
    expect(check.complete).toBe(true);
    expect(() => assertMindCompanionBootstrapping(ledger)).not.toThrow();
  });

  it("deduplicates and reconnects existing mind_auditor in capsule ledger", async () => {
    const mindId = "mind-reconnect-1";

    // Initialize the flow
    const result = await executeAutonomousMindInit({
      repo: testDir,
      mindId,
      generation: 1,
      host: "local",
      simulateProbes: true,
    });

    // Artificially inject a disconnected duplicate mind-auditor
    transact(result.run_root, "system", "inject-duplicate-auditor", {}, (draft) => {
      const ledger = readAgentLedger(draft);
      const duplicateAuditor: AgentGrantRecord = {
        id: `${mindId}-mind-auditor-dup`,
        role: "mind-auditor",
        parent_agent_id: "orphan-parent",
        parent_task_id: null,
        host: "remote",
        granted_at: new Date().toISOString(),
        status: "active",
      };
      writeAgentLedger(draft, [...ledger, duplicateAuditor]);
    });

    // Re-run initialization (e.g. restart or re-deploy)
    const secondResult = await executeAutonomousMindInit({
      repo: testDir,
      mindId,
      generation: 1,
      host: "local",
      simulateProbes: true,
    });

    const reloaded = loadRun(secondResult.run_root);
    const ledger = readAgentLedger(reloaded.state as Record<string, unknown>);

    // Should only have exactly 1 mind-auditor grant
    const auditorGrants = ledger.filter((g) => g.role === "mind-auditor");
    expect(auditorGrants.length).toBe(1);
    const primaryAuditor = auditorGrants[0];
    expect(primaryAuditor.parent_agent_id).toBe(mindId);
    expect(primaryAuditor.status).toBe("active");
  });

  it("mobilized hierarchy contains mind, mind-auditor, skill-auditor, and orchestrator", async () => {
    const mindId = "mind-hierarchy-1";
    const result = await executeAutonomousMindInit({
      repo: testDir,
      mindId,
      generation: 2,
      host: "local",
      simulateProbes: true,
    });

    expect(result.mobilized_hierarchy.length).toBe(4);
    const roles = result.mobilized_hierarchy.map((entry) => entry.role);
    expect(roles).toContain("mind");
    expect(roles).toContain("mind-auditor");
    expect(roles).toContain("skill-auditor");
    expect(roles).toContain("orchestrator");
  });

  it("AutonomousMindInitializer operates cleanly across ingestion, probing, and init", async () => {
    const initializer = new AutonomousMindInitializer({
      repo: testDir,
      simulateProbes: true,
    });

    const inFlight = await initializer.ingestInFlight(testDir);
    expect(inFlight.snapshot.snapshotId.length).toBeGreaterThan(0);
    expect(inFlight.intent.priority).toBe("P1");
    expect(inFlight.deliverable.priority).toBe("P1");

    const probe = await initializer.probeBaseline(testDir, { simulate: true });
    expect(probe.defectCount).toBe(0);

    const initResult = await initializer.initialize();
    expect(initResult.cadence_initialized).toBe(true);
    expect(initResult.companions.deployed).toBe(true);
  });
});
