# OLT Modularity Round 26 Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce every inventoried modularity violation to zero and activate a fail-closed whole-tree guard without mixing unrelated OLT healing work into Round 26.

**Architecture:** Five ordered workstreams build the standard-library guard, repair CLI generation and cycle seams, decompose production source, decompose tests, and activate strict enforcement. Migration uses a Git-index ratchet until the strict report is empty; explicit facade ownership prevents parallel barrel conflicts.

**Tech Stack:** Bun, TypeScript 5.7, Node/Bun standard library, Git plumbing, Lefthook, existing repository test runner

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- Maximum file size is 300 physical lines: 300 passes and 301 fails.
- Maximum direct in-scope files per directory is 10, including `index.ts`.
- Every production TypeScript directory has an explicit named-export `index.ts`; no new `export *`.
- Cross-directory imports use facades; within-directory direct imports remain valid; type-only imports remain type-only.
- Tests mirror feature slices; test indexes export helpers only and never test modules.
- Generated CLI JSON and Markdown are included, semantically sharded, and have generated catalog indexes.
- Exclude `.olt/**`, `.git/**`, `node_modules/**`, `scratch/**`, `capsules/**`, runtime output, coverage/cache/dist/build/out, vendored/third-party trees, and lockfiles.
- `olt/scripts/src/runtime/**` and `tests/unit/runtime/**` are first-party code and are included.
- Markdown/YAML are line-exempt but fanout-counted; TypeScript fixtures are never exempt.
- The root conventional-file set is fixed and may not grow.
- Guard code under `scripts/modularity/**` uses only standard-library APIs and Git subprocesses.
- Ratchet mode reads staged index blobs; strict mode scans the whole tree; both fail closed.
- Round 26 contains modularity work only.
- SOL/high agents plan and reconcile waves; Terra/high implementers and independent Terra/high reviewers execute and validate them.
- Every reviewed subgroup ends with a Conventional Commit and `git push origin main`.

---

## Requirement-to-plan map

| Requirement                                                                   | Owning plan     | Completion evidence                                                                 |
| ----------------------------------------------------------------------------- | --------------- | ----------------------------------------------------------------------------------- |
| Git-index inventory and 300-line rule                                         | Plan 01         | Boundary and staged-blob tests                                                      |
| Ten-file fanout and root no-growth                                            | Plan 01         | 10/11 boundary tests                                                                |
| Scope/exclusion classification                                                | Plan 01         | production-runtime versus output-runtime tests                                      |
| Generated CLI sharding/indexes                                                | Plan 02         | deterministic generation and orphan checks                                          |
| Import facade rule and type-only preservation                                 | Plans 01–03     | scanner tests plus zero bypass report                                               |
| Twelve SCCs / 93 cyclic files                                                 | Plans 02–03     | zero-cycle graph report                                                             |
| 178 oversized `olt/**` files                                                  | Plans 02–03     | inventory ownership tables and zero line report                                     |
| Two oversized root reporting scripts                                          | Plan 03         | root-tooling wave                                                                   |
| 226 oversized tests                                                           | Plan 04         | test-domain ownership tables and zero line report                                   |
| Fifty-two fanout directories (45 TS, 5 generated CLI, 2 governance/reference) | Plans 02–04     | directory ownership tables and zero fanout report                                   |
| Twenty-three missing production indexes                                       | Plans 02–03     | explicit facade creation, including `olt/scripts`, `scripts`, and `scripts/testing` |
| Staged ratchet                                                                | Plans 01 and 05 | index-different-from-worktree integration test                                      |
| Strict pre-commit and CI                                                      | Plan 05         | strict hook/CI tests and zero report                                                |
| No export-star / cross-folder direct imports                                  | Plans 02–05     | strict boundary audit                                                               |

## Exact dependency DAG

```text
P01 guard-engine
  └── P02 cli-generated-and-cycles
        ├── P03 source-decomposition
        │     └── P04 test-decomposition
        └──────────────────────────┘
                      └── P05 boundary-enforcement
```

