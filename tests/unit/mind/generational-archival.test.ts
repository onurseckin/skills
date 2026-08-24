import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mindInitCommand } from "../../../olt/scripts/src/cli/commands/mind-init.ts";
import {
  formatMindRotateBrief,
  mindRotateCommand,
} from "../../../olt/scripts/src/cli/commands/mind-rotate.ts";
import type { JsonObject, JsonValue } from "../../../olt/scripts/src/core/contracts/json.ts";
import { HarnessError } from "../../../olt/scripts/src/core/errors/harness-error.ts";
import {
  appendArchivedObjectives,
  archiveCapsule,
  consolidateCapsules,
  extractItemGeneration,
  isArchivedItemType,
  isEffectivelyEmptyDirectory,
  isItemCompleted,
  pruneAndArchiveGenerationalState,
  pruneCapsuleBoilerplate,
  readArchivedObjectives,
  resolveArchivedObjectivesPath,
  validateArchivedObjectiveRecord,
  writeArchivedObjectives,
  BOILERPLATE_CAPSULE_SUBDIRECTORIES,
  type ArchivedObjectiveRecord,
} from "../../../olt/scripts/src/mind/archival.ts";
import {
  evaluateGate6NotADuplicate,
  type CandidateRecord,
  type GateEvaluationContext,
} from "../../../olt/scripts/src/mind/gates.ts";
import {
  buildMemoryIndex,
  createMemoryDocument,
  indexAllMemory,
  indexArchivedObjectiveDocuments,
  searchMemory,
} from "../../../olt/scripts/src/mind/memory.ts";
import { rotateMindGeneration } from "../../../olt/scripts/src/mind/rotate.ts";
import type { ObjectiveRecord } from "../../../olt/scripts/src/mind/rounds.ts";
import { verifyIntegrity } from "../../../olt/scripts/src/engine/store/integrity.ts";
import { loadRun } from "../../../olt/scripts/src/engine/store/load.ts";
import { transact } from "../../../olt/scripts/src/engine/store/transaction.ts";
import { scratchRoot as makeScratchRoot } from "../../support/scratch-root.ts";

function scratchRoot(label: string): string {
  return makeScratchRoot(import.meta.path, label);
}

const SAMPLE_CHARTER = `
# System Charter

## identity
Autonomous Mind supervising generational state archival and long-task orchestration.

## goals
- G1: Maintain zero type regressions and zero memory state leaks
- G2: Enforce generational state archival for completed items older than 2 generations
- G3: Preserve active candidate and recent objective records in active state

## non-goals
- Modifying production secrets

## repo_roots
- \`src/\`
- \`docs/\`
- \`tests/\`

## stability
- \`bun test\` -> exit 0

## budgets
- pulses_per_day: 48
- wall_clock_ms_per_day: 4h
- max_agents_in_flight: 4
- max_rounds_per_objective: 5
- base_interval_ms: 10m
- max_interval_ms: 2h
- max_pause_interval_ms: 20m
- pulse_deadline_ms: 15m
- max_open_proposals: 3
- quiet_hours: 23:00-05:00

## prohibitions
Never delete active candidate records prematurely.

## escalation
Ping the on-call engineer on critical failures.
`;

function setupMindCapsule(
  label: string,
  options: {
    readonly charterText?: string;
    readonly pulseCounter?: number;
    readonly budgetOverride?: Record<string, unknown>;
    readonly candidates?: readonly CandidateRecord[];
    readonly objectives?: readonly ObjectiveRecord[];
    readonly tasks?: readonly Record<string, unknown>[];
  } = {},
): { repoRoot: string; runRoot: string; charterPath: string } {
  const repo = scratchRoot(label);
  const charterPath = join(repo, "CHARTER.md");
  writeFileSync(charterPath, options.charterText ?? SAMPLE_CHARTER, "utf-8");

  const initResult = mindInitCommand({
    repo,
    charter: "CHARTER.md",
    actor: "owner-alice",
  });

  const runRoot = initResult.run_root as string;

  if (
    options.pulseCounter !== undefined ||
    options.budgetOverride !== undefined ||
    options.candidates !== undefined ||
    options.objectives !== undefined ||
    options.tasks !== undefined
  ) {
    transact(runRoot, "owner-alice", "mind-customized-test", {}, (state) => {
      if (options.pulseCounter !== undefined) {
        const pulse = (state.pulse ?? {}) as Record<string, unknown>;
        pulse.counter = options.pulseCounter;
        state.pulse = pulse as unknown as JsonObject;
      }
      if (options.budgetOverride !== undefined) {
        const budget = (state.budget ?? {}) as Record<string, unknown>;
        for (const [key, val] of Object.entries(options.budgetOverride)) {
          budget[key] = val;
        }
        state.budget = budget as unknown as JsonObject;
      }
      if (options.candidates !== undefined) {
        state.candidates = options.candidates as unknown as JsonValue;
      }
      if (options.objectives !== undefined) {
        state.objectives = options.objectives as unknown as JsonValue;
      }
      if (options.tasks !== undefined) {
        state.tasks = options.tasks as unknown as JsonValue;
      }
    });
  }

  return { repoRoot: repo, runRoot, charterPath };
}

