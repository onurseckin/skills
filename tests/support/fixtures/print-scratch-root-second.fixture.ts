/**
 * A second, differently-named twin of print-scratch-root.fixture.ts. Its only purpose is to be a
 * *different file* that also imports scratch-root.ts, so tests/unit/support/scratch-root.test.ts
 * can spawn this one alongside the other in the same `bun test --no-isolate` (no `--parallel`)
 * child process — the one mode where both files are proven to share this module's single
 * evaluation (see that test's own "cross-file module sharing" case). If cleanup were still wired
 * through a shared array plus one module-load-time `afterEach` (as it originally was), only
 * whichever of the two files happened to trigger that first evaluation would ever get its root
 * cleaned up; the other would leak. Named `.fixture.ts`, not `.test.ts`, for the same reason as
 * its twin: bun test's directory scan ignores it, so it only ever runs when spawned by this exact
 * path.
 */
import { expect, test } from "bun:test";
import { scratchRoot } from "../scratch-root.ts";

test("prints its own deterministic scratch root (second file)", () => {
  const root = scratchRoot(import.meta.path, "determinism-probe-second");
  console.log(`SCRATCH_ROOT::${root}`);
  expect(root.length).toBeGreaterThan(0);
});
