# OLT Modularity Guard Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standard-library-only modularity scanner that reads Git-index blobs, enforces the approved architecture rules, and supports migration ratchet and strict modes.

**Architecture:** Small feature slices separate scope classification, Git inventory, line/fanout rules, import graph analysis, policy comparison, and reporting. `scripts/modularity/index.ts` is the sole public facade; `check.ts` is a thin CLI.

**Tech Stack:** Bun, TypeScript 5.7, Node/Bun standard library, Git plumbing, existing Bun test runner

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- Maximum 300 physical lines; 300 passes and 301 fails.
- Maximum 10 direct in-scope files per directory, including indexes.
- Standard-library-only implementation; no repository production imports.
- Staged scans read Git-index blobs and fail closed.
- Direct TypeScript files in `olt/scripts`, `scripts`, and `scripts/testing` participate in missing-facade checks; executable entrypoints are not exempt.
- Explicit named-export facades; no export-star.
- P01 owns `scripts/modularity/baseline/**` only through its reviewed baseline-generation commit. Immediately after that commit is pushed, sole ownership transfers to P05 and P01 treats the baseline read-only.
- Exact exclusions and root fixed set come from the design specification.
- SOL/high plans and reconciles; Terra/high implements and independently reviews.
- Each reviewed task ends with a Conventional Commit and push.

---

### Task 1: Contracts, scope, and root policy

**Files:**

- Create: `scripts/modularity/core/contracts.ts:1`
- Create: `scripts/modularity/core/errors.ts:1`
- Create: `scripts/modularity/core/scope.ts:1`
- Create: `scripts/modularity/core/index.ts:1`
- Test: `tests/unit/scripts/modularity/core/scope.test.ts:1`
- Create: `tests/unit/scripts/modularity/core/fixture-builders.ts:1`
- Create: `tests/unit/scripts/modularity/core/index.ts:1`

**Interfaces:**

- Produces: `ModularityMode`, `ScanSource`, `ViolationRule`, `Violation`, `CheckReport`, `ScopeDecision`, `classifyPath(path: string): ScopeDecision`, `assertRootConvention(paths: readonly string[]): Violation[]`.
- Consumes: repository-relative POSIX paths only.

- [ ] **Step 1: Write failing scope boundary tests**

```ts
test("includes production runtime but excludes runtime output", () => {
  expect(classifyPath("olt/scripts/src/runtime/agent-metadata.ts").included).toBe(true);
  expect(classifyPath(".olt/capsules/run/runtime/session.json").included).toBe(false);
});
test("counts markdown for fanout but not lines", () => {
  expect(classifyPath("docs/guide.md")).toEqual({
    included: true,
    lineLimited: false,
    fanoutCounted: true,
    importScanned: false,
  });
});
test("never exempts TypeScript fixtures", () => {
  expect(classifyPath("tests/support/fixtures/worker.fixture.ts").lineLimited).toBe(true);
});
```

- [ ] **Step 2: Run the red test**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/core/scope.test.ts`
Expected: FAIL because `scripts/modularity/core/index.ts` does not exist.

- [ ] **Step 3: Implement exact contracts and classification**

```ts
export type ModularityMode = "ratchet" | "strict";
export type ScanSource = "index" | "tree";
export type ViolationRule =
  | "line_limit"
  | "directory_fanout"
  | "missing_facade"
  | "export_star"
  | "facade_bypass"
  | "dependency_cycle"
  | "root_no_growth"
  | "generated_catalog";

export interface ScopeDecision {
  readonly included: boolean;
  readonly lineLimited: boolean;
  readonly fanoutCounted: boolean;
  readonly importScanned: boolean;
}
```

Implement ordered exclusions before extension rules. Hard-code the ten approved root paths and reject any additional included root path. Export every public symbol explicitly from `core/index.ts`.

- [ ] **Step 4: Run green tests and boundary review**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/core`
Expected: PASS; reviewer confirms `olt/scripts/src/runtime/**` is included and no glob can hide TypeScript fixtures.

