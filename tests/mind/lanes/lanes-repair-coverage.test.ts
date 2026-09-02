import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { dirname, join } from "node:path";
import { initRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { executeRepairLane } from "../../../olt/scripts/src/mind/lanes/repair.ts";
import {
  cleanupVirtualStoreFS,
  getVirtualStoreFS,
  scratchRoot,
  setupVirtualStoreFS,
} from "../../store/store-fixture.ts";

describe("Mind Repair Lane Coverage Suite", () => {
  beforeEach(() => setupVirtualStoreFS());
  afterEach(() => cleanupVirtualStoreFS());

  function createMindFixture(label: string) {
    const repoRoot = scratchRoot(import.meta.path, `${label}-repo`);
    const prompt = new TextEncoder().encode("Mind test prompt");
    const mindRunRoot = initRun(repoRoot, `mind-${label}`, prompt, "file", true);
    return { repoRoot, mindRunRoot };
  }

  it("handles non-existent runRoot and default options gracefully", async () => {
    const nonExistentPath = "/virtual/store-scratch/non-existent-run-root";
    const result = await executeRepairLane({ runRoot: nonExistentPath, writeReport: true });

    expect(result.inspectedRuns).toEqual([]);
    expect(result.reportPath).toBeUndefined();
    expect(result.hasSignals).toBe(false);
    expect(result.triageCounts).toEqual({
      openFindings: 0,
      failingGates: 0,
      escalations: 0,
      declinedCandidates: 0,
      openProposals: 0,
      totalSignals: 0,
    });
    expect(result.markdown).toContain("Escalation Digest");
  });

  it("inspects live runs, skips completed runs, ignores files/dot-dirs, and writes markdown report", async () => {
    const { repoRoot, mindRunRoot } = createMindFixture("standard");
    const prompt = new TextEncoder().encode("Sub run prompt");

    // 1. Active run with open findings and escalations
    const activeRunRoot = initRun(repoRoot, "active-child-run", prompt, "file", true);
    transact(activeRunRoot, "tester", "add_signals", {}, (draft) => {
      draft.escalations = [{ id: "esc-1", reason: "budget_exceeded" }];
      draft.tasks = {
        "task-1": {
          open_finding_ids: ["f-1"],
          findings: [{ id: "f-1", observation: "Unused export" }],
        },
      } as unknown as Record<string, unknown>;
    });

    // 2. Completed run (should be skipped)
    const completedRunRoot = initRun(repoRoot, "completed-child-run", prompt, "file", true);
    transact(completedRunRoot, "tester", "complete", {}, (draft) => {
      draft.completion_result = { status: "complete" };
    });

    // 3. Regular non-directory file in capsules dir
    const capsulesDir = dirname(mindRunRoot);
    const vfs = getVirtualStoreFS();
    vfs.writeFileSync(join(capsulesDir, "notes.txt"), "regular file");

    // 4. Dot-directory in capsules dir
    vfs.mkdirSync(join(capsulesDir, ".hidden-dir"), { recursive: true });

    // 5. Corrupted unreadable capsule dir
    vfs.mkdirSync(join(capsulesDir, "corrupted-capsule"), { recursive: true });

    const now = new Date("2026-09-01T12:00:00.000Z");
    const result = await executeRepairLane({
      runRoot: mindRunRoot,
      capsulesDir,
      now,
      writeReport: true,
    });

    expect(result.inspectedRuns).toContain("mind-standard");
    expect(result.inspectedRuns).toContain("active-child-run");
    expect(result.inspectedRuns).not.toContain("completed-child-run");
    expect(result.inspectedRuns).not.toContain("corrupted-capsule");
    expect(result.hasSignals).toBe(true);
    expect(result.triageCounts.openFindings).toBeGreaterThanOrEqual(1);
    expect(result.triageCounts.escalations).toBeGreaterThanOrEqual(1);
    expect(result.reportPath).toBe(join(mindRunRoot, "reports", "escalation-digest.md"));

    const writtenContent = vfs.readFileSync(result.reportPath!, "utf-8");
    expect(writtenContent).toContain("Escalation Digest");
  });

  it("respects writeReport = false and skips writing markdown report", async () => {
    const { mindRunRoot } = createMindFixture("no-report");
    const result = await executeRepairLane({
      runRoot: mindRunRoot,
      writeReport: false,
    });

    expect(result.reportPath).toBeUndefined();
    const vfs = getVirtualStoreFS();
    expect(vfs.existsSync(join(mindRunRoot, "reports", "escalation-digest.md"))).toBe(false);
  });

  it("handles mkdirSync error gracefully when creating reports directory fails", async () => {
    const { mindRunRoot } = createMindFixture("mkdir-error");
    const vfs = getVirtualStoreFS();
    // Remove default pre-created reports dir to exercise mkdirSync error
    vfs.rmSync(join(mindRunRoot, "reports"), { recursive: true, force: true });

    const origMkdir = vfs.mkdirSync.bind(vfs);
    vfs.mkdirSync = (path, opt) => {
      if (String(path).includes("reports")) {
        throw new Error("EACCES: permission denied");
      }
      return origMkdir(path, opt);
    };

    try {
      const result = await executeRepairLane({
        runRoot: mindRunRoot,
        writeReport: true,
      });
      expect(result.reportPath).toBeUndefined();
    } finally {
      vfs.mkdirSync = origMkdir;
    }
  });

  it("handles unreadable mind runRoot and readdirSync exceptions gracefully", async () => {
    const { mindRunRoot } = createMindFixture("unreadable-mind");
    const vfs = getVirtualStoreFS();
    vfs.writeFileSync(join(mindRunRoot, "state.json"), "{ invalid-json }");

    const origReaddir = vfs.readdirSync.bind(vfs);
    vfs.readdirSync = (path, opt) => {
      if (String(path).includes("capsules")) {
        throw new Error("EPERM: operation not permitted");
      }
      return origReaddir(path, opt);
    };

    try {
      const result = await executeRepairLane({
        runRoot: mindRunRoot,
        capsulesDir: dirname(mindRunRoot),
        writeReport: false,
      });
      expect(result.inspectedRuns).toEqual([]);
      expect(result.hasSignals).toBe(false);
    } finally {
      vfs.readdirSync = origReaddir;
    }
  });
});
