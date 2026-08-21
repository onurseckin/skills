# tests/support

Shared test-environment infrastructure. This directory exists to satisfy the isolation contract
this repo's tests run under (pure dependency injection, no module-level mocks, no shared-global
mutation, deterministic state scoping for every input/output/store a test touches) — specifically
the part of it that the rest of the suite currently satisfies ad hoc, file by file, with a
hand-copied pattern.

## The problem this replaces

As of this writing, well over 150 files across `tests/unit` and `tests/integration` open a scratch
directory the same hand-rolled way:

```ts
const roots: string[] = [];
afterEach(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
  roots.length = 0;
});
function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "some-prefix-"));
  roots.push(dir);
  return dir;
}
```

Three concrete problems with that, all found by grepping the actual suite:

1. **The uniqueness guarantee is random, not deterministic.** `mkdtempSync` appends an
   OS-random suffix — that's the entire collision-avoidance mechanism. The isolation contract
   explicitly forbids nondeterminism in fixtures ("never random").
2. **It's duplicated, sometimes verbatim.** `tests/unit/branch/fixture.ts` and
   `tests/unit/workflow/worktree/fixture.ts` each define an identical `cleanupRoots()`. Before this
   change, `tests/unit/config/harness-config.test.ts` declared the same `tempDirs[] +
makeTempDir() + afterEach` trio three separate times in one file — once per `describe` block,
   differing only in the mkdtemp prefix string.
3. **Cleanup is opt-in, and at least one file opted out by omission.** `tests/unit/core/json-paths.test.ts`
   called `mkdtempSync` seven times with no `roots` array and no `afterEach` at all — every run of
   that file leaked seven real directories into the OS temp dir, forever.

`scratchRoot()` (in `scratch-root.ts`) is the one primitive that replaces all of the above.

## What it guarantees

```ts
import { scratchRoot } from "../../support/scratch-root.ts"; // adjust ../.. depth to your file

const root = scratchRoot(import.meta.path, "descriptive-label");
```

- **Deterministic.** The path is a pure function of `(callerPath, label, call-number)` — never
  `Math.random`, `Date.now`, or mkdtemp's random suffix. The same test, run twice, asks for the
  same path both times.
- **Unique.** `callerPath` must be `import.meta.path` from the _calling_ test file. That, plus the
  label, plus a per-`(file, label)` call counter that advances on every call, means no two calls
  anywhere in the suite — same file, same label, doesn't matter — can ever resolve to the same
  path. You never need to invent a prefix that won't collide with some other file's prefix.
- **Clean.** Force-removed immediately before creation. A directory a _crashed_ prior run left at
  that same deterministic path (killed before its `afterEach` ran) cannot leak stale content into
  your test — the one thing mkdtemp's random suffix used to give you for free, now handled
  explicitly instead.
- **Self-cleaning.** Importing `scratch-root.ts` registers its own file-scoped `afterEach`. You
  never write `roots: string[]`, never write a cleanup loop, never remember to call it.
- **Never reads the process's working directory, never touches `process.env`.** Both are anchored
  to the module's own `import.meta.dir`, satisfying the contract's "no test reads `process.cwd()`"
  and "no test mutates `process.env`" clauses directly. (`tests/support/fixtures/*.fixture.ts` read
  an env var, but only one a _parent test's own spawn call_ injects into a _child process_ — that's
  configuration injection into an isolated process, not a test mutating shared env its siblings
  could observe. See those files for the distinction in context.)

Proof for every claim above lives in `tests/unit/support/scratch-root.test.ts`, including two
cases that spawn `tests/support/fixtures/*.fixture.ts` as real, independent `bun test` child
processes specifically because "deterministic across a fresh process" and "a crashed run's
leftovers get force-cleaned" aren't honestly provable by simulating within one already-warm
process — see that file's own top comment for why.

## How to migrate a call site

1. Import: `import { scratchRoot } from "<relative-path-to>/tests/support/scratch-root.ts";`
2. Replace every `mkdtempSync(join(tmpdir(), "prefix-"))` (or the async `mkdtemp` equivalent) with
   `scratchRoot(import.meta.path, "label")`, where `label` is a short, descriptive tag for _that
   call site_ — usually a shortened version of the test's own name. It does not need to be unique
   across the whole file; the call counter already guarantees that. Give it a real label anyway —
   it becomes the directory name under `.tmp/test-scratch/`, and a descriptive one is what makes
   that directory useful when you're staring at a failure.
3. Delete the file's own `roots`/`tempDirs` array and its `afterEach`/`afterAll` cleanup loop.
   scratchRoot() owns teardown now.
4. If the file's `afterEach` was also doing something _else_ (most commonly
   `resetHarnessConfigCache()` — an orthogonal, unrelated per-test isolation concern; scratchRoot
   deliberately doesn't own it), keep a slim `afterEach` for just that. See
   `tests/unit/config/resolved-config.test.ts` for the worked example.
5. Run the one file you touched. Don't run the full lane — see the repo-wide test-running
   instructions for why.

Worked examples, in increasing order of what they demonstrate:

- `tests/unit/config/resolved-config.test.ts` — the base case: one `describe`-scoped
  `tempDirs[]` replaced with `scratchRoot()`, an unrelated `afterEach` concern
  (`resetHarnessConfigCache()`) kept in place.
- `tests/unit/config/harness-config.test.ts` — the same base case, but the
  `tempDirs[] + makeTempDir() + afterEach` trio was duplicated three times (once per `describe`
  block) before this change; migrating collapsed all three into one module-level `makeTempDir()`
  wrapper shared across the file.
- `tests/unit/core/json-paths.test.ts` — the highest-value case: this file had no cleanup at all
  before migrating, so adopting `scratchRoot()` didn't just deduplicate boilerplate, it fixed a
  real, silent directory leak (seven leaked temp directories per run, indefinitely).

That's every pattern variant this codebase's call sites use. The remaining ~150 files are the same
three shapes repeated; migrating the rest is mechanical from here — this was intentionally not done
wholesale in the same change that introduced the primitive, both to keep that change reviewable and
because other work was landing across this tree concurrently.

## What this doesn't cover

- **Fixture builders that wrap a scratch root with domain setup** — e.g. `tests/unit/branch/fixture.ts`'s
  `branchCapsule()` (a scratch root plus a real `git init` and commits) or
  `tests/unit/workflow/worktree/fixture.ts`'s `worktreeCapsule()` (the same, plus a second scratch
  root wired in as `worktree_root` and a `resetHarnessConfigCache()` call). Those should call
  `scratchRoot()` internally for their directory allocation instead of their own `mkdtemp` — the
  domain-specific setup on top (git init, config files, second root) stays exactly as it is now.
  Not migrated here; same "mechanical, do it when you touch that file" guidance applies.
- **`resetHarnessConfigCache()`** — a real, separate isolation concern (module-level cache reset)
  that some scratch-root-using tests also need. `scratch-root.ts` doesn't call it for you; keep
  calling it yourself where the file already does.
