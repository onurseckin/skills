/**
 * Not a suite of its own — tests/unit/support/scratch-root.test.ts spawns this file by explicit
 * path as two independent `bun test` processes (real process boundary, not a simulation) and
 * diffs their output. A fresh process means scratchRoot()'s module-level counter starts at zero
 * again, so if both processes print the same path, that is real proof the path came from a pure,
 * deterministic derivation and not from Math.random / Date.now / mkdtemp's OS-random suffix.
 *
 * It also proves automatic teardown across a real process lifecycle: by the time the spawning
 * test observes this process has exited, this file's own `afterEach` (registered inside
 * scratch-root.ts, not written here) has already deleted the directory — with zero cleanup code
 * in this file.
 *
 * Named `.fixture.ts`, not `.test.ts`, on purpose: bun test's directory-recursion scan only
 * matches ".test"/".spec"/"_test_"/"_spec_" in the filename, so this file is invisible to both
 * the unit and integration lane's normal directory-scoped runs (and to a bare `bun test` from the
 * repo root) — it only ever executes when spawned by its own explicit absolute path, as below.
 */
import { expect, test } from "bun:test";
import { scratchRoot } from "../scratch-root.ts";

test("prints its own deterministic scratch root", () => {
  const root = scratchRoot(import.meta.path, "determinism-probe");
  // Delimited so the parent test can pull the path out of bun's own console/summary noise.
  console.log(`SCRATCH_ROOT::${root}`);
  expect(root.length).toBeGreaterThan(0);
});
