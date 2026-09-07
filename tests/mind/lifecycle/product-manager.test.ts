import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { join } from "node:path";
import {
  evaluateMindMode,
  runMindProductManagerLoop,
  discoverGroundedFeatures,
} from "../../../olt/scripts/src/mind/lifecycle/orchestration/product-manager.ts";
import { writeTaskQueue } from "../../../olt/scripts/src/task/queue/index.ts";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Product Manager Autonomous Expansion Suite (product-manager.ts)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const testDir = "/virtual/pm-test";
  let queuePath: string;
  let feedbackPath: string;
  let memoryPath: string;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync(testDir, { recursive: true });
    vfs.mkdirSync(join(testDir, ".olt"), { recursive: true });
    queuePath = join(testDir, ".olt", "tasks.jsonl");
    feedbackPath = join(testDir, ".olt", "backlog.jsonl");
    memoryPath = join(testDir, ".olt", "memory.json");
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("discoverGroundedFeatures re-export", () => {
    it("is exported as a function", () => {
      expect(typeof discoverGroundedFeatures).toBe("function");
    });
  });

  describe("evaluateMindMode", () => {
    it("evaluates QUEUE_ACTIVE_EXECUTION when active tasks exist in queue", () => {
      writeTaskQueue(
        [
          {
            id: "task-1",
            title: "In progress task",
            description: "Executing active task",
            status: "IN_PROGRESS",
            priority: "HIGH",
            write_scope: ["src/"],
            gate: "G1",
            charter_goals: ["G1"],
            acceptance_criteria: ["Passes tests"],
            dependencies: [],
            source_type: "self_evolution",
            assigned_tier: "Tier_3_Implementer",
          },
        ],
        queuePath,
      );

      const result = evaluateMindMode({
        queuePath,
        repoRoot: testDir,
        memoryPath,
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.mode).toBe("QUEUE_ACTIVE_EXECUTION");
      expect(result.recommendedAction).toBe("SUPERVISE_ACTIVE_WAVES");
      expect(result.nextCommand).toContain("queue:wave");
      expect(result.activeTasksCount).toBe(1);
    });

    it("evaluates MODE_B_EXTERNAL_INTAKE when queue is clear but pending feedback exists", () => {
      writeTaskQueue([], queuePath);
      const validFeedback = {
        id: "fb-1",
        timestamp: "2026-09-01T12:00:00.000Z",
        title: "User request",
        content: "Please improve latency",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
      };
      vfs.writeFileSync(feedbackPath, JSON.stringify(validFeedback) + "\n");

      const result = evaluateMindMode({
        queuePath,
        feedbackQueuePath: feedbackPath,
        repoRoot: testDir,
        memoryPath,
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.mode).toBe("MODE_B_EXTERNAL_INTAKE");
      expect(result.recommendedAction).toBe("PROCESS_FEEDBACK_INTAKE");
      expect(result.nextCommand).toContain("mind:self-evolve");
      expect(result.feedbackCount).toBe(1);
    });

    it("evaluates MODE_A_CREATIVE_PRODUCT_MANAGER when queue and feedback intake are clear", () => {
      writeTaskQueue([], queuePath);
      vfs.writeFileSync(feedbackPath, "");

      const result = evaluateMindMode({
        queuePath,
        feedbackQueuePath: feedbackPath,
        repoRoot: testDir,
        memoryPath,
        capsulesDir: join(testDir, ".olt", "capsules"),
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
      expect(result.recommendedAction).toBe("EXECUTE_AUTONOMOUS_PRODUCT_EXPANSION");
      expect(result.nextCommand).toContain("mind:self-evolve");
      expect(result.activeTasksCount).toBe(0);
      expect(result.feedbackCount).toBe(0);
      expect(result.antiStagnationState).toBeDefined();
    });

    it("resolves feedback file from repoRoot/.olt/backlog.jsonl automatically when feedbackQueuePath omitted", () => {
      writeTaskQueue([], queuePath);
      const validFeedback = {
        id: "fb-auto",
        timestamp: "2026-09-01T12:00:00.000Z",
        title: "Auto resolved feedback",
        content: "Detailed suggestions",
        priority: "NORMAL",
        status: "PENDING",
        category: "GENERAL",
      };
      vfs.writeFileSync(feedbackPath, JSON.stringify(validFeedback) + "\n");

      const result = evaluateMindMode({
        queuePath,
        repoRoot: testDir,
        memoryPath,
      });

      expect(result.mode).toBe("MODE_B_EXTERNAL_INTAKE");
      expect(result.feedbackCount).toBe(1);
    });

    it("handles evaluateMindMode when neither feedbackQueuePath nor repoRoot are provided", () => {
      const result = evaluateMindMode({
        queuePath,
        memoryPath,
      });
      expect(result.mode).toBeDefined();
    });

    it("evaluates open defect logs from capsulesDir", () => {
      const capsulesDir = join(testDir, "test-capsules");
      vfs.mkdirSync(capsulesDir, { recursive: true });
      const defectEntry = {
        id: "defect-101",
        fingerprint: "fp-101",
        status: "open",
        severity: "HIGH",
        category: "ARCHITECTURE",
        statement: "Unstable memory lease",
        first_observed_at: "2026-09-01T12:00:00.000Z",
        last_observed_at: "2026-09-01T12:00:00.000Z",
        occurrence_count: 1,
      };
      vfs.writeFileSync(join(capsulesDir, "defects.jsonl"), JSON.stringify(defectEntry) + "\n");

      const result = evaluateMindMode({
        queuePath,
        repoRoot: testDir,
        memoryPath,
        capsulesDir,
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.openDefectsCount).toBe(1);
    });
  });

  describe("runMindProductManagerLoop", () => {
    it("runs product manager loop and synthesizes staged tasks with autoEnqueue", () => {
      const result = runMindProductManagerLoop({
        repoRoot: testDir,
        queuePath,
        memoryPath,
        charterGoals: ["G1", "G2"],
        maxProposals: 3,
        autoEnqueue: true,
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
      expect(result.proposals).toBeArray();
      expect(result.proposals.length).toBeGreaterThan(0);
      expect(result.synthesizedTasks.length).toBe(result.proposals.length);
      expect(result.enqueuedTasks.length).toBe(result.proposals.length);
      expect(result.cognitiveProgressLogged).toBe(true);
      expect(result.macroMetrics).toBeDefined();
      expect(result.macroMetrics.work).toBeGreaterThan(0);
      expect(result.macroMetrics.span).toBeGreaterThan(0);
      expect(result.macroMetrics.idealConcurrency).toBeGreaterThanOrEqual(1);

      const tierMap = result.synthesizedTasks.map((t) => t.assigned_tier);
      expect(tierMap).toContain("Tier_3_Implementer");

      expect(vfs.existsSync(queuePath)).toBe(true);
    });

    it("runs loop with autoEnqueue=false and multi-orchestrator staging", () => {
      const result = runMindProductManagerLoop({
        repoRoot: testDir,
        queuePath,
        memoryPath,
        charterGoals: ["G1"],
        maxProposals: 2,
        autoEnqueue: false,
        orchestratorCount: 2,
        orchestratorIds: ["orch-alpha", "orch-beta"],
        now: "2026-09-01T12:00:00.000Z",
      });

      expect(result.mode).toBe("MODE_A_CREATIVE_PRODUCT_MANAGER");
      expect(result.enqueuedTasks).toEqual([]);
      expect(result.synthesizedTasks.length).toBeGreaterThan(0);
      expect(result.summary).toContain("Mode A Creative Product Manager");
    });
  });
});