- [ ] **Step 5: Commit and push**

Run: `git add scripts/modularity/core tests/unit/scripts/modularity/core`
Run: `git commit -m "feat(modularity): define fail-closed scan scope"`
Run: `git push origin main`
Expected: push succeeds.

### Task 2: Git-index inventory, physical lines, and fanout

**Files:**

- Create: `scripts/modularity/inventory/git-index.ts:1`
- Create: `scripts/modularity/inventory/physical-lines.ts:1`
- Create: `scripts/modularity/inventory/fanout.ts:1`
- Create: `scripts/modularity/inventory/index.ts:1`
- Test: `tests/unit/scripts/modularity/inventory/git-index.test.ts:1`
- Test: `tests/unit/scripts/modularity/inventory/physical-lines.test.ts:1`
- Test: `tests/unit/scripts/modularity/inventory/fanout.test.ts:1`
- Create: `tests/unit/scripts/modularity/inventory/index-fixture.ts:1`
- Create: `tests/unit/scripts/modularity/inventory/index.ts:1`

**Interfaces:**

- Consumes: `ScopeDecision` from `../core/index.ts`.
- Produces: `IndexedBlob { path, oid, bytes }`, `readIndexedBlobs(repoRoot): Promise<readonly IndexedBlob[]>`, `countPhysicalLines(bytes): number`, `findLineViolations(blobs): Violation[]`, `findFanoutViolations(blobs): Violation[]`.

- [ ] **Step 1: Write failing line and index-source tests**

```ts
test.each([
  [new Uint8Array(), 0],
  [new TextEncoder().encode("x\n".repeat(300)), 300],
  [new TextEncoder().encode("x\n".repeat(300) + "x"), 301],
])("counts physical lines", (bytes, expected) => {
  expect(countPhysicalLines(bytes)).toBe(expected);
});

test("reads staged bytes instead of a divergent working tree", async () => {
  const repo = createIndexedFixture({ staged: "a\n".repeat(300), working: "b\n".repeat(301) });
  const [blob] = await readIndexedBlobs(repo);
  expect(countPhysicalLines(blob.bytes)).toBe(300);
});
```

- [ ] **Step 2: Run red tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/inventory`
Expected: FAIL with missing inventory modules.

- [ ] **Step 3: Implement Git plumbing without shell interpolation**

Use direct argv with `Bun.spawn`:

```ts
const list = Bun.spawn(["git", "-C", repoRoot, "ls-files", "-s", "-z"], {
  stdout: "pipe",
  stderr: "pipe",
});
```

Parse NUL records, validate mode/OID/path, and request blobs through one `git cat-file --batch` process. Reject malformed headers, size mismatch, missing objects, duplicate paths, non-zero exit, and partial reads. Do not fall back to `readFile`.

- [ ] **Step 4: Implement line/fanout checks**

Group included blobs by POSIX dirname. Emit a line violation only above 300 and a fanout violation only above 10. Count `index.ts`, JSON, Markdown, and YAML in fanout after scope classification.

- [ ] **Step 5: Run green and adversarial tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/inventory`
Expected: PASS, including 300/301, 10/11, rename, deletion, malformed batch, and index-versus-working-tree cases.

- [ ] **Step 6: Commit and push**

Run: `git add scripts/modularity/inventory tests/unit/scripts/modularity/inventory`
Run: `git commit -m "feat(modularity): scan indexed lines and fanout"`
Run: `git push origin main`
Expected: push succeeds.

### Task 3: Import scanner, facade checks, and SCC engine

**Files:**

- Create: `scripts/modularity/graph/tokenizer.ts:1`
- Create: `scripts/modularity/graph/imports.ts:1`
- Create: `scripts/modularity/graph/resolver.ts:1`
- Create: `scripts/modularity/graph/facades.ts:1`
- Create: `scripts/modularity/graph/cycles.ts:1`
- Create: `scripts/modularity/graph/index.ts:1`
- Test: `tests/unit/scripts/modularity/graph/tokenizer.test.ts:1`
- Test: `tests/unit/scripts/modularity/graph/imports.test.ts:1`
- Test: `tests/unit/scripts/modularity/graph/cycles.test.ts:1`
- Create: `tests/unit/scripts/modularity/graph/graph-fixture.ts:1`
- Create: `tests/unit/scripts/modularity/graph/index.ts:1`

