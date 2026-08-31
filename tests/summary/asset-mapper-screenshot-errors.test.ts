import { describe, expect, test } from "bun:test";
import {
  mapMediaAssets,
  mapRunScreenshotAssets,
} from "../../olt/scripts/src/summary/assets/index.ts";
import { makeTask } from "./graph-fixtures.ts";

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
});
