import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  mapMediaAssets,
  mapRunScreenshotAssets,
} from "../../../olt/scripts/src/summary/assets/index.ts";
import {
  cleanupVirtualSummaryFS,
  getVirtualSummaryFS,
  scratchRoot,
  setupVirtualSummaryFS,
} from "../fixture.ts";
import { makeTask } from "../reporters/dag/graph-fixtures.ts";

beforeEach(() => {
  setupVirtualSummaryFS();
});

afterEach(() => {
  cleanupVirtualSummaryFS();
});

/**
 * `queryScreenshots` reads `.captures.json` under the run root; its own internal try/catch already
 * absorbs a corrupt file, so the only way to reach the *callers'* own catch here is a runRoot that
 * fails before that internal handling even runs — `node:path`'s `join()` throwing on a non-string,
 * exactly as would happen if a caller's `runRoot` were corrupted in transit despite the type system.
 */
const NOT_A_PATH = 42 as unknown as string;

describe("screenshot lookup failures never surface as a thrown error", () => {
  test("mapRunScreenshotAssets reports no screenshots rather than throwing", () => {
    expect(mapRunScreenshotAssets(NOT_A_PATH)).toEqual([]);
  });

  test("mapMediaAssets falls back to whatever else it found, not an empty result", () => {
    const task = makeTask("T-1", { label: "Task" });
    const assets = mapMediaAssets(task, [], { runRoot: NOT_A_PATH, scope: "validator" });
    expect(assets).toEqual([]);
  });

  test("absorbs missing and corrupted captures in in-memory VirtualMemoryFS", () => {
    const vfs = getVirtualSummaryFS();
    const runRoot = scratchRoot(import.meta.path, "corrupted-captures");
    expect(mapRunScreenshotAssets(runRoot)).toEqual([]);

    const capturesDir = join(runRoot, ".olt", "capsules");
    vfs.mkdirSync(capturesDir, { recursive: true });
    vfs.writeFileSync(join(capturesDir, ".captures.json"), "{ corrupted json");

    expect(mapRunScreenshotAssets(runRoot)).toEqual([]);
    const task = makeTask("T-2", { label: "Task 2" });
    expect(mapMediaAssets(task, [], { runRoot, scope: "validator" })).toEqual([]);
  });
});
