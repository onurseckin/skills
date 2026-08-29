# OLT Modularity Guardrail Design

**Status:** Approved for Round 26
**Date:** 2026-08-27
**Baseline:** `1e3b96c0ae297a1a037b5b5a11fa4447e76e4556`
**Inventory:** [2026-08-27-olt-modularity-inventory.md](../plans/2026-08-27-olt-modularity-inventory.md)

## Context

OLT has accumulated broad modules, crowded directories, direct cross-folder imports, incomplete facades, cyclic dependency clusters, and generated CLI catalogs that reproduce the same structural pressure. The current pre-commit hook typechecks, lints, and formats, but it has no modularity gate. A strict gate applied immediately would block every commit on hundreds of historical violations; a warning-only gate would permit continued growth and never converge.

Round 26 establishes one measurable architecture contract, captures the complete baseline, decomposes production and test code into feature slices, repairs generated CLI structure, and transitions from a migration ratchet to strict whole-tree enforcement.

## Decision

Adopt feature-slice modularity with five mechanical invariants:

1. A line-limited file contains at most 300 physical lines. Exactly 300 passes; 301 fails.
2. An in-scope directory contains at most 10 direct files, including its `index.ts`.
3. Every TypeScript production directory exposes an explicit named-export `index.ts`; new export-star declarations are forbidden.
4. Cross-directory imports use the destination directory facade. Direct imports within the same directory remain valid, and type-only imports/exports remain type-only.
5. The production import graph contains no non-trivial strongly connected component.

Generated CLI JSON and Markdown are first-party architecture. They are semantically sharded, line/fanout checked, and accompanied by generated catalog indexes.

## Why this design

### Selected: staged ratchet followed by strict enforcement

The migration gate compares staged Git-index blobs with the committed baseline. A commit passes only when it introduces no new violation, enlarges no existing violation, and does not worsen import or cycle metrics. Once the inventory reaches zero, pre-commit and CI switch to strict whole-tree mode.

This preserves normal incremental work while making the baseline monotonically smaller. Git-index reads make the verdict agree with what will be committed even when unrelated working-tree changes exist.

### Rejected: immediate strict gate

Immediate strict enforcement would block every Round 26 slice until all 406 oversized files and 45 fanout directories were repaired in one commit. That defeats domain isolation and makes review evidence inseparable.

### Rejected: warning-only lint

Warnings do not prevent a 300-line file from becoming 600 lines or a ten-file directory from gaining an eleventh file. They provide visibility without a convergence mechanism.

### Rejected: permanent baseline allowlist

A permanent allowlist converts architectural debt into policy. The baseline exists only as a migration ratchet and is deleted from the enforcement path when strict mode activates.

## Scope classification

### Included

- Tracked first-party TypeScript-family files: `.ts`, `.tsx`, `.mts`, and `.cts`.
- First-party JSON, JSONL, Markdown, YAML, and YML for fanout.
- First-party JSON for line limits.
- Generated CLI artifacts under `olt/references/cli-capabilities/**`, regardless of generic fixture treatment.
- TypeScript fixtures and test helpers.
- Files staged for addition, modification, rename, or deletion.

### Excluded

- `.olt/**`, `.git/**`, `node_modules/**`.
- `scratch/**`, `capsules/**`, and runtime output directories.
- `coverage/**`, cache directories, `dist/**`, `build/**`, and `out/**`.
- `vendor/**`, `vendored/**`, and `third_party/**`.
- Package-manager lockfiles.
- Markdown and YAML from line checks only; they still count toward fanout.
- Non-TypeScript fixture and snapshot payloads from line checks only; they still count toward fanout.

There are no TypeScript line exemptions. `olt/scripts/src/runtime/**` is production code, not runtime output.

## Root convention

The repository root is not treated as a compliant feature directory. It may contain only this fixed,
no-growth conventional exception set:

- `.capture.yaml`
- `.gitignore`
- `.oxfmtrc.json`
- `AGENTS.md`
- `LICENSE`
- `README.md`
- `bunfig.toml`
- `lefthook.yml`
- `package.json`
- `tsconfig.json`

