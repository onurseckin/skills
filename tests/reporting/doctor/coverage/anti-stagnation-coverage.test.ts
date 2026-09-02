import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import { join } from "node:path";
import {
  auditThreeTierSemanticMemory,
  auditEpistemicSupersessionIndexing,
  auditSuspendedAnimationProtocol,
  auditInflightWorkIngestion,
  auditDiagnosticClustering,
} from "../../../../olt/scripts/src/reporting/doctor/anti-stagnation/rules-memory.ts";
import { SupersessionIndex } from "../../../../olt/scripts/src/mind/memory/index.ts";
import {
  createSuspendedAnimationEngine,
  computeSnapshotChecksum,
  writeSnapshotToDisk,
  type SuspendedAnimationSnapshot,
  type SuspendedTaskNode,
} from "../../../../olt/scripts/src/mind/lifecycle/index.ts";
import { cleanupVirtualReportingFS, setupVirtualReportingFS, tempDir } from "../../fixture.ts";

describe("auditThreeTierSemanticMemory", () => {
  test("passes when memory is absent, uninitialized, or contains all three tiers", () => {
    expect(auditThreeTierSemanticMemory({})[0]?.compliant).toBe(true);
    expect(
      auditThreeTierSemanticMemory({ state: { memory: { initialized: false } } })[0]?.compliant,
    ).toBe(true);

    const withArrays = {
      state: {
        memory: {
          initialized: true,
          tier1Invariants: [],
          tier2WorkingMemory: [],
          tier3ArchivedEpics: [],
        },
      },
    };
    expect(auditThreeTierSemanticMemory(withArrays)[0]?.compliant).toBe(true);

    const withBooleans = {
      state: {
        memory: {
          initialized: true,
          invariants: true,
          working: true,
          archived: true,
        },
      },
    };
    expect(auditThreeTierSemanticMemory(withBooleans)[0]?.compliant).toBe(true);
  });

  test("flags violations when initialized memory is missing required tiers", () => {
    const missingTiers = [
      { initialized: true, tier1Invariants: [] },
      { initialized: true, tier2WorkingMemory: [] },
      { initialized: true, tier3ArchivedEpics: [] },
      { initialized: true },
    ];

    for (const mem of missingTiers) {
      const res = auditThreeTierSemanticMemory({ state: { memory: mem } });
      expect(res[0]?.compliant).toBe(false);
      expect(res[0]?.severity).toBe("ERROR");
      expect(res[0]?.invariant).toBe("THREE_TIER_SEMANTIC_MEMORY");
    }
  });
});

describe("auditEpistemicSupersessionIndexing", () => {
  test("passes when no supersession index is configured or index is valid", () => {
    expect(auditEpistemicSupersessionIndexing({})[0]?.compliant).toBe(true);

    const validIndex = new SupersessionIndex();
    validIndex.registerEntry({ id: "n1", title: "Node 1" });
    validIndex.registerEntry({ id: "n2", title: "Node 2", supersededBy: "n1" });

    expect(
      auditEpistemicSupersessionIndexing({ supersessionIndex: validIndex })[0]?.compliant,
    ).toBe(true);
    expect(
      auditEpistemicSupersessionIndexing({ supersessionIndex: validIndex.exportState() })[0]
        ?.compliant,
    ).toBe(true);
    expect(
      auditEpistemicSupersessionIndexing({
        state: { supersession_index: validIndex.exportState() },
      })[0]?.compliant,
    ).toBe(true);
    expect(
      auditEpistemicSupersessionIndexing({
        state: { memory: { supersessionIndex: validIndex.exportState() } },
      })[0]?.compliant,
    ).toBe(true);
  });

  test("handles invalid index state objects gracefully", () => {
    expect(
      auditEpistemicSupersessionIndexing({
        state: { supersession_index: "invalid" as unknown as object },
      })[0]?.compliant,
    ).toBe(true);
    expect(
      auditEpistemicSupersessionIndexing({ state: { memory: { supersessionIndex: "invalid" } } })[0]
        ?.compliant,
    ).toBe(true);
  });

  test("flags cycle violations when lineage contains cycles", () => {
    const cyclicState = {
      version: 1,
      exportedAt: new Date().toISOString(),
      nodes: [
        {
          id: "n1",
          title: "Node 1",
          status: "SUPERSEDED" as const,
          supersededBy: "n2",
          timestamp: "t1",
        },
        {
          id: "n2",
          title: "Node 2",
          status: "SUPERSEDED" as const,
          supersededBy: "n1",
          timestamp: "t2",
        },
      ],
    };

    const resFromObj = auditEpistemicSupersessionIndexing({ supersessionIndex: cyclicState });
    expect(resFromObj[0]?.compliant).toBe(false);
    expect(resFromObj[0]?.severity).toBe("ERROR");
    expect(resFromObj[0]?.details?.cycleCount).toBe(1);

    const resFromState = auditEpistemicSupersessionIndexing({
      state: { supersession_index: cyclicState },
    });
    expect(resFromState[0]?.compliant).toBe(false);
  });
});

