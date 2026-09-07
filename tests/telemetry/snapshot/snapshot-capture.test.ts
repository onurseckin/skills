import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  STANDARD_SUPERVISORY_CRONS,
  __setDagSnapshotCaptureTestHook,
  captureDagSnapshot,
  formatDagSnapshotMarkdown,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/snapshot/index.ts";
import type { CircuitBreakerEvaluation } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

export const snapshotCaptureSuiteName = "Telemetry Quota DAG Snapshot Capture Suite";

describe(snapshotCaptureSuiteName, () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession | null = null;
  let testDir: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    testDir = "/virtual/snapshot-capture";
    vfs.mkdirSync(testDir, { recursive: true });
    vfs.mkdirSync(join(testDir, ".git"), { recursive: true });
    __setDagSnapshotCaptureTestHook(() => ({ status: 0, stdout: "" }));
  });

  afterEach(() => {
    __setDagSnapshotCaptureTestHook(undefined);
    if (session) {
      session.cleanup();
      session = null;
    }
  });

  function createTestSnapshot(
    repoRoot = testDir,
    runRoot = testDir,
    lowestQuotaObserved = 5,
  ): QuotaDagSnapshot {
    return {
      version: "2",
      repositoryRoot: repoRoot,
      runRoot,
      frozenAt: "2026-01-01T00:00:00.000Z",
      status: "frozen",
      tasks: [],
      agents: [],
      cronsSuspended: STANDARD_SUPERVISORY_CRONS,
      uncommittedFiles: [],
      lowestQuotaObserved,
      constrainedModels: ["claude-3-opus"],
      autoWakeSchedule: {
        resetTime: "2026-01-01T01:00:00.000Z",
        resumeTime: "2026-01-01T01:01:00.000Z",
      },
    };
  }

  it("captures valid snapshot without memory.json", async () => {
    const snap = await captureDagSnapshot({
      runRoot: testDir,
      repositoryRoot: testDir,
      lowestQuotaObserved: 10,
      constrainedModels: ["gpt-4"],
      resetTime: "2026-01-01T02:00:00.000Z",
    });

    expect(snap.version).toBe("2");
    expect(snap.status).toBe("frozen");
    expect(snap.lowestQuotaObserved).toBe(10);
    expect(snap.constrainedModels).toEqual(["gpt-4"]);
    expect(snap.cronsSuspended).toEqual(STANDARD_SUPERVISORY_CRONS);
    expect(snap.autoWakeSchedule.resumeTime).toBe("2026-01-01T02:01:00.000Z");
  });

  it("parses memory.json when present in runRoot", async () => {
    const memoryData = {
      tasks: [{ id: "task-1", status: "running", effortMath: "3 Work", dependencies: [] }],
      agents: [{ id: "agent-alpha", role: "implementer", status: "busy" }],
      activeWave: { waveId: "wave-001", status: "in_progress", lanes: ["lane-a", "lane-b"] },
    };
    vfs.writeFileSync(join(testDir, "memory.json"), JSON.stringify(memoryData));

    const snap = await captureDagSnapshot({
      runRoot: testDir,
      repositoryRoot: testDir,
      lowestQuotaObserved: null,
      constrainedModels: [],
      resetTime: "2026-01-01T03:00:00.000Z",
    });

    expect(snap.tasks).toHaveLength(1);
    expect(snap.tasks[0]?.id).toBe("task-1");
    expect(snap.agents).toHaveLength(1);
    expect(snap.agents[0]?.id).toBe("agent-alpha");
    expect(snap.activeWave?.waveId).toBe("wave-001");
    expect(snap.activeWave?.lanes).toEqual(["lane-a", "lane-b"]);
  });

  it("throws HarnessError on invalid lowestQuotaObserved or invalid resetTime", async () => {
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: -5,
        constrainedModels: [],
        resetTime: "2026-01-01T00:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);

    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: 5,
        constrainedModels: [],
        resetTime: "not-a-valid-date",
      }),
    ).rejects.toThrow(HarnessError);
  });

  it("formats snapshot markdown summary and detailed outputs", () => {
    const snap = createTestSnapshot();
    snap.tasks = [{ id: "t-1", status: "done", effortMath: "1 Work", dependencies: [] }];
    snap.uncommittedFiles = ["src/test.ts"];

    const evalData: CircuitBreakerEvaluation = {
      status: "constrained",
      isTriggered: true,
      lowestRemainingQuota: 5,
      constrainedModels: [{ modelName: "claude-3-opus" }],
      breakerStates: [],
    };

    const summaryMd = formatDagSnapshotMarkdown(snap, evalData, false);
    expect(summaryMd).toContain("## Quota DAG Snapshot");
    expect(summaryMd).toContain("5%");
    expect(summaryMd).not.toContain("src/test.ts");

    const detailedMd = formatDagSnapshotMarkdown(snap, evalData, true);
    expect(detailedMd).toContain("src/test.ts");
    expect(detailedMd).toContain("t-1");
  });

  it("Probe 1: rejects malformed memory.json and git status failure with INTEGRITY error", async () => {
    // Malformed JSON
    vfs.writeFileSync(join(testDir, "memory.json"), "{ unparseable-json");
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: null,
        constrainedModels: [],
        resetTime: "2026-01-01T04:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);

    // Non-object memory.json
    vfs.writeFileSync(join(testDir, "memory.json"), JSON.stringify([1, 2, 3]));
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: null,
        constrainedModels: [],
        resetTime: "2026-01-01T04:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);

    // Tasks not an array
    vfs.writeFileSync(join(testDir, "memory.json"), JSON.stringify({ tasks: "not-array" }));
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: null,
        constrainedModels: [],
        resetTime: "2026-01-01T04:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);

    // Git status non-zero exit code throws INTEGRITY error
    vfs.writeFileSync(join(testDir, "memory.json"), JSON.stringify({ tasks: [] }));
    __setDagSnapshotCaptureTestHook(() => ({ status: 1, stdout: "fatal: git error" }));
    expect(
      captureDagSnapshot({
        runRoot: testDir,
        repositoryRoot: testDir,
        lowestQuotaObserved: null,
        constrainedModels: [],
        resetTime: "2026-01-01T04:00:00.000Z",
      }),
    ).rejects.toThrow(HarnessError);
  });
});