`bun.lock` is excluded. The exception is no-growth: replacement or modification is allowed, but adding another root file fails.

## Feature slices and facades

A feature slice is a directory whose files implement one cohesive capability. Each production TypeScript directory has an `index.ts` that:

- Uses explicit named exports.
- Separates value exports from `export type`.
- Does not contain `export *`.
- Does not export test-only or internal implementation symbols.
- Remains at or below the same line and fanout limits.
- Is owned by exactly one migration task.

A cross-directory consumer imports the destination facade, such as `../contracts/index.ts` or `../contracts` according to the repository’s TypeScript resolution convention. A file in `contracts/` may import another file in `contracts/` directly. A cross-directory consumer may not address `../contracts/private-parser.ts`.

The rule includes executable entrypoint directories. Direct TypeScript files in `olt/scripts/`,
`scripts/`, and `scripts/testing/` require explicit facades; executable status is not a TypeScript
exception. The Round 26 missing-facade baseline is 23 directories.

Tests mirror production slices. Test `index.ts` files may export reusable fixtures, builders, and assertions, but never `*.test.ts` modules.

## Generated CLI architecture

The generator remains the only writer of `olt/references/cli-capabilities/**`. It emits:

- One command JSON artifact per command.
- Semantic subdirectories within a domain when a domain exceeds ten direct artifacts.
- A generated `index.json` in every command shard listing child command IDs and relative paths.
- Sharded domain Markdown when a rendered domain exceeds 300 physical lines.
- A generated domain catalog index linking every shard.
- A root manifest and index that reference every generated artifact exactly once.

Generation is deterministic: identical registry input produces byte-identical output and stable lexical ordering. Stale or orphaned generated files fail verification.

## Guard engine architecture

The guard lives under `scripts/modularity/` and uses only Bun/Node standard-library APIs plus direct Git subprocesses. It does not import repository production modules or third-party packages.

### Public interface

```ts
export type ModularityMode = "ratchet" | "strict";

export interface CheckOptions {
  readonly repoRoot: string;
  readonly mode: ModularityMode;
  readonly source: "index" | "tree";
  readonly baselinePath?: string;
}

export interface Violation {
  readonly rule:
    | "line_limit"
    | "directory_fanout"
    | "missing_facade"
    | "export_star"
    | "facade_bypass"
    | "dependency_cycle"
    | "root_no_growth"
    | "generated_catalog";
  readonly path: string;
  readonly observed: number | string;
  readonly limit?: number;
  readonly detail: string;
}

export interface CheckReport {
  readonly mode: ModularityMode;
  readonly source: "index" | "tree";
  readonly violations: readonly Violation[];
  readonly baselineDelta: {
    readonly added: readonly Violation[];
    readonly worsened: readonly Violation[];
    readonly resolved: readonly Violation[];
  };
  readonly passed: boolean;
}

export function checkModularity(options: CheckOptions): Promise<CheckReport>;
```

### Git-index reader

The staged gate obtains path metadata from `git diff --cached --name-status -z --diff-filter=ACMRD`, the complete tracked set from `git ls-files -z`, and bytes from `git cat-file --batch` using index object IDs. It never substitutes working-tree bytes when an index blob is absent or unreadable. Malformed Git output, unsupported status, missing blob, invalid UTF-8 where text is required, or subprocess failure terminates with a structured non-zero result.

### Physical lines

A non-empty blob’s physical line count is its newline count plus one when the final byte is not a newline. Empty files contain zero lines. This defines the 300-pass/301-fail boundary independent of platform line endings.

### Directory fanout

Fanout counts direct included files after exclusions. It does not recursively count descendants. `index.ts` and generated catalog indexes count like every other file.

### Import scanner and graph

The standard-library scanner tokenizes enough TypeScript syntax to ignore comments and string/template contents while recognizing static `import ... from`, side-effect imports, `export ... from`, and `import type`/`export type`. It resolves relative TypeScript file and directory-index candidates deterministically. Unresolvable relative imports fail closed.

