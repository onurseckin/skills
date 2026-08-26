import { test } from "bun:test";
import { scratchRoot } from "../scratch-root.ts";

const SHARED_CALLER = "/simulated/shared-collision-caller.test.ts";
const SHARED_LABEL = "collision-slot";

test("claims the same shared collision slot as a still-running holder without colliding with it", () => {
  const root = scratchRoot(SHARED_CALLER, SHARED_LABEL);
  console.log(`SCRATCH_ROOT::${root}`);
});
