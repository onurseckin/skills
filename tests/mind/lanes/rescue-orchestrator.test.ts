import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { executeRescueLane } from "../../../olt/scripts/src/mind/lanes/rescue/orchestrator.ts";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import {
  cleanupVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../../store/store-fixture.ts";

describe("Rescue Lane Orchestrator Suite", () => {
  beforeEach(() => {
    setupVirtualStoreFS();
  });

  afterEach(() => {
    cleanupVirtualStoreFS();
  });

  function fixture(label: string) {
    const repoRoot = scratchRoot(import.meta.path, `${label}-repo`);
    const prompt = new TextEncoder().encode("Mind test prompt");
    const mindRunRoot = initRun(repoRoot, `mind-${label}`, prompt, "file", true);
    return { repoRoot, mindRunRoot, actor: "mind-tester" };
  }

  function writeCharter(repoRoot: string, rel = "olt/agents/mind.yaml", content = "name: mind\n") {
    const full = join(repoRoot, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content);
    return createHash("sha256").update(new TextEncoder().encode(content)).digest("hex");
  }

  function setupHealthy(label: string) {
    const { repoRoot, mindRunRoot, actor } = fixture(label);
    const sha = writeCharter(repoRoot);
    transact(mindRunRoot, actor, "setup", {}, (draft) => {
      draft.mind = {
        actor: "mind-prime",
        charter: { pinned_sha256: sha, source_path: "olt/agents/mind.yaml" },
      } as unknown as Record<string, unknown>;
    });
    return { repoRoot, mindRunRoot, actor, sha };
  }

  it("returns outcome 'halted' when Rung 0 halts due to missing charter", async () => {
    const { mindRunRoot } = fixture("r0-halt");
    // Charter file not created on disk -> Rung 0 halts
    const res = await executeRescueLane(mindRunRoot, {
      now: "2026-09-01T12:00:00.000Z",
    });

    expect(res.outcome).toBe("halted");
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("charter file missing");
    expect(res.summary).toContain("RESCUE halted at Rung 0: charter file missing");
    expect(res.rungs.rung0.halted).toBe(true);
    expect(res.rungs.rung1.liveRunsChecked).toBe(0);
    expect(res.rungs.rung5.gapExceeded).toBe(false);
  });

  it("returns outcome 'quiescent' when all 6 rungs pass cleanly with no recovery actions", async () => {
    const { mindRunRoot } = setupHealthy("all-clean");

    const res = await executeRescueLane(mindRunRoot, {
      now: new Date(1756700000000),
      runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      targetRunRoots: [],
    });

    expect(res.outcome).toBe("quiescent");
    expect(res.halted).toBe(false);
    expect(res.actionsTaken.length).toBe(0);
    expect(res.escalations.length).toBe(0);
    expect(res.summary).toBe("RESCUE checked all 6 rungs; no recovery actions needed (quiescent)");
    expect(res.rungs.rung0.halted).toBe(false);
    expect(res.rungs.rung4.deadPulseReclaimed).toBe(false);
    expect(res.rungs.rung5.gapExceeded).toBe(false);
  });

  it("returns outcome 'halted' when Rung 4 halts due to consecutive pulse crashes", async () => {
    const { mindRunRoot, actor } = setupHealthy("r4-halt");

    transact(mindRunRoot, actor, "seed-pulse-crash", {}, (draft) => {
      draft.pulse = {
        open: {
          pulse_id: "pulse-stale-1",
          deadline_at: new Date(1756700000000 - 300000).toISOString(),
        },
        last: {
          consecutive_crashes: 2,
        },
      };
    });

    const res = await executeRescueLane(mindRunRoot, {
      now: 1756700000000,
      runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
    });

    expect(res.outcome).toBe("halted");
    expect(res.halted).toBe(true);
    expect(res.haltReason).toBe("consecutive pulse crashes threshold exceeded");
    expect(res.summary).toContain(
      "RESCUE halted at Rung 4: consecutive pulse crashes threshold exceeded",
    );
    expect(res.rungs.rung4.halted).toBe(true);
    expect(res.rungs.rung4.deadPulseReclaimed).toBe(true);
    expect(res.rungs.rung4.consecutiveCrashes).toBe(3);
  });

  it("returns outcome 'rescued' and executes recovery actions across rungs", async () => {
    const { mindRunRoot, actor } = setupHealthy("reclaimed-pulse");

    // Seed an expired/crashed pulse with crash count < 3 so Rung 4 reclaims it instead of halting
    transact(mindRunRoot, actor, "seed-reclaimable-pulse", {}, (draft) => {
      draft.pulse = {
        open: {
          pulse_id: "pulse-reclaimable",
          deadline_at: new Date(1756700000000 - 600000).toISOString(),
        },
        last: {
          consecutive_crashes: 0,
        },
      };
    });

    const res = await executeRescueLane(mindRunRoot, {
      now: 1756700000000,
      runtimeFreshnessOverride: { drifted: false, referenceRuntimeVersion: "1.0.0" },
      actor: "custom-rescue-actor",
      targetRunRoots: [mindRunRoot],
      grantIdleSeconds: 600,
      graceSeconds: 15,
    });

    expect(res.outcome).toBe("rescued");
    expect(res.halted).toBe(false);
    expect(res.actionsTaken.length).toBeGreaterThan(0);
    expect(res.summary).toContain("RESCUE executed successfully");
    expect(res.rungs.rung4.deadPulseReclaimed).toBe(true);
    expect(res.rungs.rung4.consecutiveCrashes).toBe(1);
  });
});
