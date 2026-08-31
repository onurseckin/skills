import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cleanupPreviousPhaseWatchdogs,
  listWatchdogs,
  registerWatchdog,
  terminatePhaseWatchdogs,
  terminateWatchdog,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";

describe("WatchdogManager - Termination & Lifecycle Phase Transitions", () => {
  test("terminateWatchdog transitions status to terminated with reason", () => {
    const dir = mkdtempSync(join(tmpdir(), "terminate-test-"));
    try {
      const reg = registerWatchdog({ pulse_id: "p1", phase: "loop", generation: 1 }, dir);
      const term = terminateWatchdog(reg.watchdog.id, { reason: "job finished" }, dir);
      expect(term.status).toBe("terminated");
      expect(term.termination_reason).toBe("job finished");
      expect(term.terminated_at).not.toBeNull();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("terminatePhaseWatchdogs terminates all watchdogs for a phase", () => {
    const dir = mkdtempSync(join(tmpdir(), "phase-terminate-"));
    try {
      registerWatchdog({ pulse_id: "p1", phase: "planning", generation: 1 }, dir);
      registerWatchdog({ pulse_id: "p2", phase: "planning", generation: 2 }, dir);
      registerWatchdog({ pulse_id: "p3", phase: "execution", generation: 3 }, dir);

      const res = terminatePhaseWatchdogs({ phase: "planning", reason: "phase end" }, dir);
      expect(res.terminatedCount).toBe(2);

      const active = listWatchdogs({ status: "active" }, dir);
      expect(active.length).toBe(1);
      expect(active[0]?.phase).toBe("execution");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("cleanupPreviousPhaseWatchdogs cleans up earlier phases in the pulse", () => {
    const dir = mkdtempSync(join(tmpdir(), "prev-phase-cleanup-"));
    try {
      registerWatchdog({ pulse_id: "pulse-seq", phase: "planning", generation: 1 }, dir);
      const cleanupRes = cleanupPreviousPhaseWatchdogs(
        { currentPhase: "execution", pulse_id: "pulse-seq" },
        dir,
      );
      expect(cleanupRes.terminatedCount).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