**Interfaces:**

- Consumes: indexed TypeScript blobs and path scope.
- Produces: `ImportEdge { from, to, typeOnly, viaFacade }`, `scanImports(blob): readonly ImportReference[]`, `resolveImport(reference, paths): string`, `findMissingFacades(blobs: readonly IndexedBlob[]): Violation[]`, `findFacadeViolations(edges): Violation[]`, `stronglyConnectedComponents(edges): readonly (readonly string[])[]`.

- [ ] **Step 1: Write failing lexical and graph tests**

```ts
test("preserves type-only imports and ignores comments", () => {
  const refs = scanImports(
    blob(`
    // import { fake } from "../private.ts";
    import type { Grant } from "../agents/index.ts";
    export { value } from "./local.ts";
  `),
  );
  expect(refs).toEqual([
    { specifier: "../agents/index.ts", typeOnly: true, kind: "import" },
    { specifier: "./local.ts", typeOnly: false, kind: "export" },
  ]);
});

test("finds a multi-file cycle", () => {
  expect(
    stronglyConnectedComponents([edge("a.ts", "b.ts"), edge("b.ts", "a.ts"), edge("c.ts", "a.ts")]),
  ).toEqual([["a.ts", "b.ts"]]);
});

test.each(["olt/scripts", "scripts", "scripts/testing"])(
  "requires a facade for direct TypeScript in %s",
  (directory) => {
    const paths = findMissingFacades(indexedDirectory(directory, ["entry.ts"]));
    expect(paths.map((finding) => finding.path)).toContain(directory);
  },
);
```

- [ ] **Step 2: Run red graph tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/graph`
Expected: FAIL because graph modules are absent.

- [ ] **Step 3: Implement deterministic tokenizer and resolver**

Recognize static imports, side-effect imports, exports-from, and type-only modifiers while skipping line comments, block comments, quoted strings, regex literals, and template bodies. Resolve only repository-relative TypeScript candidates in this order: exact file, TypeScript extension, then directory `index.ts`. An unresolved relative import is an integrity error.

- [ ] **Step 4: Implement facade and Tarjan checks**

Within-directory edges pass. Cross-directory edges pass only when the target basename is `index.ts`. Reject `export *` separately. Sort nodes and adjacency before Tarjan traversal so reports are byte-stable.

- [ ] **Step 5: Run green and falsification tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/graph`
Expected: PASS; removing one edge from the two-file cycle makes the SCC finding disappear, proving gate falsifiability.

- [ ] **Step 6: Commit and push**

Run: `git add scripts/modularity/graph tests/unit/scripts/modularity/graph`
Run: `git commit -m "feat(modularity): enforce facades and acyclic imports"`
Run: `git push origin main`
Expected: push succeeds.

### Task 4: Baseline ratchet, report schema, and CLI

**Files:**

- Create: `scripts/modularity/policy/baseline.ts:1`
- Create: `scripts/modularity/policy/compare.ts:1`
- Create: `scripts/modularity/policy/generated.ts:1`
- Create: `scripts/modularity/policy/index.ts:1`
- Create: `scripts/modularity/baseline/index.json:1`
- Create: bounded rule/domain JSON shards under `scripts/modularity/baseline/lines/`, `fanout/`, `facades/`, and `graph/`
- Create: `scripts/modularity/reporting/json.ts:1`
- Create: `scripts/modularity/reporting/markdown.ts:1`
- Create: `scripts/modularity/reporting/index.ts:1`
- Create: `scripts/modularity/checker.ts:1`
- Create: `scripts/modularity/check.ts:1`
- Create: `scripts/modularity/index.ts:1`
- Test: `tests/unit/scripts/modularity/policy/compare.test.ts:1`
- Test: `tests/unit/scripts/modularity/policy/generated.test.ts:1`
- Test: `tests/unit/scripts/modularity/reporting/report.test.ts:1`
- Test: `tests/unit/scripts/modularity/checker.test.ts:1`