Tarjan’s algorithm computes SCCs. A component of one file is a cycle only if it has a self-edge. Ratchet mode rejects a new component, a larger component, or a greater total number of cyclic files.

### Reporting

Human output is concise, sorted by rule then path, and includes remediation. JSON output is stable and schema-versioned for CI. A successful report contains the examined Git tree/index identity and exact counts; it never reports success after a partial scan.

## Ratchet semantics

During migration, `--mode ratchet --source index` compares the staged result with the committed baseline:

- A new violating file or directory fails.
- Increasing an existing file’s line count fails.
- Increasing existing directory fanout fails.
- Adding a facade bypass or export-star fails.
- Adding an SCC, increasing an SCC, or increasing cyclic-file count fails.
- Deleting, renaming, splitting, or reducing a violation passes.
- A rename is evaluated as deletion plus addition using final indexed paths.
- Baseline parse errors and stale baseline schema fail closed.

The baseline records exact paths and observed values, not broad glob exemptions.

Migration data is stored under `scripts/modularity/baseline/`. Its root `index.json` uses schema
`olt-modularity-baseline/v1` and references rule/domain shards; every shard obeys the same 300-line
and ten-file limits. The human inventory is evidence, not a machine-parsed configuration file.

## Strict semantics

Strict mode scans the complete Git tree and succeeds only when:

- No line-limit violation exists.
- No directory fanout violation exists.
- Every production TypeScript directory has a valid facade.
- No production facade uses export-star.
- No cross-directory facade bypass exists.
- No non-trivial dependency cycle exists.
- Generated catalogs are complete and deterministic.
- The root conventional set has not grown.

Strict mode is the only allowed pre-commit and CI mode after the migration completion commit.

## Enforcement lifecycle

1. Plan 01 lands the guard with ratchet-mode unit tests.
2. Plan 02 repairs CLI generation and the primary cycle seam.
3. Plans 03 and 04 migrate source and tests in bounded domain waves.
4. Plan 05 proves a zero-violation whole-tree report, removes ratchet use from hooks, and activates strict pre-commit plus CI.
5. Any later regression blocks locally and remotely.

`lefthook.yml` retains whole-tree typecheck. The modularity command is added as a separate deterministic gate.

## Testing strategy

Each implementation task follows red-green-refactor:

- Boundary tests prove 300 passes and 301 fails.
- Index-versus-working-tree tests stage bytes different from disk and assert the index wins.
- Exclusion tests distinguish `.olt/runtime` output from `olt/scripts/src/runtime` production.
- Fanout tests prove ten passes and eleven fails, including `index.ts`.
- Facade tests cover within-folder direct imports, cross-folder bypasses, named exports, export-star rejection, and type-only preservation.
- Cycle tests cover acyclic graphs, self-cycles, multi-file SCCs, and monotonic ratchet comparisons.
- Generated tests prove semantic sharding, indexes, determinism, and orphan rejection.
- Hook and CI tests prove partial scans cannot produce success.

Review is independent: SOL/high planners own decomposition and cross-wave reconciliation; Terra/high implementers own scoped edits and targeted tests; Terra/high reviewers inspect diffs and falsify gates without sharing implementation ownership.

## Migration invariants

- Round 26 contains modularity guardrail and decomposition work only.
- Every implementation wave has disjoint write scope.
- A facade has one named owner even when several consumers migrate to it.
- No task may expand an allowlist to make its test pass.
- Existing behavior remains characterized before moving code.
- Commits are conventional and pushed after their independent review gate.
- The final strict gate runs against the whole indexed tree in pre-commit and the whole checked-out tree in CI.

## Consequences

The migration is large but mechanically bounded. Files become locally comprehensible, imports describe domain boundaries, generated catalogs stop concentrating output, and future growth is prevented at commit time. The cost is temporary ratchet machinery and a deliberate sequence for cycle-breaking and facade ownership; both are preferable to an unreviewable repository-wide rewrite.
