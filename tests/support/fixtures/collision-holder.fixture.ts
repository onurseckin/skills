import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { scratchRoot } from "../scratch-root.ts";

const SHARED_CALLER = "/simulated/shared-collision-caller.test.ts";
const SHARED_LABEL = "collision-slot";
const MARKER_CONTENT = "holder-was-here";

function delay(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

test("claims a shared collision slot and holds it while simulated work runs", () => {
  const root = scratchRoot(SHARED_CALLER, SHARED_LABEL);
  const markerPath = join(root, "holder.txt");
  writeFileSync(markerPath, MARKER_CONTENT);
  console.log(`SCRATCH_ROOT::${root}`);
  delay(1200);
  const survived = existsSync(markerPath) && readFileSync(markerPath, "utf-8") === MARKER_CONTENT;
  console.log(`HOLDER_MARKER_SURVIVED::${survived}`);
});