**Interfaces:**

- Consumes: core, inventory, and graph facades.
- Produces: `checkModularity(options: CheckOptions): Promise<CheckReport>`; CLI flags `--mode ratchet|strict --source index|tree --baseline <path> --format markdown|json`.

- [ ] **Step 1: Write failing ratchet tests**

```ts
test("rejects growth and accepts reduction", () => {
  expect(compareBaseline(base({ "a.ts": 450 }), current({ "a.ts": 451 })).passed).toBe(false);
  expect(compareBaseline(base({ "a.ts": 450 }), current({ "a.ts": 300 })).passed).toBe(true);
});
test("fails when a scan is partial", async () => {
  await expect(checkModularity(fixture({ catFileTruncates: true }))).rejects.toThrow("partial");
});
```

- [ ] **Step 2: Run red policy tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity/policy tests/unit/scripts/modularity/checker.test.ts`
Expected: FAIL because comparison and orchestration modules are absent.

- [ ] **Step 3: Implement baseline schema and comparison**

Use schema `olt-modularity-baseline/v1` with exact path/value findings and graph component membership. Generate bounded rule/domain shards from the authoritative inventory, reference them from `scripts/modularity/baseline/index.json`, and reject unknown keys, duplicate identities, negative counts, stale schema, missing shards, or baseline paths outside the repository.

- [ ] **Step 4: Implement generated catalog checks and reporting**

Verify every generated command JSON is referenced exactly once, every shard has an index, and every index target exists. Sort violations by rule/path/detail. JSON includes `schema: "olt-modularity-report/v1"`, commit/index identity, counts, and `passed`.

- [ ] **Step 5: Implement checker and thin CLI**

`checker.ts` composes scans; `check.ts` parses only the documented flags and sets `process.exitCode = 1` whenever `passed` is false or an integrity error occurs. `scripts/modularity/index.ts` uses explicit named exports.

- [ ] **Step 6: Run complete P01 tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity`
Expected: PASS.

Run: `bun scripts/modularity/check.ts --mode ratchet --source tree --baseline scripts/modularity/baseline/index.json --format json`
Expected: PASS against the unchanged inventory while reporting the complete baseline.

- [ ] **Step 7: Run the reviewer-authored falsifiable facade probe**

The command-free Terra/high reviewer specifies an isolated Git fixture containing direct `entry.ts`
files in `olt/scripts`, `scripts`, and `scripts/testing` with no indexes. The implementer executes the
probe and returns both reports:

```text
strict report before indexes: missing_facade = [olt/scripts, scripts, scripts/testing]
strict report after explicit named-export indexes: missing_facade = []
```

The reviewer rejects the task if either directory is absent from the failing report, if the passing
report retains a facade finding, or if replacing one named export with `export *` does not produce an
`export_star` failure. This counterfactual proves the entrypoint-directory rule is both enforced and
falsifiable without requiring the reviewer to execute commands.

- [ ] **Step 8: Independent review gate**

Terra/high reviewer checks standard-library imports, direct argv, fail-closed branches, index blob provenance, 300/301 and 10/11 boundaries, export-star rejection, type-only preservation, and Tarjan determinism. Any finding returns to the same implementer for one bounded repair cycle.

- [ ] **Step 9: Commit, push, and transfer baseline ownership**

Run: `git add scripts/modularity tests/unit/scripts/modularity`
Run: `git commit -m "feat(modularity): add staged architecture ratchet"`
Run: `git push origin main`
Expected: push succeeds.

After the pushed commit SHA and passing reviewer verdict are recorded, ownership of
`scripts/modularity/baseline/**` transfers atomically to P05. P01 may read those files for subsequent
ratchet tests but may not modify, regenerate, rename, or delete them.