Edges are mandatory:

- P01 → P02: generation work consumes the guard’s report schema and path rules.
- P02 → P03: CLI facade ownership and the largest SCC must stabilize before other source imports move.
- P03 → P04: mirrored test slices target final production facades.
- P02, P03, P04 → P05: strict mode activates only after generated, source, and test inventories reach zero.

## Ownership matrix

| Plan | Exclusive write scope                                                                                                                                                                                                                                                                                         |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P01  | Through its reviewed commit: `scripts/modularity/**`, `tests/unit/scripts/modularity/**`; after transfer: `scripts/modularity/**` except `scripts/modularity/baseline/**`, plus its tests                                                                                                                     |
| P02  | `olt/scripts/generate-cli-manifest.ts`; `olt/scripts/harness.ts`; `olt/scripts/index.ts`; `olt/scripts/src/cli/**`; `olt/references/cli-capabilities/**`; and the exact seven-test set below                                                                                                                  |
| P03  | Non-CLI `olt/scripts/src/**`, `scripts/{index,sync-global,validate-agent-manifests,verify-gen5}.ts`, `scripts/testing/{index,test-changed,test-mutex,test-runner}.ts`, `scripts/testing/reporting/html/{styles,client-script}.ts`, `olt/agents/**`, direct `olt/references/*`, production facades outside CLI |
| P04  | `tests/**` except P01 guard tests, P05’s exact integration tests, and the exact P02 test set until its explicit post-P02 transfer                                                                                                                                                                             |
| P05  | `scripts/modularity/baseline/**` after transfer; `package.json`; `lefthook.yml`; `.github/workflows/**`; `tests/unit/architecture/modularity-enforcement.test.ts`; `tests/unit/architecture/modularity-enforcement-fixture.ts`; `tests/unit/authority/root-hygiene-guard.test.ts`                             |

P02’s exact temporary test write scope is:

```text
tests/unit/cli/manifest.test.ts
tests/unit/cli/manifest-sharding.test.ts
tests/unit/cli/registry-boundaries.test.ts
tests/unit/cli/registry.test.ts
tests/unit/cli/plan-formatter.test.ts
tests/unit/cli/next-actions.test.ts
tests/unit/cli/execute-middleware.test.ts
```

P04 treats those seven paths as read-only until P02’s implementation, independent review, commit, and
push are complete. The master then records an explicit ownership transfer: P04 becomes the sole owner
for later physical splitting, and P02 becomes read-only. No concurrent ownership exists.

A later plan may update imports in its own files to consume an earlier facade, but it may not edit the earlier plan’s facade. Facade owners review requested export additions and land them before dependent waves.

### Task 1: Freeze the baseline

**Files:**

- Read: `docs/superpowers/plans/2026-08-27-olt-modularity-inventory.md`
- Read: `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`
- Verify: Git index at `1e3b96c0ae297a1a037b5b5a11fa4447e76e4556`

**Interfaces:**

- Consumes: immutable inventory counts and scope rules.
- Produces: signed planning acknowledgement containing `1844/406/52/23/1234/12/93`, with fanout decomposed as `45 TS + 5 generated CLI + 2 governance/reference`.

- [ ] **Step 1: Verify repository identity**

Run: `git rev-parse HEAD` and `git status --short --branch`
Expected: the planned starting commit or an explicitly reconciled descendant; no unexplained changes.

- [ ] **Step 2: Reproduce inventory summary with the P01 scanner**

Run: `bun scripts/modularity/check.ts --mode ratchet --source tree --baseline scripts/modularity/baseline/index.json --format json`
Expected before decomposition: PASS as an unchanged baseline with 406 line, 52 fanout, 23 missing-facade, 1,234 bypass, and 12 SCC findings.

- [ ] **Step 3: Reject unexplained drift**

Compare the JSON report to the inventory. Any additional or worsened finding stops dispatch and returns to SOL/high reconciliation; no baseline widening is allowed.

