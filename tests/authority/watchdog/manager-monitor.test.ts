import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  listWatchdogs,
  registerWatchdog,
  renderAsciiWatchdogTable,
} from "../../../olt/scripts/src/authority/watchdog/index.ts";
import { cleanupVirtualAuthorityFS, setupVirtualAuthorityFS } from "../fixture.ts";

describe("WatchdogManager - Monitoring & Listing", () => {
  beforeEach(() => {
    setupVirtualAuthorityFS();
  });
  afterEach(() => {
    cleanupVirtualAuthorityFS();
  });

  test("listWatchdogs filters by status, pulse_id, phase, and generation", () => {
    const dir = "/virtual/watchdog/monitor-filter";
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
  });

  test("renderAsciiWatchdogTable renders markdown table for active watchdogs", () => {
    const dir = "/virtual/watchdog/monitor-table";
    registerWatchdog({ pulse_id: "p-table", phase: "loop", generation: 1 }, dir);
    const watchdogs = listWatchdogs({}, dir);
    const table = renderAsciiWatchdogTable(watchdogs);
    expect(table).toContain("Watchdog ID");
    expect(table).toContain("p-table");
  });
});
