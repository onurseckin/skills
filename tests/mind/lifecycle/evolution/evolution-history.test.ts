import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import * as pathsMod from "../../../../olt/scripts/src/core/shared/paths.ts";
import {
  resolveEvolutionHistoryPath,
  readEvolutionHistory,
  recordEvolutionCycle,
  getEvolutionStats,
  enforcePerpetualNonStoppingCadence,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/history.ts";
import {
  PERPETUAL_NON_STOPPING_CADENCE,
  NON_STOPPING_RULE,
  type EvolutionLedgerEntry,
} from "../../../../olt/scripts/src/mind/lifecycle/evolution/types.ts";

describe("Evolution History & Non-Stopping Cadence (history.ts)", () => {
  let tempDir: string;
  let historyFile: string;
  const spies: Array<{ mockRestore: () => void }> = [];

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "evolution-history-test-"));
    historyFile = join(tempDir, "sub", "EVOLUTION_HISTORY.jsonl");
  });

  afterEach(() => {
    for (const spy of spies) spy.mockRestore();
    spies.length = 0;
    rmSync(tempDir, { recursive: true, force: true });
  });

  const makeEntry = (
    id: string,
    mode: EvolutionLedgerEntry["mode"] = "MODE_A_AUTONOMIC_DISCOVERY",
  ): EvolutionLedgerEntry => ({
    cycleId: id,
    generation: 1,
    cycleNumber: 1,
    timestamp: "2026-09-01T12:00:00.000Z",
    mode,
    discoveriesCount: 2,
    taskIds: [`task-${id}-1`, `task-${id}-2`],
    feedbackIds: [`fb-${id}`],
    durationMs: 150,
    summary: `Cycle ${id} completed`,
    planRevisionsCount: 1,
    scalingAction: "SCALE_OUT",
  });

  describe("resolveEvolutionHistoryPath", () => {
    it("resolves custom paths cleanly", () => {
      const resolved = resolveEvolutionHistoryPath("  custom/path/to/history.jsonl  ");
      expect(resolved.endsWith("custom/path/to/history.jsonl")).toBe(true);
    });

    it("resolves default test environment path when customPath is omitted", () => {
      const resolved = resolveEvolutionHistoryPath();
      expect(resolved.endsWith("EVOLUTION_HISTORY.jsonl")).toBe(true);
    });

    it("resolves capsules dir path when outside test environment", () => {
      spies.push(spyOn(pathsMod, "isTestEnvironment").mockReturnValue(false));
      const resolved = resolveEvolutionHistoryPath();
      expect(resolved.endsWith("EVOLUTION_HISTORY.jsonl")).toBe(true);
    });
  });

  describe("recordEvolutionCycle & readEvolutionHistory", () => {
    it("returns empty array when file does not exist", () => {
      const entries = readEvolutionHistory(join(tempDir, "non-existent.jsonl"));
      expect(entries).toEqual([]);
    });

    it("records entries to new directory and reads them back with full fidelity", () => {
      const entry1 = makeEntry("cycle-1", "MODE_A_AUTONOMIC_DISCOVERY");
      const entry2 = makeEntry("cycle-2", "MODE_B_FEEDBACK_INTAKE");

      recordEvolutionCycle(entry1, historyFile);
      recordEvolutionCycle(entry2, historyFile);

      const history = readEvolutionHistory(historyFile);
      expect(history).toHaveLength(2);
      expect(history[0]?.cycleId).toBe("cycle-1");
      expect(history[0]?.mode).toBe("MODE_A_AUTONOMIC_DISCOVERY");
      expect(history[0]?.planRevisionsCount).toBe(1);
      expect(history[0]?.scalingAction).toBe("SCALE_OUT");
      expect(history[1]?.cycleId).toBe("cycle-2");
      expect(history[1]?.mode).toBe("MODE_B_FEEDBACK_INTAKE");
    });

    it("skips malformed and blank lines safely while applying fallback defaults", () => {
      const validSparseLine = JSON.stringify({
        cycleId: "sparse-1",
        mode: "MODE_C_INVARIANT_HARDENING",
      });
      const malformedLine = "{ bad json !!";
      const missingFieldsLine = JSON.stringify({ otherField: 123 });
      const fullContent = `\n${validSparseLine}\n\n${malformedLine}\n${missingFieldsLine}\n`;

      mkdirSync(dirname(historyFile), { recursive: true });
      writeFileSync(historyFile, fullContent);

      const history = readEvolutionHistory(historyFile);
      expect(history).toHaveLength(1);
      expect(history[0]?.cycleId).toBe("sparse-1");
      expect(history[0]?.generation).toBe(1);
      expect(history[0]?.cycleNumber).toBe(1);
      expect(history[0]?.discoveriesCount).toBe(0);
      expect(history[0]?.taskIds).toEqual([]);
      expect(history[0]?.feedbackIds).toEqual([]);
      expect(history[0]?.durationMs).toBe(0);
      expect(history[0]?.summary).toBe("");
    });
  });

  describe("getEvolutionStats", () => {
    it("aggregates totals and categorizes cycles by mode", () => {
      const entries: EvolutionLedgerEntry[] = [
        makeEntry("c1", "MODE_A_AUTONOMIC_DISCOVERY"),
        makeEntry("c2", "MODE_B_FEEDBACK_INTAKE"),
        makeEntry("c3", "MODE_C_INVARIANT_HARDENING"),
        makeEntry("c4", "QUEUE_ACTIVE"),
      ];

      const stats = getEvolutionStats(entries);
      expect(stats.totalCycles).toBe(4);
      expect(stats.totalTasks).toBe(8);
      expect(stats.totalFeedbackIngested).toBe(4);
      expect(stats.cyclesByMode.MODE_A_AUTONOMIC_DISCOVERY).toBe(1);
      expect(stats.cyclesByMode.MODE_B_FEEDBACK_INTAKE).toBe(1);
      expect(stats.cyclesByMode.MODE_C_INVARIANT_HARDENING).toBe(1);
      expect(stats.cyclesByMode.QUEUE_ACTIVE).toBe(1);
    });

    it("handles empty history without crashing", () => {
      const stats = getEvolutionStats([]);
      expect(stats.totalCycles).toBe(0);
      expect(stats.totalTasks).toBe(0);
      expect(stats.totalFeedbackIngested).toBe(0);
      expect(stats.cyclesByMode.MODE_A_AUTONOMIC_DISCOVERY).toBe(0);
    });
  });

  describe("enforcePerpetualNonStoppingCadence", () => {
    it("enforces non-stopping cadence with runRoot argument", () => {
      const result = enforcePerpetualNonStoppingCadence({
        actor: "mind-governor",
        runRoot: "/path/to/run",
      });

      expect(result.cadence).toBe(PERPETUAL_NON_STOPPING_CADENCE);
      expect(result.allowed).toBe(true);
      expect(result.closing_permitted).toBe(false);
      expect(result.nextInstruction).toBe("bun harness.ts mind:wake --run /path/to/run");
      expect(result.message).toBe(NON_STOPPING_RULE);
    });

    it("enforces non-stopping cadence without runRoot argument", () => {
      const result = enforcePerpetualNonStoppingCadence({
        actor: "mind-governor",
      });

      expect(result.cadence).toBe(PERPETUAL_NON_STOPPING_CADENCE);
      expect(result.allowed).toBe(true);
      expect(result.closing_permitted).toBe(false);
      expect(result.nextInstruction).toBe("bun harness.ts mind:wake");
    });
  });
});
