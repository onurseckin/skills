import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import {
  getAllRounds,
  getOpenRoundForObjective,
  reconcileRoundState,
  validatePriorRoundCompleted,
  validateRoundCloseArmingRail,
} from "../../../../olt/scripts/src/mind/lifecycle/rounds/round-open.ts";
import type { RoundRecord } from "../../../../olt/scripts/src/mind/lifecycle/rounds/types.ts";

describe("Round Open & Lifecycle Reconciliation Suite (round-open.ts)", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "round-open-cov-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe("validatePriorRoundCompleted", () => {
    it("safely handles nonexistent or missing state paths", () => {
      expect(() => validatePriorRoundCompleted(undefined)).not.toThrow();
      expect(() => validatePriorRoundCompleted(join(tempDir, "nonexistent"))).not.toThrow();
      expect(() => validatePriorRoundCompleted(tempDir)).not.toThrow();
    });

    it("throws INTEGRITY error on malformed json state file", () => {
      writeFileSync(join(tempDir, "state.json"), "{ invalid json");
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(HarnessError);
    });

    it("validates task leases and honors lease migration options", () => {
      const statePath = join(tempDir, "state.json");
      const writeState = (tasks: Record<string, unknown>) => {
        writeFileSync(statePath, JSON.stringify({ run_id: "run-1", tasks }));
      };

      writeState({ "task-1": { status: "leased" }, "task-invalid": null });
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(
        /has a live lease on task 'task-1'/,
      );

      expect(() =>
        validatePriorRoundCompleted(tempDir, undefined, { allowLeaseMigration: true }),
      ).not.toThrow();

      expect(() =>
        validatePriorRoundCompleted(tempDir, "run-custom", { migratableTaskIds: ["task-1"] }),
      ).not.toThrow();

      writeState({
        "task-f": { lease: { expires_at: new Date(Date.now() + 60000).toISOString() } },
      });
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/task-f/);

      writeState({
        "task-p": { lease: { expires_at: new Date(Date.now() - 60000).toISOString() } },
      });
      expect(() => validatePriorRoundCompleted(tempDir)).not.toThrow();

      writeState({ "task-n": { lease: { expires_at: 123456 } } });
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/task-n/);
    });

    it("validates unclosed branch attempts", () => {
      const statePath = join(tempDir, "state.json");
      writeFileSync(
        statePath,
        JSON.stringify({
          branches: { "b-1": { status: "open" }, "b-skip": null },
        }),
      );
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/unclosed branch attempt 'b-1'/);

      writeFileSync(statePath, JSON.stringify({ branches: { "b-2": { status: "leased" } } }));
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/b-2/);

      writeFileSync(statePath, JSON.stringify({ branches: { "b-ok": { status: "closed" } } }));
      expect(() => validatePriorRoundCompleted(tempDir)).not.toThrow();
    });

    it("differentiates pulse validation between standard and mind capsules", () => {
      const statePath = join(tempDir, "state.json");
      writeFileSync(statePath, JSON.stringify({ pulse: { open: { pulse_id: "pulse-active" } } }));
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/pulse-active/);

      writeFileSync(statePath, JSON.stringify({ pulse: { open: {} } }));
      expect(() => validatePriorRoundCompleted(tempDir)).toThrow(/open-pulse/);

      writeFileSync(
        statePath,
        JSON.stringify({
          mind: { status: "running" },
          pulse: { open: { pulse_id: "pulse-mind" } },
        }),
      );
      expect(() => validatePriorRoundCompleted(tempDir)).not.toThrow();
    });
  });

  describe("validateRoundCloseArmingRail", () => {
    it("accepts valid successor or terminal reason", () => {
      expect(() =>
        validateRoundCloseArmingRail({ result: "converged", successor: "next-run" }),
      ).not.toThrow();
      expect(() =>
        validateRoundCloseArmingRail({ result: "exhausted", terminalReason: "budget limit" }),
      ).not.toThrow();
    });

    it("throws INVALID_ARGUMENT when neither successor nor terminal reason provided", () => {
      expect(() =>
        validateRoundCloseArmingRail({ result: "converged", successor: "  ", terminalReason: "" }),
      ).toThrow(/Tier 1 arming rail/);
    });
  });

  describe("getAllRounds & getOpenRoundForObjective", () => {
    it("aggregates and deduplicates rounds across root and mind state", () => {
      const r1: RoundRecord = {
        round_id: "r1",
        round: 1,
        objective_id: "obj-a",
        candidate_id: "c1",
        statement: "Goal A",
        status: "closed",
        result: "converged",
        opened_at: "2026-09-01T10:00:00Z",
        closed_at: "2026-09-01T10:30:00Z",
      };
      const r2: RoundRecord = {
        round_id: "r2",
        round: 2,
        objective_id: "obj-a",
        candidate_id: "c1",
        statement: "Goal A",
        status: "opened",
        opened_at: "2026-09-01T10:35:00Z",
      };
      const state = { rounds: [r1], mind: { rounds: [r1, r2] } };

      const all = getAllRounds(state);
      expect(all.length).toBe(2);
      expect(getOpenRoundForObjective(state, "obj-a")?.round_id).toBe("r2");
      expect(getOpenRoundForObjective(state, "obj-missing")).toBeUndefined();
    });
  });

  describe("reconcileRoundState", () => {
    it("reconciles objectives and rounds and updates state projection", () => {
      const r1: RoundRecord = {
        round_id: "r1",
        round: 1,
        objective_id: "obj-1",
        candidate_id: "cand-1",
        statement: "Primary Target",
        status: "closed",
        opened_at: "2026-09-01T08:00:00Z",
        closed_at: "2026-09-01T08:30:00Z",
      };
      const r2: RoundRecord = {
        round_id: "r2",
        round: 2,
        objective_id: "obj-1",
        candidate_id: "cand-1",
        statement: "Primary Target",
        status: "opened",
        opened_at: "2026-09-01T08:35:00Z",
      };
      const state: Record<string, unknown> = {
        rounds: [r2, r1],
        mind: { budget: { max_rounds_per_objective: 5 } },
      };

      const reconciled = reconcileRoundState(state);
      expect(reconciled.totalRoundsCount).toBe(2);
      expect(reconciled.activeRounds.length).toBe(1);
      expect(reconciled.activeRounds[0]?.round_id).toBe("r2");
      expect(reconciled.objectives.length).toBe(1);

      const obj = reconciled.objectives[0]!;
      expect(obj.id).toBe("obj-1");
      expect(obj.current_round).toBe(2);
      expect(obj.max_rounds).toBe(5);
      expect(obj.status).toBe("active");
      expect(obj.created_at).toBe("2026-09-01T08:00:00Z");

      const filtered = reconcileRoundState(state, "obj-other");
      expect(filtered.objectives.length).toBe(0);
    });
  });
});
