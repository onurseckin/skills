import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  DIALECTICAL_LEVELS,
  HistoricalDebateMemory,
  IMPASSE_CRUCIBLE_THRESHOLD,
  SocraticLadderingEngine,
  type DebateExchange,
  type StrategicResolution,
} from "../../../olt/scripts/src/mind/auditing/socratic/index.ts";
import {
  drainPendingFeedbacks,
  getFeedbackStats,
} from "../../../olt/scripts/src/mind/feedback/queue/filter.ts";
import {
  ingestFeedbackItem,
  sealFeedbackResolution,
} from "../../../olt/scripts/src/mind/feedback/queue/ops.ts";
import {
  readFeedbackQueue,
  verifyFeedbackEmpiricalSealing,
} from "../../../olt/scripts/src/mind/feedback/queue/ingest.ts";
import type { FeedbackResolutionProof } from "../../../olt/scripts/src/mind/feedback/queue/types.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

describe("Mind Socratic Feedback Integration Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const queuePath = "/virtual/mind/feedback/socratic-queue.jsonl";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    session = createVirtualFSSession(vfs);
    vfs.mkdirSync("/virtual/mind/feedback", { recursive: true });
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("Dialectical Impasse Escalation into Feedback Queue", () => {
    it("escalates dialectical impasse exceeding crucible threshold to CRITICAL priority", () => {
      const memory = new HistoricalDebateMemory();
      const engine = new SocraticLadderingEngine(memory, {
        consecutiveImpasseCycles: IMPASSE_CRUCIBLE_THRESHOLD + 1,
        currentLevel: DIALECTICAL_LEVELS.L2_SECOND_ORDER_IMPLICATIONS,
      });

      const exchange: DebateExchange = engine.evaluateCycle(
        "cycle-socratic-01",
        "VirtualMemoryFS Parallel I/O Architecture",
      );

      expect(exchange.requiresCrucible).toBe(true);
      expect(exchange.inquiry).toContain("IMPASSE DETECTED");

      const escalatedItem = ingestFeedbackItem(
        {
          title: "Socratic Impasse: VirtualMemoryFS Architecture",
          content: exchange.inquiry,
          priority: "CRITICAL_USER_FEEDBACK",
          category: "AUDITING",
          metadata: {
            cycle_id: exchange.cycleId,
            requires_crucible: true,
            dialectical_level: exchange.level,
          },
        },
        queuePath,
      );

      expect(escalatedItem.priority).toBe("CRITICAL_USER_FEEDBACK");
      expect(escalatedItem.category).toBe("AUDITING");
      expect(escalatedItem.metadata?.["requires_crucible"]).toBe(true);

      const queue = readFeedbackQueue(queuePath);
      expect(queue.length).toBe(1);
      expect(queue[0]?.priority).toBe("CRITICAL_USER_FEEDBACK");
    });

    it("records normal consensus resolution as standard feature feedback", () => {
      const memory = new HistoricalDebateMemory();
      const resolution: StrategicResolution = {
        cycleId: "cycle-res-01",
        topic: "Zero Disk I/O Invariant",
        settledInvariant: "All unit tests use VirtualMemoryFS exclusively",
        winningApproach: "In-memory filesystem session isolation",
        confidenceScore: 0.98,
        settledAt: "2026-09-01T10:00:00.000Z",
        commitments: [],
      };

      memory.recordResolution(resolution);
      const latest = memory.getLatestResolutionForTopic("Zero Disk I/O Invariant");
      expect(latest?.settledInvariant).toBe(resolution.settledInvariant);

      const feedback = ingestFeedbackItem(
        {
          title: `Settled: ${resolution.topic}`,
          content: resolution.settledInvariant,
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "GOVERNANCE",
          metadata: {
            confidence: resolution.confidenceScore,
            winning_approach: resolution.winningApproach,
          },
        },
        queuePath,
      );

      expect(feedback.priority).toBe("HIGH_ARCHITECTURAL_FEATURE");
      expect(feedback.category).toBe("GOVERNANCE");
    });
  });

  describe("Empirical Sealing Validation (verifyFeedbackEmpiricalSealing)", () => {
    it("rejects proof with missing task_id", () => {
      const badProof = {
        task_id: "",
        resolved_at: "2026-09-01T10:00:00.000Z",
      } as FeedbackResolutionProof;

      const result = verifyFeedbackEmpiricalSealing(badProof);
      expect(result.isValid).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("task_id");
    });

    it("rejects proof with short or missing commit_sha when requireCommitSha is enabled", () => {
      const shortShaProof: FeedbackResolutionProof = {
        task_id: "task-sha-check",
        resolved_at: "2026-09-01T10:00:00.000Z",
        commit_sha: "abc",
      };

      const result = verifyFeedbackEmpiricalSealing(shortShaProof, { requireCommitSha: true });
      expect(result.isValid).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("commit_sha");
    });

    it("rejects proof with missing test_path when requireTestPath is enabled", () => {
      const missingPathProof: FeedbackResolutionProof = {
        task_id: "task-path-check",
        resolved_at: "2026-09-01T10:00:00.000Z",
        commit_sha: "1234567",
      };

      const result = verifyFeedbackEmpiricalSealing(missingPathProof, { requireTestPath: true });
      expect(result.isValid).toBe(false);
      expect(result.reason?.toLowerCase()).toContain("test_path");
    });

    it("accepts comprehensive proof meeting all empirical validation gates", () => {
      const validProof: FeedbackResolutionProof = {
        task_id: "task-empirical-ok",
        resolved_at: "2026-09-01T10:00:00.000Z",
        commit_sha: "abcdef123456",
        test_path: "tests/mind/feedback/socratic-feedback.test.ts",
        assertions: 8,
        runtime_ms: 3,
        proof_summary: "Validated Socratic dialectic empirical sealing under 5ms in RAM",
      };

      const result = verifyFeedbackEmpiricalSealing(validProof, {
        requireCommitSha: true,
        requireTestPath: true,
      });
      expect(result.isValid).toBe(true);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("End-to-End Socratic Feedback Cycle", () => {
    it("completes full ingest-drain-seal lifecycle purely in virtual memory", () => {
      const item1 = ingestFeedbackItem(
        {
          title: "Socratic Audit finding 1",
          content: "Dialectical tension in memory recycling",
          priority: "HIGH_ARCHITECTURAL_FEATURE",
          category: "AUDITING",
        },
        queuePath,
      );
      const _item2 = ingestFeedbackItem(
        {
          title: "Socratic Audit finding 2",
          content: "Minor doc mismatch in dialectic rules",
          priority: "NORMAL",
          category: "DOCUMENTATION",
        },
        queuePath,
      );

      const initialQueue = readFeedbackQueue(queuePath);
      const initialStats = getFeedbackStats(initialQueue);
      expect(initialStats.total).toBe(2);
      expect(initialStats.pending).toBe(2);

      const drained = drainPendingFeedbacks({ category: "AUDITING" }, queuePath);
      expect(drained.length).toBe(1);
      expect(drained[0]?.id).toBe(item1.id);
      expect(drained[0]?.status).toBe("PROCESSED");

      const proof: FeedbackResolutionProof = {
        task_id: "task-audit-resolved-1",
        resolved_at: "2026-09-01T12:00:00.000Z",
        commit_sha: "c0ffeeb",
        test_path: "tests/mind/feedback/socratic-feedback.test.ts",
        assertions: 10,
        runtime_ms: 2,
        proof_summary: "Socratic finding sealed with sub-10ms test proof",
      };

      const sealed = sealFeedbackResolution(item1.id, proof, { customPath: queuePath });
      expect(sealed.status).toBe("COMPLETED");
      expect(sealed.resolution?.commit_sha).toBe("c0ffeeb");

      const finalQueue = readFeedbackQueue(queuePath);
      const finalStats = getFeedbackStats(finalQueue);
      expect(finalStats.completed).toBe(1);
      expect(finalStats.pending).toBe(1);
    });
  });
});
