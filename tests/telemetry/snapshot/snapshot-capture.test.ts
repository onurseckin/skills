import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  STANDARD_SUPERVISORY_CRONS,
  captureDagSnapshot,
  formatDagSnapshotMarkdown,
  type QuotaDagSnapshot,
} from "../../../olt/scripts/src/telemetry/snapshot/index.ts";
import type { CircuitBreakerEvaluation } from "../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";

describe("Telemetry Quota DAG Snapshot Capture Suite", () => {
  const roots: string[] = [];
  let testDir: string;

  beforeEach(() => {
    testDir = realpathSync(mkdtempSync(join(tmpdir(), "snapshot-capture-")));
    roots.push(testDir);
    const git = spawnSync("git", ["init", "--quiet", testDir]);
    if (git.status !== 0) throw new Error("git init failed");
  });

  afterEach(() => {
    for (const root of roots.splice(0)) {
      if (existsSync(root)) {
        rmSync(root, { recursive: true, force: true });
      }
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
    writeFileSync(join(testDir, "memory.json"), JSON.stringify(memoryData));

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
});
