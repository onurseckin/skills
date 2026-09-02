import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  pruneAndArchiveGenerationalState,
  isEffectivelyEmptyDirectory,
} from "../../../olt/scripts/src/mind/archival/writer.ts";

describe("pruneAndArchiveGenerationalState", () => {
  let tempDir: string;
  let capsulesDir: string;
  let sourceRunRoot: string;
  let targetRunRoot: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "writer-test-"));
    capsulesDir = join(tempDir, "capsules");
    sourceRunRoot = join(capsulesDir, "source-run");
    targetRunRoot = join(capsulesDir, "target-run");
    mkdirSync(sourceRunRoot, { recursive: true });
    mkdirSync(targetRunRoot, { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles empty sourceState with default options", () => {
    const res = pruneAndArchiveGenerationalState({
      sourceState: {},
      sourceGeneration: 1,
      capsulesDir,
    });
    expect(res.archivedCount).toBe(0);
    expect(res.prunedCount).toBe(0);
    expect(res.carriedCandidates).toEqual([]);
    expect(res.carriedObjectives).toEqual([]);
    expect(res.carriedTasks).toEqual([]);
    expect(res.archivalPath).toBe(join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl"));
    expect(res.consolidatedCapsules).toBeUndefined();
    expect(res.prunedBoilerplateDirectories).toBeUndefined();
  });

  it("archives completed candidates older than cutoff with various field configurations", () => {
    const fixedNow = "2026-09-01T15:00:00.000Z";
    const sourceState = {
      candidates: [
        {
          id: "cand-1",
          status: "closed",
          statement: "Completed cand 1",
          generation: 1,
          decided_at: "2026-08-01T10:00:00.000Z",
          result: "achieved",
          write_scope: ["src/a.ts"],
          charter_goals: ["G1", "G2"],
          kind: "feature",
          decline_reason: null,
          gate_failed: null,
          rationale: "Rationale 1",
        },
        {
          id: "cand-2",
          status: "declined",
          generation: 1,
          completed_at: "2026-08-02T10:00:00.000Z",
          charter_goal_ids: ["G3"],
          decline_reason: "Out of scope",
          gate_failed: "gate-1",
        },
        {
          // fallback defaults for missing fields
          status: "closed",
          generation: 1,
        },
        {
          // recent completed candidate (generation 3 > cutoff 1) -> carried
          id: "cand-recent",
          status: "closed",
          generation: 3,
        },
        {
          // open candidate -> carried
          id: "cand-open",
          status: "opened",
          generation: 1,
        },
      ],
    };

    const res = pruneAndArchiveGenerationalState({
      sourceState,
      sourceGeneration: 4,
      retentionGenerations: 2, // cutoff = 4 - 2 = 2
      nowIso: fixedNow,
      capsulesDir,
      sourceRunRoot,
    });

    expect(res.archivedCount).toBe(3);
    expect(res.carriedCandidates).toHaveLength(2);
    expect(res.carriedCandidates.map((c) => c.id)).toEqual(["cand-recent", "cand-open"]);

    const [arch1, arch2, arch3] = res.archivedRecords;
    expect(arch1?.id).toBe("cand-1");
    expect(arch1?.completed_at).toBe("2026-08-01T10:00:00.000Z");
    expect(arch1?.result).toBe("achieved");
    expect(arch1?.write_scope).toEqual(["src/a.ts"]);
    expect(arch1?.charter_goals).toEqual(["G1", "G2"]);

    expect(arch2?.id).toBe("cand-2");
    expect(arch2?.completed_at).toBe("2026-08-02T10:00:00.000Z");
    expect(arch2?.result).toBe("declined");
    expect(arch2?.charter_goals).toEqual(["G3"]);

    expect(arch3?.id).toBe("cand-unknown");
    expect(arch3?.statement).toBe("Candidate cand-unknown");
    expect(arch3?.completed_at).toBe(fixedNow);

    // Verify dual archival copies written to disk
    expect(existsSync(res.archivalPath)).toBe(true);
    expect(existsSync(join(sourceRunRoot, "ARCHIVED_OBJECTIVES.jsonl"))).toBe(true);
  });

  it("archives completed objectives older than cutoff", () => {
    const sourceState = {
      objectives: [
        {
          id: "obj-1",
          status: "closed",
          statement: "Objective 1",
          generation: 1,
          updated_at: "2026-08-10T12:00:00.000Z",
          candidate_id: "cand-1",
          current_round: 2,
          max_rounds: 3,
          rounds: [{ round: 1 }, { round: 2 }],
        },
        {
          id: "obj-2",
          status: "completed",
          generation: 1,
          completed_at: "2026-08-11T12:00:00.000Z",
        },
        {
          // missing optional fields
          status: "converged",
          generation: 1,
        },
        {
          // active objective -> carried
          id: "obj-active",
          status: "active",
          generation: 1,
        },
      ],
    };

    const res = pruneAndArchiveGenerationalState({
      sourceState,
      sourceGeneration: 3,
      retentionGenerations: 1, // cutoff = 3 - 1 = 2
      capsulesDir,
    });

    expect(res.archivedCount).toBe(3);
    expect(res.carriedObjectives).toHaveLength(1);
    expect(res.carriedObjectives[0]?.id).toBe("obj-active");

    const [arch1, arch2, arch3] = res.archivedRecords;
    expect(arch1?.id).toBe("obj-1");
    expect(arch1?.type).toBe("objective");
    expect(arch1?.completed_at).toBe("2026-08-10T12:00:00.000Z");
    expect(arch1?.details?.rounds_count).toBe(2);

    expect(arch2?.id).toBe("obj-2");
    expect(arch2?.completed_at).toBe("2026-08-11T12:00:00.000Z");

    expect(arch3?.id).toBe("obj-unknown");
    expect(arch3?.statement).toBe("Objective obj-unknown");
    expect(arch3?.details?.rounds_count).toBe(0);
  });

  it("archives completed tasks from array and object dictionary forms", () => {
    const arrayTasksState = {
      tasks: [
        {
          id: "task-1",
          status: "completed",
          label: "Build feature",
          generation: 1,
          completed_at: "2026-08-05T00:00:00.000Z",
          write_scope: ["lib/x.ts"],
          role: "implementer",
        },
        null, // non-object entry ignored
        123,
        {
          // missing fields
          status: "resolved",
          generation: 1,
        },
        {
          id: "task-in-flight",
          status: "in_progress",
          generation: 1,
        },
      ],
    };

    const resArray = pruneAndArchiveGenerationalState({
      sourceState: arrayTasksState,
      sourceGeneration: 4,
      capsulesDir,
    });

    expect(resArray.archivedCount).toBe(2);
    expect(resArray.carriedTasks).toHaveLength(1);
    expect(resArray.archivedRecords[0]?.id).toBe("task-1");
    expect(resArray.archivedRecords[0]?.type).toBe("task");
    expect(resArray.archivedRecords[1]?.id).toBe("task-unknown");

    const dictTasksState = {
      tasks: {
        t1: {
          id: "task-dict-1",
          status: "completed",
          label: "Dict task",
          generation: 1,
          role: "validator",
        },
        t2: "not an object",
      },
    };

    const resDict = pruneAndArchiveGenerationalState({
      sourceState: dictTasksState,
      sourceGeneration: 4,
      capsulesDir,
    });
    expect(resDict.archivedCount).toBe(1);
    expect(resDict.archivedRecords[0]?.id).toBe("task-dict-1");
  });

  it("handles boilerplate pruning and capsule consolidation options", () => {
    // Create empty boilerplate directories in source and target run roots
    const sourceBoilerplate = join(sourceRunRoot, "blobs");
    const targetBoilerplate = join(targetRunRoot, "commands");
    mkdirSync(sourceBoilerplate, { recursive: true });
    mkdirSync(targetBoilerplate, { recursive: true });

    const res = pruneAndArchiveGenerationalState({
      sourceState: {},
      sourceGeneration: 3,
      capsulesDir,
      sourceRunRoot,
      targetRunRoot,
      pruneBoilerplateOnDisk: true,
      consolidateCapsulesOnDisk: true,
    });

    expect(res.consolidatedCapsules).toBeDefined();
    expect(res.prunedBoilerplateDirectories).toBeDefined();
    expect(res.prunedBoilerplateDirectories).toHaveLength(2);

    // Test with pruneBoilerplateOnDisk = false
    const resNoPrune = pruneAndArchiveGenerationalState({
      sourceState: {},
      sourceGeneration: 3,
      capsulesDir,
      sourceRunRoot,
      pruneBoilerplateOnDisk: false,
    });
    expect(resNoPrune.prunedBoilerplateDirectories).toBeUndefined();
  });

  it("tests isEffectivelyEmptyDirectory re-export directly", () => {
    const emptySub = join(tempDir, "empty-sub");
    mkdirSync(emptySub, { recursive: true });
    expect(isEffectivelyEmptyDirectory(emptySub)).toBe(true);

    const nonEmptySub = join(tempDir, "non-empty-sub");
    mkdirSync(nonEmptySub, { recursive: true });
    writeFileSync(join(nonEmptySub, "file.txt"), "hello");
    expect(isEffectivelyEmptyDirectory(nonEmptySub)).toBe(false);

    expect(isEffectivelyEmptyDirectory(join(tempDir, "non-existent"))).toBe(true);
  });
});
