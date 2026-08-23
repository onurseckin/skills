/**
 * Shared scratch-directory helper for tests.
 *
 * Supersedes the ad-hoc pattern repeated across ~140 files in tests/unit and tests/integration:
 *
 *   const roots: string[] = [];
 *   afterEach(() => { for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true }); });
 *   function makeTempDir() {
 *     const dir = mkdtempSync(join(tmpdir(), "some-prefix-"));
 *     roots.push(dir);
 *     return dir;
 *   }
 *
 * That pattern is hand-copied (sometimes verbatim, e.g. the identical `cleanupRoots` in
 * tests/unit/branch/fixture.ts and tests/unit/workflow/worktree/fixture.ts; sometimes
 * re-declared three times in one file, e.g. tests/unit/config/harness-config.test.ts) and its
 * uniqueness guarantee comes entirely from mkdtemp's OS-random suffix — which is exactly the kind
 * of nondeterminism the isolation contract for this suite forbids in fixtures.
 *
 * scratchRoot() replaces it with one deterministic, self-cleaning primitive. See
 * tests/support/README.md for the full migration guide and rationale.
 */
import { afterEach } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { tmpdir } from "node:os";

// tests/support -> repo root. Anchored to this module's own location (a compile-time constant),
// never to the process's working directory — the isolation contract forbids tests reading that to
// find their scratch space.
const REPO_ROOT = join(import.meta.dir, "..", "..");
const SCRATCH_BASE = join(tmpdir(), "olt-test-scratch");

function slug(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  return cleaned.length > 0 ? cleaned.slice(0, 60) : "root";
}

// A short, fully deterministic disambiguator (not randomness — a pure function of the input) so
// that two different labels which happen to slug down to the same text still resolve to different
// directories instead of silently colliding.
function shortDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 10);
}

// Under `bun test --no-isolate` *without* `--parallel`, every test file in the run can share this
// one module evaluation — the whole suite's counters and, formerly, a single shared roots array
// and one top-of-file `afterEach` all lived here. That single hook attaches to whichever file's
// collection phase happened to trigger this module's first evaluation, so every *other* file
// sharing it never got a working teardown at all: exactly the leak
// tests/unit/support/scratch-root.test.ts's "the previous test's root is already gone" case
// caught. `callsPerKey` alone is still safe to share (it's keyed by the caller's own relative
// path, so two files never collide on it); cleanup can't be, so scratchRoot() registers its own
// afterEach per call below instead of relying on one hook shared module-wide.
const callsPerKey = new Map<string, number>();

/**
 * Returns a scratch directory that is:
 *  - deterministic: the same (callerPath, label) call sequence produces the same path on every
 *    run, on every machine — never Math.random, Date.now, or mkdtemp's random suffix.
 *  - unique: derived from the caller's own file path plus a label plus a per-(file, label) call
 *    counter, so no two calls anywhere in the suite — same file or different — can ever resolve
 *    to the same path.
 *  - clean: force-removed before creation, so even a directory a prior *crashed* run left behind
 *    at the same deterministic path (killed before its afterEach ran) can't leak stale content
 *    into this test — the one thing mkdtemp's random suffix used to give for free.
 *  - self-cleaning: this call registers its own one-shot `afterEach` for this one root before
 *    returning it. Callers never write their own roots array or cleanup hook. Registering fresh
 *    per call (rather than once, at module load, into a shared array) is deliberate: a hook
 *    `bun:test` attaches while a test is already running is scoped to that test alone, so it's
 *    the only registration style that stays correct even when this module is evaluated once and
 *    shared by several test files — see the comment above `callsPerKey` for why that matters here.
 *
 * `callerPath` must be `import.meta.path` taken from the CALLING test file, not this module — that
 * namespaces the root by real, unambiguous file identity instead of a hand-typed prefix that could
 * typo into a collision with another file's prefix. `label` is normally the test's own name,
 * mirroring the `name` argument the old `mkdtempSync(..., \`prefix-${name}-\`)` call sites already
 * threaded through by convention.
 *
 * Call it more than once with the same (callerPath, label) — e.g. once per test in a shared
 * `beforeEach`, or twice in one test for two independent roots — and each call still gets its own
 * distinct directory; the counter advances every call, it does not require a distinct label.
 */
export function scratchRoot(callerPath: string, label: string): string {
  const fileTag = slug(relative(REPO_ROOT, callerPath).split(sep).join("-"));
  const key = `${fileTag}::${label}`;
  const call = (callsPerKey.get(key) ?? 0) + 1;
  callsPerKey.set(key, call);
  const dirName = `${fileTag}--${slug(label)}--${call}--${shortDigest(key)}`;
  const root = join(SCRATCH_BASE, dirName);
  rmSync(root, { recursive: true, force: true });
  mkdirSync(root, { recursive: true });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });
  return root;
}