describe("auditSuspendedAnimationProtocol", () => {
  beforeEach(() => {
    setupVirtualReportingFS();
  });

  afterEach(() => {
    cleanupVirtualReportingFS();
  });

  test("passes when no snapshot exists or snapshot is valid", async () => {
    expect(auditSuspendedAnimationProtocol({})[0]?.compliant).toBe(true);

    const engine = createSuspendedAnimationEngine();
    const snapshot = await engine.initiateSuspension({ reason: "normal" });
    expect(auditSuspendedAnimationProtocol({ suspendedSnapshot: snapshot })[0]?.compliant).toBe(
      true,
    );
  });

  test("flags snapshot checksum corruption, cyclic DAG, and corrupt timers", async () => {
    const engine = createSuspendedAnimationEngine();
    const baseSnapshot = await engine.initiateSuspension({ reason: "normal" });

    // Checksum invalid
    const badChecksum = { ...baseSnapshot, checksum: "invalid-checksum" };
    const resBadChecksum = auditSuspendedAnimationProtocol({ suspendedSnapshot: badChecksum });
    expect(resBadChecksum[0]?.compliant).toBe(false);
    expect(resBadChecksum[0]?.message).toContain("checksum verification failed");

    // Cyclic task DAG
    const cyclicTasks: SuspendedTaskNode[] = [
      {
        taskId: "t1",
        title: "T1",
        status: "SUSPENDED",
        priority: "high",
        dependencies: [],
        dependents: ["t2"],
        suspendedAtMs: 1,
      },
      {
        taskId: "t2",
        title: "T2",
        status: "SUSPENDED",
        priority: "high",
        dependencies: [],
        dependents: ["t1"],
        suspendedAtMs: 1,
      },
    ];
    const { checksum: _c1, ...unsignedCyclic } = { ...baseSnapshot, tasksDag: cyclicTasks };
    const cyclicDagSnapshot: SuspendedAnimationSnapshot = {
      ...unsignedCyclic,
      checksum: computeSnapshotChecksum(unsignedCyclic),
    };
    const resCyclic = auditSuspendedAnimationProtocol({ suspendedSnapshot: cyclicDagSnapshot });
    expect(resCyclic[0]?.compliant).toBe(false);
    expect(resCyclic[0]?.message).toContain("contains cyclic dependencies");

    // Corrupt timers (< 0 or NaN)
    const { checksum: _c2, ...unsignedTimers } = {
      ...baseSnapshot,
      frozenTimers: [
        { id: "timer-negative", remainingDurationMs: -100 },
        { id: "timer-nan", remainingDurationMs: NaN },
      ],
    };
    const corruptTimersSnapshot: SuspendedAnimationSnapshot = {
      ...unsignedTimers,
      checksum: computeSnapshotChecksum(unsignedTimers),
    };
    const resTimers = auditSuspendedAnimationProtocol({ suspendedSnapshot: corruptTimersSnapshot });
    expect(resTimers[0]?.compliant).toBe(false);
    expect(resTimers[0]?.message).toContain("contains 2 corrupted timer(s)");
  });

  test("reads snapshot from disk via repoRoot and detects unreadable snapshot", async () => {
    const repo = tempDir("susp-test");
    expect(auditSuspendedAnimationProtocol({ repoRoot: repo })[0]?.compliant).toBe(true);

    // Corrupted file on disk
    const diskPath = join(repo, ".olt", "suspended-state.json");
    fs.mkdirSync(join(repo, ".olt"), { recursive: true });
    fs.writeFileSync(diskPath, "not valid json {");
    const resCorrupt = auditSuspendedAnimationProtocol({ repoRoot: repo });
    expect(resCorrupt[0]?.compliant).toBe(false);
    expect(resCorrupt[0]?.message).toContain("Corrupted or unreadable");

    // Valid file on disk
    const engine = createSuspendedAnimationEngine();
    const validSnap = await engine.initiateSuspension({ reason: "disk" });
    const sanitized = JSON.parse(JSON.stringify(validSnap));
    const { checksum: _c, ...unsigned } = sanitized;
    sanitized.checksum = computeSnapshotChecksum(unsigned);
    writeSnapshotToDisk(repo, sanitized);
    const resValidDisk = auditSuspendedAnimationProtocol({ repoRoot: repo });
    expect(resValidDisk[0]?.compliant).toBe(true);
  });
});

describe("auditInflightWorkIngestion and auditDiagnosticClustering", () => {
  test("evaluates inflight work ingestion notices", () => {
    expect(auditInflightWorkIngestion({})[0]?.compliant).toBe(true);
    expect(
      auditInflightWorkIngestion({ state: { mind: {}, snapshot_id: "s1", snapshot: {} } })[0]
        ?.compliant,
    ).toBe(true);

    const incomplete = auditInflightWorkIngestion({ state: { mind: {}, snapshot_id: "s1" } });
    expect(incomplete[0]?.compliant).toBe(false);
    expect(incomplete[0]?.severity).toBe("WARN");
    expect(incomplete[0]?.details?.snapshotId).toBe("s1");
  });

  test("evaluates diagnostic clustering blockers and health status", () => {
    expect(auditDiagnosticClustering({})[0]?.compliant).toBe(true);
    expect(
      auditDiagnosticClustering({ state: { deficit_topology: { summary: "not-obj" } } })[0]
        ?.compliant,
    ).toBe(true);

    const nominal = {
      state: { deficit_topology: { summary: { healthStatus: "NOMINAL", blockers: 12 } } },
    };
    expect(auditDiagnosticClustering(nominal)[0]?.compliant).toBe(true);

    const lowBlockers = {
      state: { deficit_topology: { summary: { healthStatus: "CRITICAL", blockers: 5 } } },
    };
    expect(auditDiagnosticClustering(lowBlockers)[0]?.compliant).toBe(true);

    const critical = {
      state: { deficit_topology: { summary: { healthStatus: "CRITICAL", blockers: 15 } } },
    };
    const resCritical = auditDiagnosticClustering(critical);
    expect(resCritical[0]?.compliant).toBe(false);
    expect(resCritical[0]?.severity).toBe("WARN");
    expect(resCritical[0]?.details?.blockers).toBe(15);
  });
});
