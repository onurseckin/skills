import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  listWatchdogs,
  registerWatchdog,
  renderAsciiWatchdogTable,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";

describe("WatchdogManager - Monitoring & Listing", () => {
  test("listWatchdogs filters by status, pulse_id, phase, and generation", () => {
    const dir = mkdtempSync(join(tmpdir(), "monitor-test-"));
    try {
      registerWatchdog({ pulse_id: "p1", phase: "loop", generation: 1 }, dir);
      registerWatchdog({ pulse_id: "p2", phase: "execution", generation: 2 }, dir);

      const all = listWatchdogs({}, dir);
      expect(all.length).toBe(2);

      const p1List = listWatchdogs({ pulse_id: "p1" }, dir);
      expect(p1List.length).toBe(1);
      expect(p1List[0]?.pulse_id).toBe("p1");

      const execList = listWatchdogs({ phase: "execution" }, dir);
      expect(execList.length).toBe(1);
      expect(execList[0]?.phase).toBe("execution");

      const gen2List = listWatchdogs({ generation: 2 }, dir);
      expect(gen2List.length).toBe(1);
      expect(gen2List[0]?.generation).toBe(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("renderAsciiWatchdogTable renders markdown table for active watchdogs", () => {
    const dir = mkdtempSync(join(tmpdir(), "ascii-table-"));
    try {
      registerWatchdog({ pulse_id: "p-table", phase: "loop", generation: 1 }, dir);
      const watchdogs = listWatchdogs({}, dir);
      const table = renderAsciiWatchdogTable(watchdogs);
      expect(table).toContain("Watchdog ID");
      expect(table).toContain("p-table");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
