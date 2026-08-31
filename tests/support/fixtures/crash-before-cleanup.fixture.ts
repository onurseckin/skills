/**
 * Not a suite of its own — tests/unit/support/scratch-root.test.ts spawns this file by explicit
 * path as two independent `bun test` processes to prove scratchRoot()'s crash-recovery guarantee.
 *
 * Named `.fixture.ts`, not `.test.ts`, on purpose — see print-scratch-root.fixture.ts's header for
 * why: it keeps this deliberately `process.exit()`-ing file invisible to any directory-scoped
 * `bun test` scan, so it can never surface as a spurious "worker crashed" result there.
 *
 * Run 1 creates its root, reports (truthfully) that no marker was there yet, drops a marker file,
 * then calls `process.exit()` — which skips this file's own `afterEach` entirely, the same way a
 * killed or OOM'd worker would leave a deterministic-path directory behind with no chance to clean
 * up after itself.
 *
 * Run 2 is a second, independent process hitting the exact same (file, label) key. Because the
 * derivation is deterministic, it resolves to the exact same path run 1 used — which, on disk,
 * still has run 1's marker sitting in it. If scratchRoot() reports the marker gone anyway, that is
 * proof it force-cleaned the stale directory before handing it back, rather than trusting that a
 * deterministic path is safe to reuse as-is.
 */
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "bun:test";
import { scratchRoot } from "../scratch-root.ts";

test("reports whether a prior crash's marker survived, then leaves its own and exits uncleanly", () => {
  const root = scratchRoot(import.meta.path, "crash-sim");
  const markerPath = join(root, "leftover.txt");
  console.log(`STALE_MARKER_PRESENT::${existsSync(markerPath)}`);
  console.log(`SCRATCH_ROOT::${root}`);
  writeFileSync(markerPath, "leftover-from-a-run-that-never-got-to-clean-up");
  process.exit(0);
});
