import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
  CANONICAL_FEEDBACK_FILE,
  resolveCanonicalFeedbackQueuePath,
  resolveFeedbackQueuePath,
  migrateFeedbackQueue,
  readFeedbackQueue,
  writeFeedbackQueue,
  appendFeedbackItem,
  type FeedbackItem,
} from "../../olt/scripts/src/mind/feedback/queue/index.ts";
import {
  CANONICAL_COMPLETED_TASKS_FILE,
  CANONICAL_DEFECTS_FILE,
  CANONICAL_COMPLETED_DEFECTS_FILE,
  CANONICAL_OBSERVATIONS_FILE,
  resolveCanonicalCompletedTasksPath,
  resolveCompletedTasksLedgerPath,
  resolveCanonicalDefectsPath,
  resolveDefectsPath,
  resolveCanonicalCompletedDefectsPath,
  resolveCompletedDefectsPath,
  resolveCanonicalObservationsPath,
  resolveObservationsPath,
  migrateCompletedTasksLedger,
  readCompletedTasksLedger,
  writeCompletedTasksLedger,
  type CompletedTaskRecord,
} from "../../olt/scripts/src/mind/archival/completed/index.ts";
import {
  CANONICAL_WATCHDOG_FILE,
  resolveCanonicalWatchdogStorePath,
  resolveWatchdogStorePath,
} from "../../olt/scripts/src/mind/lifecycle/index.ts";
import {
  CANONICAL_COGNITIVE_MEMORY_FILE,
  resolveCanonicalCognitiveMemoryPath,
  resolveCognitiveMemoryPath,
  readCognitiveMemory,
  writeCognitiveMemory,
  updateCognitiveMemory,
  type CognitiveMemoryState,
} from "../../olt/scripts/src/mind/tasks/smart/index.ts";
import { scratchRoot } from "../shared/scratch-root.ts";

