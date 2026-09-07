import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  assessRecyclingState,
  enforceInfiniteMindCadence,
  formatRecycleBrief,
  inspectRecycleHealth,
  validateRolloverReadiness,
} from "../../../../../olt/scripts/src/mind/archival/recycler/index.ts";
import { VirtualMemoryFS } from "../../../../../olt/scripts/src/testing/virtual-fs/memory-fs.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../../../olt/scripts/src/testing/virtual-fs/spies.ts";

describe("Mind Archival Recycler Sub-Suite (In-Memory)", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  const feedbackQueuePath = "/virtual/feedback/backlog.jsonl";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync("/virtual/feedback", { recursive: true });
    // Seed empty or valid JSONL
    vfs.writeFileSync(feedbackQueuePath, "");
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    session.cleanup();
  });

  describe("validateRolloverReadiness", () => {
    it("rejects rollover when mind substate is missing or target generation is invalid", () => {
      const emptyState = {};
      const resMissing = validateRolloverReadiness(emptyState, 2, { feedbackQueuePath });
      expect(resMissing.ready).toBe(false);
      expect(resMissing.reason).toContain("Missing mind substate");

      const stateGen2 = {
        mind: { generation: 2, status: "active" },
      };
      const resEqualGen = validateRolloverReadiness(stateGen2, 2, { feedbackQueuePath });
      expect(resEqualGen.ready).toBe(false);
      expect(resEqualGen.reason).toContain("must exceed current generation");

      const resLowerGen = validateRolloverReadiness(stateGen2, 1, { feedbackQueuePath });
      expect(resLowerGen.ready).toBe(false);

      const stateRotated = {
        mind: { generation: 2, status: "rotated" },
      };
      const resRotated = validateRolloverReadiness(stateRotated, 3, { feedbackQueuePath });
      expect(resRotated.ready).toBe(false);
      expect(resRotated.reason).toContain("already rotated");
    });

    it("approves rollover and counts active candidates plus pending feedback items", () => {
      const feedbackItem = JSON.stringify({
        id: "fb-1",
        status: "PENDING",
        priority: "NORMAL",
        category: "GENERAL",
        title: "Test item",
        content: "Content",
        timestamp: "2026-09-06T00:00:00.000Z",
      });
      vfs.writeFileSync(feedbackQueuePath, feedbackItem + "\n");

      const validState = {
        mind: { generation: 3, status: "active" },
        candidates: [
          { id: "cand-1", status: "admitted" },
          { id: "cand-2", status: "completed" },
        ],
      };

      const res = validateRolloverReadiness(validState, 4, { feedbackQueuePath });
      expect(res.ready).toBe(true);
      expect(res.generation).toBe(3);
      expect(res.targetGeneration).toBe(4);
      expect(res.pendingFeedbackCount).toBe(1);
      expect(res.activeCandidatesCount).toBe(1);
    });

    it("handles missing feedback queue file gracefully returning 0 pending feedback items", () => {
      const validState = {
        mind: { generation: 1, status: "active" },
        candidates: [{ id: "c-1", status: "admitted" }],
      };
      const missingPath = "/virtual/feedback/nonexistent-backlog.jsonl";
      const res = validateRolloverReadiness(validState, 2, { feedbackQueuePath: missingPath });
      expect(res.ready).toBe(true);
      expect(res.pendingFeedbackCount).toBe(0);
    });
  });

  describe("enforceInfiniteMindCadence", () => {
    it("returns infinite autonomous cadence invariants for standard and terminal execution", () => {
      const normal = enforceInfiniteMindCadence({
        runRoot: "/virtual/capsules/gen-1",
        actor: "mind-1",
        isTerminal: false,
      });
      expect(normal.cadence).toBe("infinite_autonomous");
      expect(normal.allowed).toBe(true);
      expect(normal.nextInstruction).toContain("mind:wake");
      expect(normal.message).toContain("Infinite autonomous mind cadence active");

      const terminal = enforceInfiniteMindCadence({
        runRoot: "/virtual/capsules/gen-1",
        actor: "mind-1",
        isTerminal: true,
      });
      expect(terminal.cadence).toBe("infinite_autonomous");
      expect(terminal.allowed).toBe(true);
      expect(terminal.message).toContain("Terminal outcome recorded");
    });
  });

  describe("assessRecyclingState and formatRecycleBrief", () => {
    it("assesses recycling transition when completion review is clean", () => {
      const state = {
        mind: { actor: "mind-agent", generation: 1 },
        completion_review: { status: "clean" },
        candidates: [{ id: "cand-review", status: "admitted" }],
        rounds: [],
      };

      const runRoot = "/virtual/capsules/active-run";
      const assessment = assessRecyclingState(state, runRoot, { feedbackQueuePath });

      expect(assessment.canRecycle).toBe(true);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("candidate_to_planning");
      expect(assessment.candidateId).toBe("cand-review");
      expect(assessment.nextRecommendedCommand).toContain("mind:round-open");

      const brief = formatRecycleBrief(assessment, runRoot);
      expect(brief).toContain("### Autonomous Mind Recycler");
      expect(brief).toContain("`critic_signed_off`");
      expect(brief).toContain("`candidate_to_planning`");
      expect(brief).toContain("`cand-review`");
      expect(brief).toContain("infinite autonomous loop active");
    });

    it("assesses recycling transition when completion review reports findings", () => {
      const state = {
        mind: { actor: "mind-agent", generation: 1 },
        completion_review: { status: "findings" },
        candidates: [{ id: "c-findings", status: "admitted" }],
        rounds: [{ round: 1, status: "closed", objective_id: "obj-1", candidate_id: "c-findings" }],
      };
      const runRoot = "/virtual/capsules/findings-run";
      const assessment = assessRecyclingState(state, runRoot, { feedbackQueuePath });
      expect(assessment.canRecycle).toBe(true);
      expect(assessment.phase).toBe("critic_signed_off");
      expect(assessment.transition).toBe("critic_to_next_round");
      expect(assessment.roundNumber).toBe(2);
      expect(assessment.reason).toContain("reported findings");
    });
  });

  describe("inspectRecycleHealth", () => {
    it("inspects overall recycler health and cadence state in virtual environment", () => {
      const state = {
        mind: { actor: "mind-agent", generation: 1 },
        completion_review: { status: "clean" },
        candidates: [{ id: "c-1", status: "admitted" }],
      };

      const health = inspectRecycleHealth(state, "/virtual/capsules/run-h", { feedbackQueuePath });
      expect(health.activeCadence).toBe("infinite_autonomous");
      expect(health.assessment).toBeDefined();
      expect(health.timestamp).toBeDefined();
    });
  });
});
