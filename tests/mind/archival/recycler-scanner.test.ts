import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assessRecyclingState } from "../../../olt/scripts/src/mind/archival/recycler/scanner.ts";

describe("assessRecyclingState", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "recycler-scanner-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("handles fallback defaults when state is completely empty", () => {
    const res = assessRecyclingState({}, "/virtual/run");
    expect(res.canRecycle).toBe(true);
    expect(res.infiniteCadence).toBe(true);
    expect(res.phase).toBe("quiescent");
    expect(res.transition).toBe("pulse_to_wake");
    expect(res.objectiveId).toBeNull();
    expect(res.candidateId).toBeNull();
    expect(res.roundNumber).toBeNull();
    expect(res.nextRecommendedCommand).toContain("mind:wake");
  });

  it("handles in_progress phase when an open round exists without completion review", () => {
    const state = {
      mind: { actor: "custom-actor", generation: 2 },
      rounds: [{ round: 2, status: "opened", objective_id: "obj-1", candidate_id: "cand-1" }],
    };
    const res = assessRecyclingState(state, "/virtual/run");
    expect(res.phase).toBe("in_progress");
    expect(res.transition).toBe("pulse_to_wake");
    expect(res.objectiveId).toBe("obj-1");
    expect(res.candidateId).toBe("cand-1");
    expect(res.roundNumber).toBe(2);
  });

  describe("completion_review status: clean", () => {
    it("transitions candidate_to_planning when admitted candidate exists", () => {
      const state = {
        mind: { actor: "test-actor", generation: 1 },
        completion_review: { status: "clean", summary: "all clean" },
        candidates: [{ id: "cand-10", status: "admitted", statement: "Implement feature X" }],
        rounds: [],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("candidate_to_planning");
      expect(res.objectiveId).toBe("obj-cand-10");
      expect(res.candidateId).toBe("cand-10");
      expect(res.roundNumber).toBe(1);
      expect(res.suggestedCommands).toHaveLength(2);
      expect(res.suggestedCommands[0]).toContain("mind:round-open");
      expect(res.suggestedCommands[1]).toContain("plan:init");
    });

    it("transitions discovery_to_admission when open candidate exists", () => {
      const state = {
        completion_review: { status: "clean" },
        candidates: [{ id: "cand-open", status: "opened" }],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("discovery_to_admission");
      expect(res.candidateId).toBe("cand-open");
      expect(res.nextRecommendedCommand).toContain("mind:admit");
    });

    it("transitions generation_rollover when pending feedback queue items exist", () => {
      const qPath = join(tempDir, "feedback.jsonl");
      writeFileSync(
        qPath,
        JSON.stringify({
          id: "fb-1",
          timestamp: "2026-09-01T12:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "CLI_TOOLING",
          title: "Bug fix",
          content: "Description of bug",
        }) + "\n",
      );

      const state = {
        mind: { generation: 3, actor: "mind-governor" },
        completion_review: { status: "clean" },
        candidates: [],
      };
      const res = assessRecyclingState(state, "/virtual/run", {
        feedbackQueuePath: qPath,
        targetRunRoot: "/virtual/next-run",
      });
      expect(res.phase).toBe("generation_converged");
      expect(res.transition).toBe("generation_rollover");
      expect(res.targetGeneration).toBe(4);
      expect(res.pendingFeedbackCount).toBe(1);
      expect(res.suggestedCommands[1]).toContain("/virtual/next-run");
    });

    it("transitions critic_to_discovery when clean review and no candidates/feedback", () => {
      const state = {
        mind: { actor: "mind-actor" },
        completion_review: { status: "clean" },
        candidates: [],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("critic_to_discovery");
      expect(res.nextRecommendedCommand).toContain("mind:candidate");
      expect(res.suggestedCommands).toHaveLength(2);
    });
  });

  describe("completion_review status: findings", () => {
    it("transitions critic_to_next_round when rounds < maxRounds (openRound branch)", () => {
      const state = {
        budget: { max_rounds_per_objective: 4 },
        completion_review: { status: "findings" },
        rounds: [{ round: 1, status: "opened", objective_id: "obj-a", candidate_id: "cand-a" }],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("critic_to_next_round");
      expect(res.objectiveId).toBe("obj-a");
      expect(res.candidateId).toBe("cand-a");
      expect(res.roundNumber).toBe(2);
      expect(res.nextRecommendedCommand).toContain("--round 2");
    });

    it("transitions critic_to_next_round using latestRound when openRound is absent", () => {
      const state = {
        mind: { budget: { max_rounds_per_objective: 5 } },
        completion_review: { status: "findings" },
        rounds: [
          { round: 1, status: "closed", objective_id: "obj-b", candidate_id: "cand-b" },
          { round: 2, status: "closed", objective_id: "obj-b", candidate_id: "cand-b" },
        ],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.transition).toBe("critic_to_next_round");
      expect(res.roundNumber).toBe(3);
    });

    it("falls back to round 1 if round number is missing on round record", () => {
      const state = {
        completion_review: { status: "findings" },
        rounds: [{ status: "opened", objective_id: "obj-c", candidate_id: "cand-c" }],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.transition).toBe("critic_to_next_round");
      expect(res.roundNumber).toBe(2);
    });

    it("transitions critic_to_discovery when round budget is exhausted", () => {
      const state = {
        budget: { max_rounds_per_objective: 2 },
        completion_review: { status: "findings" },
        rounds: [{ round: 2, status: "opened", objective_id: "obj-max", candidate_id: "cand-max" }],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("critic_to_discovery");
      expect(res.roundNumber).toBeNull();
      expect(res.reason).toContain("Round budget exhausted (2/2)");
    });

    it("transitions critic_to_discovery when no round objective or candidate is found", () => {
      const state = {
        completion_review: { status: "findings" },
        rounds: [],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("critic_signed_off");
      expect(res.transition).toBe("critic_to_discovery");
      expect(res.objectiveId).toBeNull();
      expect(res.candidateId).toBeNull();
    });
  });

  describe("autonomous states without completion_review", () => {
    it("transitions candidates_admitted when admitted candidate exists without open round", () => {
      const state = {
        mind: { candidates: [{ id: "c-adm", status: "admitted" }] },
        rounds: [{ round: 1, status: "closed", result: "failed", candidate_id: "c-adm" }],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("candidates_admitted");
      expect(res.transition).toBe("candidate_to_planning");
      expect(res.candidateId).toBe("c-adm");
    });

    it("transitions idle_discovery when open candidate exists without open round", () => {
      const state = {
        candidates: [{ id: "c-open-2", status: "open" }],
        rounds: [],
      };
      const res = assessRecyclingState(state, "/virtual/run");
      expect(res.phase).toBe("idle_discovery");
      expect(res.transition).toBe("discovery_to_admission");
      expect(res.candidateId).toBe("c-open-2");
    });

    it("transitions rollover_ready when all rounds converged and pending feedback exists", () => {
      const qPath = join(tempDir, "feedback.jsonl");
      writeFileSync(
        qPath,
        JSON.stringify({
          id: "fb-2",
          timestamp: "2026-09-01T12:00:00.000Z",
          priority: "NORMAL",
          status: "PENDING",
          category: "CLI_TOOLING",
          title: "Enhance CLI",
          content: "CLI enhancement proposal",
        }) + "\n",
      );

      const state = {
        mind: { generation: 2, actor: "mind-rollover" },
        rounds: [
          { round: 1, status: "closed", result: "converged", candidate_id: "c-1" },
          { round: 2, status: "closed", result: "converged", candidate_id: "c-2" },
        ],
      };
      const res = assessRecyclingState(state, "/virtual/run", {
        checkFeedbackQueue: true,
        feedbackQueuePath: qPath,
      });
      expect(res.phase).toBe("rollover_ready");
      expect(res.transition).toBe("generation_rollover");
      expect(res.targetGeneration).toBe(3);
      expect(res.pendingFeedbackCount).toBe(1);
      expect(res.nextRecommendedCommand).toContain("mind:rotate");
    });

    it("does not trigger rollover_ready if some rounds are not converged", () => {
      const qPath = join(tempDir, "feedback.jsonl");
      writeFileSync(qPath, JSON.stringify({ id: "fb-3", status: "PENDING", title: "Task" }) + "\n");

      const state = {
        rounds: [
          { round: 1, status: "closed", result: "converged" },
          { round: 2, status: "closed", result: "diverged" },
        ],
      };
      const res = assessRecyclingState(state, "/virtual/run", {
        checkFeedbackQueue: true,
        feedbackQueuePath: qPath,
      });
      expect(res.phase).toBe("quiescent");
      expect(res.transition).toBe("pulse_to_wake");
    });
  });
});