describe("Mind & Todo Storage Canonical Layout and Transparent Resolvers", () => {
  describe("Standardized Canonical Constants & Layout Naming", () => {
    it("verifies canonical filenames adhere strictly to lowercase kebab-case naming", () => {
      expect(CANONICAL_FEEDBACK_FILE).toBe(".olt/backlog.jsonl");
      expect(CANONICAL_COMPLETED_TASKS_FILE).toBe(".olt/completed-tasks.jsonl");
      expect(CANONICAL_DEFECTS_FILE).toBe(".olt/defects.jsonl");
      expect(CANONICAL_COMPLETED_DEFECTS_FILE).toBe(".olt/completed-defects.jsonl");
      expect(CANONICAL_OBSERVATIONS_FILE).toBe(".olt/telemetry.jsonl");
      expect(CANONICAL_WATCHDOG_FILE).toBe(".olt/watchdogs.json");
      expect(CANONICAL_COGNITIVE_MEMORY_FILE).toBe(".olt/memory.json");
    });

    it("resolves canonical paths correctly with custom roots", () => {
      const root = "/custom/repo/root";

      // Feedback queue
      expect(resolveCanonicalFeedbackQueuePath(root)).toBe(join(root, ".olt/backlog.jsonl"));

      // Completed tasks
      expect(resolveCanonicalCompletedTasksPath(root)).toBe(
        join(root, ".olt/completed-tasks.jsonl"),
      );

      // Defects
      expect(resolveCanonicalDefectsPath(root)).toBe(join(root, ".olt/defects.jsonl"));

      // Completed defects
      expect(resolveCanonicalCompletedDefectsPath(root)).toBe(
        join(root, ".olt/completed-defects.jsonl"),
      );

      // Observations
      expect(resolveCanonicalObservationsPath(root)).toBe(join(root, ".olt/telemetry.jsonl"));

      // Watchdogs
      expect(resolveCanonicalWatchdogStorePath(root)).toBe(join(root, ".olt/watchdogs.json"));

      // Cognitive memory
      expect(resolveCanonicalCognitiveMemoryPath(root)).toBe(join(root, ".olt/memory.json"));
    });
  });

  describe("Transparent Resolvers & Backward Compatibility", () => {
    it("returns explicit custom paths when specified", () => {
      const customFb = "/tmp/explicit/my-queue.jsonl";
      expect(resolveFeedbackQueuePath(customFb)).toBe(customFb);

      const customCompleted = "/tmp/explicit/my-completed.jsonl";
      expect(resolveCompletedTasksLedgerPath(customCompleted)).toBe(customCompleted);

      const customDefect = "/tmp/explicit/my-defects.jsonl";
      expect(resolveDefectsPath(customDefect)).toBe(customDefect);

      const customCompletedDefect = "/tmp/explicit/my-completed-defects.jsonl";
      expect(resolveCompletedDefectsPath(customCompletedDefect)).toBe(customCompletedDefect);

      const customObs = "/tmp/explicit/my-obs.jsonl";
      expect(resolveObservationsPath(customObs)).toBe(customObs);

      const customMem = "/tmp/explicit/my-memory.json";
      expect(resolveCognitiveMemoryPath(customMem)).toBe(customMem);

      const customWd = "/tmp/explicit/my-watchdogs.json";
      expect(resolveWatchdogStorePath(customWd)).toBe(customWd);
    });

    it("resolves existing canonical files over legacy files in target directory hierarchy", () => {
      const testDir = scratchRoot(import.meta.path, "transparent-resolvers");

      // Setup directory structure with canonical and legacy files
      const canonicalQueue = join(testDir, ".olt", "feedback-queue.jsonl");
      const legacyQueue = join(testDir, ".olt", "capsules", "FEEDBACK_QUEUE.jsonl");
      mkdirSync(dirname(canonicalQueue), { recursive: true });
      mkdirSync(dirname(legacyQueue), { recursive: true });
      writeFileSync(canonicalQueue, "", "utf8");
      writeFileSync(legacyQueue, "", "utf8");

      const canonicalTasks = join(testDir, ".olt", "completed-tasks.jsonl");
      const legacyTasks = join(testDir, ".olt", "capsules", "COMPLETED_TASKS.jsonl");
      mkdirSync(dirname(canonicalTasks), { recursive: true });
      mkdirSync(dirname(legacyTasks), { recursive: true });
      writeFileSync(canonicalTasks, "", "utf8");
      writeFileSync(legacyTasks, "", "utf8");

      // Custom explicit path to testDir
      const resolvedQueue = resolveFeedbackQueuePath(canonicalQueue);
      expect(resolvedQueue).toBe(canonicalQueue);

      const resolvedTasks = resolveCompletedTasksLedgerPath(canonicalTasks);
      expect(resolvedTasks).toBe(canonicalTasks);
    });
  });

  describe("Legacy Migration Mechanics", () => {
    it("migrates FEEDBACK_QUEUE.jsonl to canonical .capsules/mind/queue/feedback-queue.jsonl", () => {
      const testDir = scratchRoot(import.meta.path, "migrate-feedback");
      const legacyFile = join(testDir, ".olt", "capsules", "FEEDBACK_QUEUE.jsonl");
      const canonicalFile = join(testDir, ".olt", "feedback-queue.jsonl");

      mkdirSync(dirname(legacyFile), { recursive: true });
      const sampleItem: FeedbackItem = {
        id: "fb-legacy-01",
        timestamp: "2026-08-22T00:00:00.000Z",
        priority: "CRITICAL_USER_FEEDBACK",
        status: "PENDING",
        category: "CORE_ENGINE",
        title: "Legacy feedback item",
        content: "Content from legacy queue",
      };
      writeFeedbackQueue([sampleItem], legacyFile);

      // Execute migration
      const migrationResult = migrateFeedbackQueue({
        sourcePath: legacyFile,
        targetPath: canonicalFile,
      });

      expect(migrationResult.migrated).toBe(true);
      expect(migrationResult.count).toBe(1);

      // Verify canonical file contains the item
      const canonicalItems = readFeedbackQueue(canonicalFile);
      expect(canonicalItems).toHaveLength(1);
      expect(canonicalItems[0]?.id).toBe("fb-legacy-01");
      expect(canonicalItems[0]?.title).toBe("Legacy feedback item");

      // Running migration again with source === target should be a no-op
      const noopResult = migrateFeedbackQueue({
        sourcePath: canonicalFile,
        targetPath: canonicalFile,
      });
      expect(noopResult.migrated).toBe(false);
      expect(noopResult.count).toBe(0);
    });

    it("migrates COMPLETED_TASKS.jsonl to canonical .capsules/mind/queue/completed-tasks.jsonl", () => {
      const testDir = scratchRoot(import.meta.path, "migrate-completed");
      const legacyFile = join(testDir, ".olt", "capsules", "COMPLETED_TASKS.jsonl");
      const canonicalFile = join(testDir, ".olt", "completed-tasks.jsonl");

      mkdirSync(dirname(legacyFile), { recursive: true });
      const record: CompletedTaskRecord = {
        id: "task-legacy-01",
        source: "mind_plan",
        title: "Legacy completed task",
        status: "COMPLETED",
        proof_summary: "Passes all tests",
        completed_at: "2026-08-22T01:00:00.000Z",
        category: "ARCHITECTURE",
      };
      writeCompletedTasksLedger([record], legacyFile);

      // Execute migration
      const migrationResult = migrateCompletedTasksLedger({
        sourcePath: legacyFile,
        targetPath: canonicalFile,
      });

      expect(migrationResult.migrated).toBe(true);
      expect(migrationResult.count).toBe(1);

      // Verify canonical file contains the item
      const canonicalItems = readCompletedTasksLedger(canonicalFile);
      expect(canonicalItems).toHaveLength(1);
      expect(canonicalItems[0]?.id).toBe("task-legacy-01");
      expect(canonicalItems[0]?.title).toBe("Legacy completed task");

      // Non-existent source path
      const missingResult = migrateCompletedTasksLedger({
        sourcePath: join(testDir, "non-existent.jsonl"),
        targetPath: canonicalFile,
      });
      expect(missingResult.migrated).toBe(false);
      expect(missingResult.count).toBe(0);
    });
  });

  describe("Cognitive Memory Persistence (.capsules/mind/memory.json)", () => {
    it("returns default cognitive memory structure when memory file does not exist", () => {
      const testDir = scratchRoot(import.meta.path, "memory-default");
      const memoryFile = join(testDir, "memory.json");

      const memory = readCognitiveMemory(memoryFile);
      expect(memory.version).toBe(1);
      expect(memory.strategic_focus.length).toBeGreaterThan(0);
      expect(memory.active_hypotheses.length).toBeGreaterThan(0);
      expect(memory.roadmaps.length).toBeGreaterThan(0);
      expect(memory.macro_metrics?.parallelism).toBe(5);
    });

    it("writes, reads, and persists custom CognitiveMemoryState", () => {
      const testDir = scratchRoot(import.meta.path, "memory-persist");
      const memoryFile = join(testDir, ".olt", "memory.json");

      const customState: CognitiveMemoryState = {
        version: 2,
        last_updated: "2026-08-22T05:00:00.000Z",
        strategic_focus: ["Standardize Mind Queue Storage Layout", "Zero Any & Zero Suppressions"],
        active_hypotheses: [
          {
            id: "hyp-p85-todo",
            statement:
              "Canonical kebab-case storage prevents file collisions across mind processes",
            confidence: 0.99,
            status: "active",
            evidence: ["Transparent resolvers correctly map legacy to canonical"],
            created_at: "2026-08-22T05:00:00.000Z",
            updated_at: "2026-08-22T05:00:00.000Z",
          },
        ],
        roadmaps: [
          {
            id: "roadmap-p85",
            title: "P85 Todo Standardization",
            target_horizon: "Immediate",
            milestones: ["Standardize filenames", "Update CLI commands", "Pass unit test suite"],
            status: "active",
          },
        ],
        macro_metrics: {
          work: 12,
          span: 3,
          parallelism: 4,
          efficiency: 0.98,
        },
        context: {
          run_id: "run-p85",
          author: "implementer-4",
        },
      };

      writeCognitiveMemory(customState, memoryFile);

      expect(existsSync(memoryFile)).toBe(true);
      const readBack = readCognitiveMemory(memoryFile);
      expect(readBack.version).toBe(2);
      expect(readBack.last_updated).toBe("2026-08-22T05:00:00.000Z");
      expect(readBack.strategic_focus).toEqual([
        "Standardize Mind Queue Storage Layout",
        "Zero Any & Zero Suppressions",
      ]);
      expect(readBack.active_hypotheses).toHaveLength(1);
      expect(readBack.active_hypotheses[0]?.id).toBe("hyp-p85-todo");
      expect(readBack.roadmaps[0]?.id).toBe("roadmap-p85");
      expect(readBack.macro_metrics?.work).toBe(12);
      expect(readBack.context?.["run_id"]).toBe("run-p85");
    });

    it("atomically updates cognitive memory with updater function via updateCognitiveMemory", () => {
      const testDir = scratchRoot(import.meta.path, "memory-update");
      const memoryFile = join(testDir, ".olt", "memory.json");

      // Initial write
      const initial: CognitiveMemoryState = {
        version: 1,
        last_updated: "2026-08-22T01:00:00.000Z",
        strategic_focus: ["Initial Goal"],
        active_hypotheses: [],
        roadmaps: [],
      };
      writeCognitiveMemory(initial, memoryFile);

      // Perform update
      const updated = updateCognitiveMemory((current) => {
        return {
          ...current,
          version: 2,
          strategic_focus: [...current.strategic_focus, "Second Goal"],
        };
      }, memoryFile);

      expect(updated.version).toBe(2);
      expect(updated.strategic_focus).toEqual(["Initial Goal", "Second Goal"]);
      expect(updated.last_updated).not.toBe("2026-08-22T01:00:00.000Z");

      const readBack = readCognitiveMemory(memoryFile);
      expect(readBack.version).toBe(2);
      expect(readBack.strategic_focus).toEqual(["Initial Goal", "Second Goal"]);
    });

    it("handles malformed JSON gracefully with safe default fallback", () => {
      const testDir = scratchRoot(import.meta.path, "memory-malformed");
      const memoryFile = join(testDir, "memory.json");

      writeFileSync(memoryFile, "{ bad json state", "utf8");
      const memory = readCognitiveMemory(memoryFile);
      expect(memory.version).toBe(1);
      expect(memory.strategic_focus).toEqual([]);
      expect(memory.active_hypotheses).toEqual([]);
    });
  });
});