### Task 2: Execute P01 and P02

**Files:**

- Follow: `docs/superpowers/plans/2026-08-27-olt-modularity-01-guard-engine.md`
- Follow: `docs/superpowers/plans/2026-08-27-olt-modularity-02-cli-generated-and-cycles.md`

**Interfaces:**

- Consumes: approved spec and inventory.
- Produces: ratchet engine, stable schema, generated sharding, CLI facades, and reduced SCC baseline.

- [ ] **Step 1: Dispatch P01 tasks**

Use SOL/high for exact-scope planning, Terra/high for implementation, and a fresh Terra/high reviewer per task.

- [ ] **Step 2: Gate P01**

Run implementer-owned targeted tests from P01 and `bun run typecheck`.
Expected: all targeted tests pass and the baseline itself passes ratchet mode.

- [ ] **Step 3: Commit and push P01**

Run: `git commit -m "feat(modularity): add staged architecture ratchet"`
Run: `git push origin main`
Expected: both commands succeed.

Record the P01 reviewer pass and pushed SHA, then transfer sole ownership of
`scripts/modularity/baseline/**` to P05. P01 and P02–P04 may read the baseline afterward but may not
modify, regenerate, rename, or delete it.

- [ ] **Step 4: Dispatch and gate P02**

Execute every P02 task in DAG order.
Expected: generated output is deterministic, CLI-owned line/fanout findings are zero, and SCC metrics do not worsen.

- [ ] **Step 5: Commit and push P02**

Run: `git commit -m "refactor(cli): shard generated capabilities and break cycles"`
Run: `git push origin main`
Expected: both commands succeed.

Record the P02 reviewer pass and pushed SHA, then transfer the seven exact temporary CLI test paths
listed above to P04. P02 becomes read-only for those paths; P04 may now perform their physical split.

### Task 3: Execute production and test decomposition

**Files:**

- Follow: `docs/superpowers/plans/2026-08-27-olt-modularity-03-source-decomposition.md`
- Follow: `docs/superpowers/plans/2026-08-27-olt-modularity-04-test-decomposition.md`

**Interfaces:**

- Consumes: stable guard and CLI facades.
- Produces: zero production and test line/fanout violations with mirrored slices.

- [ ] **Step 1: Run source domain waves**

Dispatch only disjoint P03 waves in parallel. Serialize waves sharing a facade owner.

- [ ] **Step 2: Review, commit, and push each source subgroup**

Use the exact conventional commits specified by P03.
Expected: every subgroup reduces at least one baseline finding and introduces none.

- [ ] **Step 3: Run test domain waves**

Dispatch P04 only after the corresponding production facade is final.

- [ ] **Step 4: Review, commit, and push each test subgroup**

Use the exact conventional commits specified by P04.
Expected: behavior remains characterized and test indexes expose helpers only.

### Task 4: Activate strict enforcement

**Files:**

- Follow: `docs/superpowers/plans/2026-08-27-olt-modularity-05-boundary-enforcement.md`

**Interfaces:**

- Consumes: zero-violation repository and stable guard.
- Produces: strict pre-commit/CI enforcement with no migration escape hatch.

- [ ] **Step 1: Prove zero whole-tree findings**

Run: `bun scripts/modularity/check.ts --mode strict --source tree --format json`
Expected: PASS with an empty `violations` array.

- [ ] **Step 2: Activate hooks and CI**

Execute P05 red/green steps.
Expected: 301-line, eleventh-file, facade-bypass, export-star, and cycle fixtures all fail.

- [ ] **Step 3: Run final gates**

Run: `bun run typecheck`
Run: `bun run test`
Run: `bun run format:check`
Run: `bun scripts/modularity/check.ts --mode strict --source tree`
Expected: all commands succeed and strict report is empty.

- [ ] **Step 4: Commit and push enforcement**

Run: `git commit -m "ci(modularity): enforce strict feature boundaries"`
Run: `git push origin main`
Expected: both commands succeed and remote CI repeats the strict result.
