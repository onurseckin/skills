import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  closeRoundInState,
  formatMindRoundCloseBrief,
  formatMindRoundOpenBrief,
  getAllRounds,
  getOpenRoundForObjective,
  isRoundResult,
  openRoundInState,
  reconcileRoundState,
  ROUND_RESULTS,
  validateCandidateAdmitted,
  validateObjectiveStatement,
  validatePriorRoundCompleted,
  validateRoundBudget,
  validateRoundCloseArmingRail,
} from "../../../../olt/scripts/src/mind/lifecycle/rounds/index.ts";
import { cleanupVirtualMindFS, setupVirtualMindFS } from "../../fixtures/index.ts";

describe("Mind Assembly Cadence Rounds Suite", () => {
  beforeEach(() => {
    setupVirtualMindFS();
  });
  afterEach(() => {
    cleanupVirtualMindFS();
  });

  describe("Round Result Enum and Validation Rails", () => {
    it("validates canonical ROUND_RESULTS invariants", () => {
      expect(ROUND_RESULTS).toEqual(["converged", "exhausted", "escalated"]);
      expect(isRoundResult("converged")).toBe(true);
      expect(isRoundResult("exhausted")).toBe(true);
      expect(isRoundResult("escalated")).toBe(true);
      expect(isRoundResult("failed")).toBe(false);
      expect(isRoundResult(null)).toBe(false);
      expect(isRoundResult(undefined)).toBe(false);
    });

    it("enforces Tier 1 arming rail on round closure", () => {
      expect(() => validateRoundCloseArmingRail({ result: "converged" })).toThrow(HarnessError);
      expect(() =>
        validateRoundCloseArmingRail({ result: "converged", successor: "run-next" }),
      ).not.toThrow();
      expect(() =>
        validateRoundCloseArmingRail({ result: "converged", terminalReason: "achieved" }),
      ).not.toThrow();
    });

    it("validates candidate admission guard", () => {
      const state = {
        candidates: [
          { id: "cand-1", statement: "stmt-1", status: "admitted" },
          { id: "cand-2", statement: "stmt-2", status: "draft" },
        ],
      };
      expect(validateCandidateAdmitted(state, "cand-1").id).toBe("cand-1");
      expect(() => validateCandidateAdmitted(state, "cand-2")).toThrow(HarnessError);
      expect(() => validateCandidateAdmitted(state, "cand-3")).toThrow(HarnessError);
    });

    it("validates objective statement drift", () => {
      const candidate = { id: "cand-1", statement: "canonical statement", status: "admitted" };
      expect(() => validateObjectiveStatement(candidate, "canonical statement")).not.toThrow();
      expect(() => validateObjectiveStatement(candidate, "drifted statement")).toThrow(
        HarnessError,
      );
      expect(() =>
        validateObjectiveStatement(candidate, undefined, "prior statement drifted"),
      ).toThrow(HarnessError);
    });

    it("enforces round budget limits per objective", () => {
      const state = { budget: { max_rounds_per_objective: 3 } };
      expect(() => validateRoundBudget(state, 3, "obj-1")).not.toThrow();
      expect(() => validateRoundBudget(state, 4, "obj-1")).toThrow(HarnessError);
    });
  });

  describe("openRoundInState Invariants and State Mutation", () => {
    it("opens first round cleanly for admitted candidate and reconciles state", () => {
      const state: Record<string, unknown> = {
        candidates: [{ id: "cand-1", statement: "Bootstrap subsystem", status: "admitted" }],
      };
      const round = openRoundInState(state, {
        objective: "obj-bootstrap",
        candidate: "cand-1",
        actor: "mind-actor",
        nowIso: "2026-09-01T10:00:00.000Z",
      });
      expect(round.round_id).toBe("round-obj-bootstrap-r1");
      expect(round.round).toBe(1);
      expect(round.status).toBe("opened");
      expect(getAllRounds(state).length).toBe(1);
      expect(getOpenRoundForObjective(state, "obj-bootstrap")?.round_id).toBe(round.round_id);
    });

    it("throws HarnessError when opening over an already active round for same objective", () => {
      const state: Record<string, unknown> = {
        candidates: [{ id: "cand-1", statement: "Bootstrap subsystem", status: "admitted" }],
      };
      openRoundInState(state, {
        objective: "obj-bootstrap",
        candidate: "cand-1",
        actor: "mind-actor",
        nowIso: "2026-09-01T10:00:00.000Z",
      });
      expect(() =>
        openRoundInState(state, {
          objective: "obj-bootstrap",
          candidate: "cand-1",
          actor: "mind-actor",
          nowIso: "2026-09-01T10:05:00.000Z",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("closeRoundInState Invariants and State Mutation", () => {
    it("closes open round with valid result and successor arming", () => {
      const state: Record<string, unknown> = {
        candidates: [{ id: "cand-1", statement: "Bootstrap subsystem", status: "admitted" }],
      };
      openRoundInState(state, {
        objective: "obj-bootstrap",
        candidate: "cand-1",
        actor: "mind-actor",
        nowIso: "2026-09-01T10:00:00.000Z",
      });
      const closed = closeRoundInState(state, {
        objective: "obj-bootstrap",
        round: 1,
        actor: "mind-actor",
        result: "converged",
        terminalReason: "Objective successfully delivered",
        nowIso: "2026-09-01T11:00:00.000Z",
      });
      expect(closed.status).toBe("closed");
      expect(closed.result).toBe("converged");
      expect(closed.closed_at).toBe("2026-09-01T11:00:00.000Z");
      expect(getOpenRoundForObjective(state, "obj-bootstrap")).toBeUndefined();
    });

    it("throws HarnessError when closing a nonexistent or already closed round", () => {
      const state: Record<string, unknown> = { candidates: [] };
      expect(() =>
        closeRoundInState(state, {
          objective: "missing",
          round: 1,
          actor: "mind",
          result: "converged",
          terminalReason: "done",
          nowIso: "2026-09-01T10:00:00.000Z",
        }),
      ).toThrow(HarnessError);
    });
  });

  describe("Prior Round Verification and Brief Formatting", () => {
    it("validatePriorRoundCompleted rejects unclosed leases in prior state", () => {
      const vfs = setupVirtualMindFS();
      const capPath = "/capsules/prior-round";
      vfs.mkdirSync(capPath, { recursive: true });
      const priorState = {
        tasks: {
          "task-1": { status: "leased", lease: { agent_id: "worker-1" } },
        },
      };
      vfs.writeFileSync(`${capPath}/state.json`, JSON.stringify(priorState));
      expect(() => validatePriorRoundCompleted(capPath)).toThrow(HarnessError);
      expect(() =>
        validatePriorRoundCompleted(capPath, undefined, { allowLeaseMigration: true }),
      ).not.toThrow();
    });

    it("validatePriorRoundCompleted rejects unclosed branch attempts", () => {
      const vfs = setupVirtualMindFS();
      const capPath = "/capsules/prior-branch";
      vfs.mkdirSync(capPath, { recursive: true });
      const priorState = {
        branches: {
          "branch-1": { status: "open" },
        },
      };
      vfs.writeFileSync(`${capPath}/state.json`, JSON.stringify(priorState));
      expect(() => validatePriorRoundCompleted(capPath)).toThrow(HarnessError);
    });

    it("exempts mind capsules from pulse closure requirement in prior state", () => {
      const vfs = setupVirtualMindFS();
      const capPath = "/capsules/prior-mind";
      vfs.mkdirSync(capPath, { recursive: true });
      const priorState = {
        mind: { active: true },
        pulse: { open: { pulse_id: "pulse-active" } },
      };
      vfs.writeFileSync(`${capPath}/state.json`, JSON.stringify(priorState));
      expect(() => validatePriorRoundCompleted(capPath)).not.toThrow();
    });

    it("formats round open and close briefs within line limits", () => {
      const openBrief = formatMindRoundOpenBrief({
        runRoot: "/capsules/run-1",
        actor: "mind-actor",
        objective: "obj-test",
        candidate: "cand-test",
        statement: "Test round lifecycle brief",
        round: 1,
        maxRounds: 3,
        openedAt: "2026-09-01T12:00:00.000Z",
      });
      expect(openBrief).toContain("Mind Round Opened: `obj-test`");
      expect(openBrief.split("\n").length).toBeLessThanOrEqual(30);

      const closeBrief = formatMindRoundCloseBrief({
        runRoot: "/capsules/run-1",
        actor: "mind-actor",
        objective: "obj-test",
        candidate: "cand-test",
        statement: "Test round lifecycle brief",
        round: 1,
        maxRounds: 3,
        result: "converged",
        terminalReason: "all objectives delivered",
        closedAt: "2026-09-01T13:00:00.000Z",
      });
      expect(closeBrief).toContain("Mind Round Closed: `obj-test`");
      expect(closeBrief.split("\n").length).toBeLessThanOrEqual(30);
    });

    it("reconciles round state and groups objectives correctly", () => {
      const state: Record<string, unknown> = {
        rounds: [
          {
            round_id: "r1",
            objective_id: "obj-alpha",
            round: 1,
            candidate_id: "cand-1",
            statement: "Alpha round",
            status: "closed",
            result: "converged",
            opened_at: "2026-09-01T10:00:00.000Z",
            closed_at: "2026-09-01T11:00:00.000Z",
            actor: "mind",
          },
        ],
      };
      const reconciled = reconcileRoundState(state);
      expect(reconciled.totalRoundsCount).toBe(1);
      expect(reconciled.objectives.length).toBe(1);
      expect(reconciled.objectives[0]!.status).toBe("converged");
    });
  });
});