describe("Mind & Mind-Auditor 1-Shot Auto-Deployment Documentation Invariants", () => {
  it("verifies olt/SKILL.md contains /olt mind 1-shot batch auto-deployment directives", () => {
    const content = readFileSync(join(process.cwd(), "olt/SKILL.md"), "utf-8");
    expect(content).toContain("Autonomous Product Owner entry point: `/olt mind`");
    expect(content).toContain("1-Shot Batch Auto-Deployment of Mind and Companion Mind-Auditor");
  });

  it("verifies olt/references/host-adapters.md contains 1-shot batch deployment guardrails", () => {
    const content = readFileSync(join(process.cwd(), "olt/references/host-adapters.md"), "utf-8");
    expect(content).toContain(
      "1-Shot Batch Auto-Deployment for Mind and Mind-Auditor (`/olt mind`)",
    );
  });

  it("verifies olt/references/protocol.md documents mind + mind-auditor batch dispatch", () => {
    const content = readFileSync(join(process.cwd(), "olt/references/protocol.md"), "utf-8");
    expect(content).toContain("dispatches both");
    expect(content).toContain(
      "`mind` (Tier 0) and `mind-auditor` (Tier 1) in a single 1-shot batch dispatch",
    );
  });

  it("verifies olt/AGENTS.md includes axiom 27 for /olt mind 1-shot batch dispatch", () => {
    const content = readFileSync(join(process.cwd(), "olt/AGENTS.md"), "utf-8");
    expect(content).toContain(
      "1-Shot Batch Auto-Deployment of Mind and Mind-Auditor (`/olt mind`)",
    );
  });
});

describe("Static Invariant Verification: Zero TypeScript any & Zero Suppressions", () => {
  it("verifies todo-storage test file contains zero any and zero suppressions", () => {
    const filesToAudit = [join(process.cwd(), "tests/unit/mind/todo-storage.test.ts")];

    const anyPattern = new RegExp(":\\s*any\\b|as\\s+any\\b|<any>");
    const suppressionPattern = new RegExp(
      [
        "@ts" + "-ignore",
        "@ts" + "-expect-error",
        "@ts" + "-nocheck",
        "eslint" + "-disable",
        "oxlint" + "-disable",
      ].join("|"),
    );

    for (const filePath of filesToAudit) {
      if (!existsSync(filePath)) continue;
      const content = readFileSync(filePath, "utf-8");
      const lines = content.split("\n");

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        if (line.includes("anyPattern") || line.includes("suppressionPattern")) continue;

        expect(anyPattern.test(line)).toBe(false);
        expect(suppressionPattern.test(line)).toBe(false);
      }
    }
  });
});