describe("Generational State Archival (REMED-007)", () => {
  describe("Unit helpers: archival.ts", () => {
    test("isArchivedItemType verifies allowed types", () => {
      expect(isArchivedItemType("objective")).toBe(true);
      expect(isArchivedItemType("candidate")).toBe(true);
      expect(isArchivedItemType("task")).toBe(true);
      expect(isArchivedItemType("invalid")).toBe(false);
      expect(isArchivedItemType(123)).toBe(false);
      expect(isArchivedItemType(null)).toBe(false);
    });

    test("validateArchivedObjectiveRecord validates valid records and handles defaults", () => {
      const validObj = {
        id: "obj-1",
        type: "objective",
        statement: "Test statement",
        generation: 1,
        completed_at: "2026-08-20T00:00:00.000Z",
        result: "converged",
        candidate_id: "cand-1",
        objective_id: "obj-1",
        task_id: "task-1",
        write_scope: ["src/"],
        charter_goals: ["G1"],
        details: { rounds: 2 },
        metadata: { tag: "test" },
      };

      const parsed = validateArchivedObjectiveRecord(validObj);
      expect(parsed.id).toBe("obj-1");
      expect(parsed.type).toBe("objective");
      expect(parsed.statement).toBe("Test statement");
      expect(parsed.generation).toBe(1);
      expect(parsed.completed_at).toBe("2026-08-20T00:00:00.000Z");
      expect(parsed.result).toBe("converged");
      expect(parsed.candidate_id).toBe("cand-1");
      expect(parsed.objective_id).toBe("obj-1");
      expect(parsed.task_id).toBe("task-1");
      expect(parsed.write_scope).toEqual(["src/"]);
      expect(parsed.charter_goals).toEqual(["G1"]);
      expect(parsed.details).toEqual({ rounds: 2 });
      expect(parsed.metadata).toEqual({ tag: "test" });
    });

    test("validateArchivedObjectiveRecord falls back to title, generation_id, closed_at, decided_at, and status", () => {
      const fallbackObj = {
        id: "cand-10",
        title: "Title Fallback",
        generation_id: 2,
        closed_at: "2026-08-21T10:00:00.000Z",
        status: "declined",
        charter_goal_ids: ["G2"],
      };

      const parsed = validateArchivedObjectiveRecord(fallbackObj);
      expect(parsed.id).toBe("cand-10");
      expect(parsed.statement).toBe("Title Fallback");
      expect(parsed.generation).toBe(2);
      expect(parsed.completed_at).toBe("2026-08-21T10:00:00.000Z");
      expect(parsed.result).toBe("declined");
      expect(parsed.charter_goals).toEqual(["G2"]);
    });

    test("validateArchivedObjectiveRecord throws on non-object or missing id", () => {
      expect(() => validateArchivedObjectiveRecord(null)).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord("string")).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord([])).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord({})).toThrow(HarnessError);
      expect(() => validateArchivedObjectiveRecord({ id: "   " })).toThrow(HarnessError);
    });

    test("resolveArchivedObjectivesPath resolves custom, capsulesDir, and default paths", () => {
      const custom = resolveArchivedObjectivesPath(
        undefined,
        "/custom/path/ARCHIVED_OBJECTIVES.jsonl",
      );
      expect(custom).toBe("/custom/path/ARCHIVED_OBJECTIVES.jsonl");

      const fromCapsulesDir = resolveArchivedObjectivesPath("/capsules/dir");
      expect(fromCapsulesDir).toBe("/capsules/dir/ARCHIVED_OBJECTIVES.jsonl");

      const defaultPath = resolveArchivedObjectivesPath();
      expect(defaultPath).toContain("ARCHIVED_OBJECTIVES.jsonl");
    });

    test("readArchivedObjectives and writeArchivedObjectives persist and retrieve correctly", () => {
      const scratch = scratchRoot("archival-io-test");
      const targetFile = join(scratch, "ARCHIVED_OBJECTIVES.jsonl");

      expect(readArchivedObjectives(targetFile)).toEqual([]);

      const sampleRecords: readonly ArchivedObjectiveRecord[] = [
        {
          id: "obj-gen1-1",
          type: "objective",
          statement: "Gen 1 objective",
          generation: 1,
          completed_at: "2026-08-20T00:00:00.000Z",
          result: "converged",
        },
        {
          id: "cand-gen1-2",
          type: "candidate",
          statement: "Gen 1 candidate",
          generation: 1,
          completed_at: "2026-08-20T01:00:00.000Z",
          result: "completed",
        },
      ];

      writeArchivedObjectives(sampleRecords, targetFile);

      const readBack = readArchivedObjectives(targetFile);
      expect(readBack.length).toBe(2);
      expect(readBack[0]?.id).toBe("obj-gen1-1");
      expect(readBack[1]?.id).toBe("cand-gen1-2");

      // Appending deduplicates by ID
      const updated = appendArchivedObjectives(
        [
          {
            id: "obj-gen1-1",
            type: "objective",
            statement: "Gen 1 objective updated",
            generation: 1,
            completed_at: "2026-08-20T00:00:00.000Z",
            result: "converged",
          },
          {
            id: "task-gen1-3",
            type: "task",
            statement: "Gen 1 task",
            generation: 1,
            completed_at: "2026-08-20T02:00:00.000Z",
            result: "completed",
          },
        ],
        targetFile,
      );

      expect(updated.length).toBe(3);
      expect(updated.find((r) => r.id === "obj-gen1-1")?.statement).toBe("Gen 1 objective updated");
      expect(updated.find((r) => r.id === "task-gen1-3")).toBeDefined();
    });

    test("isItemCompleted identifies completed and active items correctly", () => {
      expect(isItemCompleted({ status: "completed" })).toBe(true);
      expect(isItemCompleted({ status: "converged" })).toBe(true);
      expect(isItemCompleted({ status: "resolved" })).toBe(true);
      expect(isItemCompleted({ status: "exhausted" })).toBe(true);
      expect(isItemCompleted({ status: "escalated" })).toBe(true);
      expect(isItemCompleted({ status: "closed" })).toBe(true);
      expect(isItemCompleted({ status: "declined" })).toBe(true);
      expect(isItemCompleted({ result: "converged" })).toBe(true);
      expect(isItemCompleted({ result: "completed" })).toBe(true);

      expect(isItemCompleted({ status: "opened" })).toBe(false);
      expect(isItemCompleted({ status: "admitted" })).toBe(false);
      expect(isItemCompleted({ status: "active" })).toBe(false);
      expect(isItemCompleted({ status: "in_progress" })).toBe(false);
      expect(isItemCompleted({ status: "ready" })).toBe(false);
    });

    test("extractItemGeneration parses explicit generation, string generation_id, and fallback", () => {
      expect(extractItemGeneration({ generation: 3 }, 1)).toBe(3);
      expect(extractItemGeneration({ generation_id: "mind-gen-4" }, 1)).toBe(4);
      expect(extractItemGeneration({ generation_id: "generation_2" }, 1)).toBe(2);
      expect(extractItemGeneration({ generation_id: 5 }, 1)).toBe(5);
      expect(extractItemGeneration({}, 1)).toBe(1);
    });
  });

  describe("Generational Pruning and Retention Logic", () => {
    test("pruneAndArchiveGenerationalState correctly prunes items older than 2 generations and preserves recent items", () => {
      const scratch = scratchRoot("archival-prune-test");
      const archivalPath = join(scratch, "ARCHIVED_OBJECTIVES.jsonl");

      // In Generation 3 (sourceGeneration = 3), cutoff is 3 - 2 = 1.
      // Generation <= 1 completed items must be PRUNED and ARCHIVED.
      // Generation 2 and 3 items (recent) must be PRESERVED in carried state.
      // Active items (opened/admitted) from any generation must be PRESERVED.
      const sourceState: Record<string, unknown> = {
        candidates: [
          // Gen 1 completed -> PRUNE & ARCHIVE
          {
            id: "cand-gen1-done",
            statement: "Gen 1 done candidate",
            generation: 1,
            status: "completed",
            result: "converged",
            completed_at: "2026-08-19T10:00:00.000Z",
            write_scope: ["src/gen1/"],
            charter_goals: ["G1"],
          },
          // Gen 1 declined -> PRUNE & ARCHIVE
          {
            id: "cand-gen1-declined",
            statement: "Gen 1 declined candidate",
            generation: 1,
            status: "declined",
            decided_at: "2026-08-19T11:00:00.000Z",
            decline_reason: "out of charter scope",
          },
          // Gen 1 opened (active) -> PRESERVE
          {
            id: "cand-gen1-open",
            statement: "Gen 1 still open candidate",
            generation: 1,
            status: "opened",
          },
          // Gen 2 completed (recent: 3 - 1 = 2 > 1) -> PRESERVE
          {
            id: "cand-gen2-done",
            statement: "Gen 2 done candidate",
            generation: 2,
            status: "completed",
            result: "converged",
          },
          // Gen 3 completed (current: 3 > 1) -> PRESERVE
          {
            id: "cand-gen3-done",
            statement: "Gen 3 done candidate",
            generation: 3,
            status: "completed",
            result: "converged",
          },
        ],
        objectives: [
          // Gen 1 converged objective -> PRUNE & ARCHIVE
          {
            id: "obj-gen1-converged",
            candidate_id: "cand-gen1-done",
            statement: "Gen 1 converged objective",
            generation: 1,
            status: "converged",
            current_round: 1,
            max_rounds: 3,
            rounds: [],
            created_at: "2026-08-19T10:00:00.000Z",
            updated_at: "2026-08-19T10:30:00.000Z",
          },
          // Gen 2 active objective -> PRESERVE
          {
            id: "obj-gen2-active",
            candidate_id: "cand-gen2-done",
            statement: "Gen 2 active objective",
            generation: 2,
            status: "active",
            current_round: 1,
            max_rounds: 3,
            rounds: [],
            created_at: "2026-08-20T10:00:00.000Z",
            updated_at: "2026-08-20T10:30:00.000Z",
          },
          // Gen 2 converged objective -> PRESERVE (recent)
          {
            id: "obj-gen2-converged",
            candidate_id: "cand-gen2-done",
            statement: "Gen 2 converged objective",
            generation: 2,
            status: "converged",
            current_round: 1,
            max_rounds: 3,
            rounds: [],
            created_at: "2026-08-20T11:00:00.000Z",
            updated_at: "2026-08-20T11:30:00.000Z",
          },
        ],
        tasks: [
          // Gen 1 completed task -> PRUNE & ARCHIVE
          {
            id: "task-gen1-done",
            label: "Gen 1 completed task",
            generation: 1,
            status: "completed",
            completed_at: "2026-08-19T10:15:00.000Z",
          },
          // Gen 3 active task -> PRESERVE
          {
            id: "task-gen3-active",
            label: "Gen 3 active task",
            generation: 3,
            status: "ready",
          },
        ],
      };

      const result = pruneAndArchiveGenerationalState({
        sourceState,
        sourceGeneration: 3,
        retentionGenerations: 2,
        customArchivalPath: archivalPath,
        nowIso: "2026-08-21T12:00:00.000Z",
      });

      // 4 items pruned and archived: cand-gen1-done, cand-gen1-declined, obj-gen1-converged, task-gen1-done
      expect(result.prunedCount).toBe(4);
      expect(result.archivedCount).toBe(4);

      // Verify carried candidates: Gen 1 open, Gen 2 done, Gen 3 done
      expect(result.carriedCandidates.length).toBe(3);
      expect(result.carriedCandidates.map((c) => c.id)).toEqual([
        "cand-gen1-open",
        "cand-gen2-done",
        "cand-gen3-done",
      ]);

      // Verify carried objectives: Gen 2 active, Gen 2 converged
      expect(result.carriedObjectives.length).toBe(2);
      expect(result.carriedObjectives.map((o) => o.id)).toEqual([
        "obj-gen2-active",
        "obj-gen2-converged",
      ]);

      // Verify carried tasks: Gen 3 active
      expect(result.carriedTasks.length).toBe(1);
      expect(result.carriedTasks[0]?.["id"]).toBe("task-gen3-active");

      // Verify ARCHIVED_OBJECTIVES.jsonl format on disk
      expect(existsSync(archivalPath)).toBe(true);
      const archived = readArchivedObjectives(archivalPath);
      expect(archived.length).toBe(4);

      const archCandDone = archived.find((a) => a.id === "cand-gen1-done");
      expect(archCandDone).toBeDefined();
      expect(archCandDone?.type).toBe("candidate");
      expect(archCandDone?.generation).toBe(1);
      expect(archCandDone?.result).toBe("converged");
      expect(archCandDone?.statement).toBe("Gen 1 done candidate");
      expect(archCandDone?.completed_at).toBe("2026-08-19T10:00:00.000Z");
      expect(archCandDone?.write_scope).toEqual(["src/gen1/"]);

      const archCandDeclined = archived.find((a) => a.id === "cand-gen1-declined");
      expect(archCandDeclined).toBeDefined();
      expect(archCandDeclined?.type).toBe("candidate");
      expect(archCandDeclined?.generation).toBe(1);
      expect(archCandDeclined?.result).toBe("declined");
      expect(archCandDeclined?.details?.["decline_reason"]).toBe("out of charter scope");

      const archObjConverged = archived.find((a) => a.id === "obj-gen1-converged");
      expect(archObjConverged).toBeDefined();
      expect(archObjConverged?.type).toBe("objective");
      expect(archObjConverged?.generation).toBe(1);
      expect(archObjConverged?.result).toBe("converged");

      const archTaskDone = archived.find((a) => a.id === "task-gen1-done");
      expect(archTaskDone).toBeDefined();
      expect(archTaskDone?.type).toBe("task");
      expect(archTaskDone?.generation).toBe(1);
      expect(archTaskDone?.result).toBe("completed");
    });
  });

  describe("End-to-End Multi-Generation Rotation & Archival Flow", () => {
    test("rotates from Gen 1 through Gen 4, archiving Gen 1 items upon Gen 3 -> Gen 4 rotation", () => {
      // Step 1: Initialize Generation 1 with candidate and objective records
      const { repoRoot, runRoot: gen1Root } = setupMindCapsule("multi-gen-archival-chain", {
        pulseCounter: 10,
        candidates: [
          {
            id: "cand-gen1-completed",
            kind: "defect",
            statement: "Fix type error in logger",
            generation: 1,
            status: "completed",
            result: "converged",
            write_scope: ["src/logger.ts"],
            charter_goal_ids: ["G1"],
            completed_at: "2026-08-20T01:00:00.000Z",
          },
          {
            id: "cand-gen1-declined",
            kind: "defect",
            statement: "Deprecated API change",
            generation: 1,
            status: "declined",
            decided_at: "2026-08-20T01:30:00.000Z",
            decline_reason: "breaking change without deprecation window",
            write_scope: ["src/api.ts"],
          },
          {
            id: "cand-gen1-active",
            kind: "defect",
            statement: "Ongoing performance optimization",
            generation: 1,
            status: "opened",
            write_scope: ["src/perf.ts"],
          },
        ],
        objectives: [
          {
            id: "obj-gen1-logger",
            candidate_id: "cand-gen1-completed",
            statement: "Fix type error in logger",
            generation: 1,
            status: "converged",
            current_round: 1,
            max_rounds: 3,
            rounds: [],
            created_at: "2026-08-20T01:00:00.000Z",
            updated_at: "2026-08-20T01:30:00.000Z",
          },
        ],
      });

      // Step 2: Rotate Gen 1 -> Gen 2 (sourceGeneration = 1; cutoff = 1 - 2 = -1)
      const rot1 = rotateMindGeneration({
        sourceRunRoot: gen1Root,
        now: "2026-08-21T01:00:00.000Z",
      });

      expect(rot1.sourceGeneration).toBe(1);
      expect(rot1.targetGeneration).toBe(2);
      expect(rot1.archivedCount).toBe(0); // Nothing older than 2 generations
      expect(rot1.carriedCandidates.length).toBe(3);
      expect(rot1.carriedObjectives.length).toBe(1);

      // Verify Generation 2 state has all carried items
      const gen2Loaded = loadRun(rot1.targetRunRoot);
      const gen2State = gen2Loaded.state as Record<string, unknown>;
      const gen2Candidates = gen2State.candidates as readonly CandidateRecord[];
      expect(gen2Candidates.length).toBe(3);

      // Step 3: In Generation 2, add Gen 2 candidate and objective records
      transact(rot1.targetRunRoot, "mind-agent", "add-gen2-records", {}, (state) => {
        const cands = Array.isArray(state.candidates)
          ? (state.candidates as CandidateRecord[])
          : [];
        cands.push({
          id: "cand-gen2-completed",
          kind: "defect",
          statement: "Fix parser boundary bug",
          generation: 2,
          status: "completed",
          result: "converged",
          write_scope: ["src/parser.ts"],
          charter_goal_ids: ["G1"],
          completed_at: "2026-08-21T02:00:00.000Z",
        });
        state.candidates = cands as unknown as JsonValue;

        const objs = Array.isArray(state.objectives) ? (state.objectives as ObjectiveRecord[]) : [];
        objs.push({
          id: "obj-gen2-parser",
          candidate_id: "cand-gen2-completed",
          statement: "Fix parser boundary bug",
          generation: 2,
          status: "converged",
          current_round: 1,
          max_rounds: 3,
          rounds: [],
          created_at: "2026-08-21T02:00:00.000Z",
          updated_at: "2026-08-21T02:30:00.000Z",
        });
        state.objectives = objs as unknown as JsonValue;
      });

      // Step 4: Rotate Gen 2 -> Gen 3 (sourceGeneration = 2; cutoff = 2 - 2 = 0)
      const rot2 = rotateMindGeneration({
        sourceRunRoot: rot1.targetRunRoot,
        now: "2026-08-21T03:00:00.000Z",
      });

      expect(rot2.sourceGeneration).toBe(2);
      expect(rot2.targetGeneration).toBe(3);
      expect(rot2.archivedCount).toBe(0); // Gen 1 (1 > 0) and Gen 2 (2 > 0) are within last 2 generations
      expect(rot2.carriedCandidates.length).toBe(4);
      expect(rot2.carriedObjectives.length).toBe(2);

      // Step 5: In Generation 3, add Gen 3 records
      transact(rot2.targetRunRoot, "mind-agent", "add-gen3-records", {}, (state) => {
        const cands = Array.isArray(state.candidates)
          ? (state.candidates as CandidateRecord[])
          : [];
        cands.push({
          id: "cand-gen3-completed",
          kind: "defect",
          statement: "Fix caching regression",
          generation: 3,
          status: "completed",
          result: "converged",
          write_scope: ["src/cache.ts"],
          charter_goal_ids: ["G1"],
          completed_at: "2026-08-21T04:00:00.000Z",
        });
        state.candidates = cands as unknown as JsonValue;
      });

      // Step 6: Rotate Gen 3 -> Gen 4 (sourceGeneration = 3; cutoff = 3 - 2 = 1)
      // Now, Gen 1 completed/declined items (generation <= 1) MUST BE PRUNED and ARCHIVED!
      // Gen 2 and Gen 3 completed items and Gen 1 active items MUST BE PRESERVED in Gen 4!
      const rot3 = rotateMindGeneration({
        sourceRunRoot: rot2.targetRunRoot,
        now: "2026-08-21T05:00:00.000Z",
      });

      expect(rot3.sourceGeneration).toBe(3);
      expect(rot3.targetGeneration).toBe(4);

      // Pruned & archived count:
      // cand-gen1-completed (gen 1, completed) -> ARCHIVED
      // cand-gen1-declined (gen 1, declined) -> ARCHIVED
      // obj-gen1-logger (gen 1, converged) -> ARCHIVED
      expect(rot3.archivedCount).toBe(3);
      expect(rot3.archivedRecords.length).toBe(3);

      const archivedIds = rot3.archivedRecords.map((r) => r.id);
      expect(archivedIds).toContain("cand-gen1-completed");
      expect(archivedIds).toContain("cand-gen1-declined");
      expect(archivedIds).toContain("obj-gen1-logger");

      // Verify active carried state in Generation 4
      const gen4Loaded = loadRun(rot3.targetRunRoot);
      const gen4State = gen4Loaded.state as Record<string, unknown>;
      const gen4Candidates = gen4State.candidates as readonly CandidateRecord[];
      const gen4Objectives = gen4State.objectives as readonly ObjectiveRecord[];

      // Gen 1 completed & declined are pruned from Gen 4 active state!
      expect(gen4Candidates.some((c) => c.id === "cand-gen1-completed")).toBe(false);
      expect(gen4Candidates.some((c) => c.id === "cand-gen1-declined")).toBe(false);
      expect(gen4Objectives.some((o) => o.id === "obj-gen1-logger")).toBe(false);

      // Recent items (Gen 2 and Gen 3) and active items (Gen 1 open) are PRESERVED!
      expect(gen4Candidates.some((c) => c.id === "cand-gen1-active")).toBe(true);
      expect(gen4Candidates.some((c) => c.id === "cand-gen2-completed")).toBe(true);
      expect(gen4Candidates.some((c) => c.id === "cand-gen3-completed")).toBe(true);
      expect(gen4Objectives.some((o) => o.id === "obj-gen2-parser")).toBe(true);

      // Verify ARCHIVED_OBJECTIVES.jsonl on disk
      const capsulesDir = join(repoRoot, ".olt", "capsules");
      const globalArchivedPath = join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl");
      expect(existsSync(globalArchivedPath)).toBe(true);

      const onDiskArchived = readArchivedObjectives(globalArchivedPath);
      expect(onDiskArchived.length).toBe(3);

      for (const rec of onDiskArchived) {
        expect(typeof rec.id).toBe("string");
        expect(rec.id.length).toBeGreaterThan(0);
        expect(isArchivedItemType(rec.type)).toBe(true);
        expect(rec.generation).toBe(1);
        expect(typeof rec.statement).toBe("string");
        expect(typeof rec.completed_at).toBe("string");
        expect(Number.isFinite(Date.parse(rec.completed_at))).toBe(true);
        expect(typeof rec.result).toBe("string");
      }

      // Step 7: Gate 6 duplicate rejection against archived declined candidate in Gen 4
      const gateContext: GateEvaluationContext = {
        runRoot: rot3.targetRunRoot,
        repoRoot,
        actor: "mind-agent",
        state: gen4State,
        charterGoals: new Set(["G1", "G2", "G3"]),
        repoRoots: ["src/", "docs/", "tests/"],
      };

      // Candidate matching statement and scope of archived declined candidate cand-gen1-declined
      const duplicateCandidate: CandidateRecord = {
        id: "cand-duplicate-of-archived",
        kind: "defect",
        statement: "Deprecated API change",
        write_scope: ["src/api.ts"],
        status: "opened",
      };

      const verdict = evaluateGate6NotADuplicate(duplicateCandidate, gateContext);
      expect(verdict.passed).toBe(false);
      expect(verdict.reason).toContain(
        "duplicate of permanently declined candidate 'cand-gen1-declined'",
      );

      // Step 8: Diagnostics and Integrity verification across all capsules
      expect(verifyIntegrity(gen1Root)).toEqual([]);
      expect(verifyIntegrity(rot1.targetRunRoot)).toEqual([]);
      expect(verifyIntegrity(rot2.targetRunRoot)).toEqual([]);
      expect(verifyIntegrity(rot3.targetRunRoot)).toEqual([]);
    });

    test("mindRotateCommand CLI handler executes rotation and reports archival metrics in markdown brief", () => {
      const { runRoot } = setupMindCapsule("rotate-cli-archival-brief", {
        pulseCounter: 50,
        candidates: [
          {
            id: "cand-old-1",
            kind: "defect",
            statement: "Old fixed issue",
            generation: 1,
            status: "completed",
            result: "converged",
            write_scope: ["src/old/"],
          },
          {
            id: "cand-recent-2",
            kind: "defect",
            statement: "Recent fixed issue",
            generation: 3,
            status: "completed",
            result: "converged",
            write_scope: ["src/recent/"],
          },
        ],
      });

      // Modify generation in state to 3 to test pruning on rotate
      transact(runRoot, "owner-alice", "set-gen-3", {}, (state) => {
        const mind = (state.mind ?? {}) as Record<string, unknown>;
        mind.generation = 3;
        state.mind = mind as unknown as JsonObject;
      });

      const result = mindRotateCommand({
        run: runRoot,
        actor: "owner-alice",
        now: "2026-08-21T15:00:00.000Z",
      });

      expect(result.source_generation).toBe(3);
      expect(result.target_generation).toBe(4);
      expect(result.archived_count).toBe(1);
      expect(result.markdown).toContain("Mind Rotated: Generation 3 → 4");
      expect(result.markdown).toContain("Generational State Archival");
      expect(result.markdown).toContain(
        "1 items pruned (<= Gen 1) and archived to `ARCHIVED_OBJECTIVES.jsonl`",
      );
    });
  });

  describe("Semantic Memory Search integration with ARCHIVED_OBJECTIVES.jsonl", () => {
    test("indexArchivedObjectiveDocuments and searchMemory discover archived objectives", () => {
      const scratch = scratchRoot("memory-archival-search");
      const capsulesDir = join(scratch, ".olt", "capsules");
      const archivalPath = join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl");

      const records: readonly ArchivedObjectiveRecord[] = [
        {
          id: "obj-crypto-migration",
          type: "objective",
          statement: "Migrate cryptographic algorithms from SHA1 to SHA256",
          generation: 1,
          completed_at: "2026-08-10T00:00:00.000Z",
          result: "converged",
          write_scope: ["src/crypto/"],
          charter_goals: ["G1"],
        },
        {
          id: "cand-auth-timeout",
          type: "candidate",
          statement: "Fix authentication token timeout handling in proxy gateway",
          generation: 2,
          completed_at: "2026-08-12T00:00:00.000Z",
          result: "completed",
          write_scope: ["src/auth/"],
          charter_goals: ["G2"],
        },
      ];

      writeArchivedObjectives(records, archivalPath);

      const docs = indexArchivedObjectiveDocuments(capsulesDir);
      expect(docs.length).toBe(2);
      expect(docs[0]?.id).toBe("archived-obj-crypto-migration");
      expect(docs[1]?.id).toBe("archived-cand-auth-timeout");

      const index = buildMemoryIndex(docs);
      const searchResults = searchMemory(index, {
        query: "cryptographic SHA256 migration",
      });

      expect(searchResults.length).toBeGreaterThan(0);
      expect(searchResults[0]?.id).toBe("archived-obj-crypto-migration");
      expect(searchResults[0]?.snippet).toContain("GEN 1 | CONVERGED");

      // indexAllMemory includes archived documents
      const allIndex = indexAllMemory({ repoRoot: scratch, capsulesDir });
      expect(allIndex.total_documents).toBeGreaterThanOrEqual(2);
    });
  });

  describe("Capsule Boilerplate Subdirectory Pruning", () => {
    test("isEffectivelyEmptyDirectory accurately identifies empty and non-empty trees", () => {
      const scratch = scratchRoot("empty-dir-test");
      const emptyDir = join(scratch, "empty");
      const nestedEmpty = join(scratch, "nested-empty", "sub1", "sub2");
      const dsStoreOnly = join(scratch, "ds-store-only");
      const withFile = join(scratch, "with-file");

      mkdirSync(emptyDir, { recursive: true });
      mkdirSync(nestedEmpty, { recursive: true });
      mkdirSync(dsStoreOnly, { recursive: true });
      writeFileSync(join(dsStoreOnly, ".DS_Store"), "dummy");
      mkdirSync(withFile, { recursive: true });
      writeFileSync(join(withFile, "data.txt"), "hello");

      expect(isEffectivelyEmptyDirectory(emptyDir)).toBe(true);
      expect(isEffectivelyEmptyDirectory(nestedEmpty)).toBe(true);
      expect(isEffectivelyEmptyDirectory(join(scratch, "nested-empty"))).toBe(true);
      expect(isEffectivelyEmptyDirectory(dsStoreOnly)).toBe(true);
      expect(isEffectivelyEmptyDirectory(withFile)).toBe(false);
      expect(isEffectivelyEmptyDirectory(join(scratch, "non-existent"))).toBe(true);
    });

    test("pruneCapsuleBoilerplate removes empty boilerplate subdirectories and preserves non-empty ones", () => {
      const { runRoot } = setupMindCapsule("prune-boilerplate-test");

      // Verify that initial capsule has directories like commands, blobs, evidence, reports, planning
      expect(existsSync(join(runRoot, "commands"))).toBe(true);
      expect(existsSync(join(runRoot, "blobs"))).toBe(true);
      expect(existsSync(join(runRoot, "evidence"))).toBe(true);
      expect(existsSync(join(runRoot, "reports"))).toBe(true);
      expect(existsSync(join(runRoot, "planning"))).toBe(true);

      // Populate one directory (commands) with a file
      const cmdDir = join(runRoot, "commands", "C-001");
      mkdirSync(cmdDir, { recursive: true });
      writeFileSync(join(cmdDir, "dummy.txt"), "output");

      // Execute dry-run first
      const dryRunResult = pruneCapsuleBoilerplate(runRoot, { dryRun: true });
      expect(dryRunResult.prunedDirectories).toContain("blobs");
      expect(dryRunResult.prunedDirectories).toContain("evidence");
      expect(dryRunResult.prunedDirectories).toContain("reports");
      expect(dryRunResult.preservedDirectories).toContain("commands");
      expect(existsSync(join(runRoot, "blobs"))).toBe(true); // Still exists in dry run

      // Execute real pruning
      const realResult = pruneCapsuleBoilerplate(runRoot);
      expect(realResult.prunedDirectories).toContain("blobs");
      expect(realResult.prunedDirectories).toContain("evidence");
      expect(realResult.prunedDirectories).toContain("reports");
      expect(realResult.prunedDirectories).toContain("planning");
      expect(realResult.preservedDirectories).toContain("commands");

      // Verify pruned directories are gone from disk
      expect(existsSync(join(runRoot, "blobs"))).toBe(false);
      expect(existsSync(join(runRoot, "evidence"))).toBe(false);
      expect(existsSync(join(runRoot, "reports"))).toBe(false);

      // Verify non-empty directory is preserved
      expect(existsSync(join(runRoot, "commands"))).toBe(true);
      expect(existsSync(join(cmdDir, "dummy.txt"))).toBe(true);

      // Verify core files remain intact
      expect(existsSync(join(runRoot, "manifest.json"))).toBe(true);
      expect(existsSync(join(runRoot, "prompt.md"))).toBe(true);
      expect(existsSync(join(runRoot, "events.jsonl"))).toBe(true);
      expect(existsSync(join(runRoot, "state.json"))).toBe(true);
      expect(existsSync(join(runRoot, "README.md"))).toBe(true);
      expect(existsSync(join(runRoot, "index.json"))).toBe(true);
      expect(existsSync(join(runRoot, "trace.md"))).toBe(true);

      // Verify integrity continues to pass 100%
      expect(verifyIntegrity(runRoot)).toEqual([]);
    });
  });

  describe("Capsule Directory Consolidation & Legacy Root Archival", () => {
    test("archiveCapsule moves legacy capsule root into .capsules/archive/<runId>", () => {
      const { repoRoot, runRoot } = setupMindCapsule("archive-capsule-test");
      const runId = "archive-capsule-test";

      const archiveResult = archiveCapsule(runRoot);
      expect(archiveResult.runId).toContain("mind-gen-1");
      expect(archiveResult.archivedPath).toContain(join(".olt", "capsules", "archive"));
      expect(existsSync(runRoot)).toBe(false);
      expect(existsSync(archiveResult.archivedPath)).toBe(true);

      // Verify archived capsule integrity
      expect(verifyIntegrity(archiveResult.archivedPath)).toEqual([]);

      // Verify archived capsule contains manifest.json and prompt.md
      expect(existsSync(join(archiveResult.archivedPath, "manifest.json"))).toBe(true);
      expect(existsSync(join(archiveResult.archivedPath, "prompt.md"))).toBe(true);
    });

    test("consolidateCapsules archives legacy generation roots into .capsules/archive/ and keeps active roots minimal", () => {
      const scratch = scratchRoot("consolidate-capsules-test");
      const capsulesDir = join(scratch, ".olt", "capsules");
      mkdirSync(capsulesDir, { recursive: true });

      writeFileSync(join(scratch, "CHARTER.md"), SAMPLE_CHARTER, "utf-8");

      // Create Gen 1 (legacy), Gen 2 (legacy), Gen 3 (active), Gen 4 (active) capsules
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "1" });
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "2" });
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "3" });
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "4" });

      // Add dummy companion files in .capsules to ensure they are preserved
      writeFileSync(join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl"), '{"id":"test"}\n');
      writeFileSync(join(capsulesDir, "defects.jsonl"), '{"id":"defect-1"}\n');

      // Consolidate with currentGeneration = 4, retentionGenerations = 2
      // Cutoff = 4 - 2 = 2. Gen 1 and Gen 2 are legacy (<= 2) -> ARCHIVED to .capsules/archive/
      // Gen 3 and Gen 4 are active (> 2) -> KEPT in .capsules/ and pruned of boilerplate
      const consolidateResult = consolidateCapsules(capsulesDir, {
        currentGeneration: 4,
        retentionGenerations: 2,
      });

      expect(consolidateResult.archivedCapsules).toContain("mind-gen-1");
      expect(consolidateResult.archivedCapsules).toContain("mind-gen-2");
      expect(consolidateResult.activeCapsules).toContain("mind-gen-3");
      expect(consolidateResult.activeCapsules).toContain("mind-gen-4");

      // Verify filesystem state
      const archiveDir = join(capsulesDir, "archive");
      expect(existsSync(archiveDir)).toBe(true);
      expect(existsSync(join(archiveDir, "mind-gen-1"))).toBe(true);
      expect(existsSync(join(archiveDir, "mind-gen-2"))).toBe(true);
      expect(existsSync(join(capsulesDir, "mind-gen-1"))).toBe(false);
      expect(existsSync(join(capsulesDir, "mind-gen-2"))).toBe(false);
      expect(existsSync(join(capsulesDir, "mind-gen-3"))).toBe(true);
      expect(existsSync(join(capsulesDir, "mind-gen-4"))).toBe(true);

      // Verify active roots have boilerplate subdirectories pruned (minimal)
      expect(existsSync(join(capsulesDir, "mind-gen-4", "blobs"))).toBe(false);
      expect(existsSync(join(capsulesDir, "mind-gen-4", "evidence"))).toBe(false);

      // Verify companion files are preserved in .capsules
      expect(existsSync(join(capsulesDir, "ARCHIVED_OBJECTIVES.jsonl"))).toBe(true);
      expect(existsSync(join(capsulesDir, "defects.jsonl"))).toBe(true);

      // Verify integrity of all active and archived capsules
      expect(verifyIntegrity(join(archiveDir, "mind-gen-1"))).toEqual([]);
      expect(verifyIntegrity(join(archiveDir, "mind-gen-2"))).toEqual([]);
      expect(verifyIntegrity(join(capsulesDir, "mind-gen-3"))).toEqual([]);
      expect(verifyIntegrity(join(capsulesDir, "mind-gen-4"))).toEqual([]);

      // Verify idempotency
      const secondRun = consolidateCapsules(capsulesDir, {
        currentGeneration: 4,
        retentionGenerations: 2,
      });
      expect(secondRun.archivedCapsules.length).toBe(0);
      expect(secondRun.activeCapsules).toContain("mind-gen-3");
      expect(secondRun.activeCapsules).toContain("mind-gen-4");
    });

    test("pruneAndArchiveGenerationalState consolidates on-disk capsules when consolidateCapsulesOnDisk is enabled", () => {
      const scratch = scratchRoot("prune-archive-disk-consolidation");
      const capsulesDir = join(scratch, ".olt", "capsules");
      mkdirSync(capsulesDir, { recursive: true });
      writeFileSync(join(scratch, "CHARTER.md"), SAMPLE_CHARTER, "utf-8");

      // Setup Gen 1 and Gen 3
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "1" });
      mindInitCommand({ repo: scratch, charter: "CHARTER.md", actor: "test", generation: "3" });

      const sourceState: Record<string, unknown> = {
        candidates: [],
        objectives: [],
        tasks: [],
      };

      const result = pruneAndArchiveGenerationalState({
        sourceState,
        sourceGeneration: 3,
        retentionGenerations: 2,
        capsulesDir,
        consolidateCapsulesOnDisk: true,
        pruneBoilerplateOnDisk: true,
      });

      expect(result.consolidatedCapsules).toBeDefined();
      expect(result.consolidatedCapsules?.archivedCapsules).toContain("mind-gen-1");
      expect(result.consolidatedCapsules?.activeCapsules).toContain("mind-gen-3");
      expect(existsSync(join(capsulesDir, "archive", "mind-gen-1"))).toBe(true);
      expect(existsSync(join(capsulesDir, "mind-gen-1"))).toBe(false);
    });

    test("archiveCapsule error handling and dryRun overwrite behavior", () => {
      expect(() => archiveCapsule("/non/existent/path")).toThrow(HarnessError);

      const scratch = scratchRoot("archive-capsule-errors");
      const fileCapsule = join(scratch, "regular-file.txt");
      writeFileSync(fileCapsule, "not a directory", "utf-8");
      expect(() => archiveCapsule(fileCapsule)).toThrow(HarnessError);

      // Target already exists without overwrite -> throws INVALID_STATE
      const capDir = join(scratch, "capsule-1");
      const arcDir = join(scratch, "archive");
      mkdirSync(capDir, { recursive: true });
      mkdirSync(join(arcDir, "capsule-1"), { recursive: true });

      expect(() => archiveCapsule(capDir, { targetArchiveDir: arcDir, overwrite: false })).toThrow(
        HarnessError,
      );

      // Dry run with overwrite -> passes without throwing
      const dryRunRes = archiveCapsule(capDir, {
        targetArchiveDir: arcDir,
        overwrite: true,
        dryRun: true,
      });
      expect(dryRunRes.runId).toBe("capsule-1");
    });

    test("consolidateCapsules identifies legacy capsules by reading activeRunIds list", () => {
      const scratch = scratchRoot("consolidate-active-run-ids");
      const capsulesDir = join(scratch, "capsules");
      const oldRunDir = join(capsulesDir, "arbitrary-run-name-1");
      mkdirSync(oldRunDir, { recursive: true });

      writeFileSync(
        join(oldRunDir, "state.json"),
        JSON.stringify({
          mind: { status: "rotated", generation: 1 },
        }),
        "utf-8",
      );

      const result = consolidateCapsules(capsulesDir, {
        activeRunIds: ["other-active-run"],
      });

      expect(result.archivedCapsules).toContain("arbitrary-run-name-1");
    });
  });
});
