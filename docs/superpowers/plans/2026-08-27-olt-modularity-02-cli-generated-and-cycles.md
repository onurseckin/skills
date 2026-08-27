# OLT CLI, Generated Catalog, and Cycle Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the CLI source and generated capability catalog under the modularity limits while removing the command-registry seam from the largest dependency cycle.

**Architecture:** Command handlers move into semantic feature slices, registries become data-oriented descriptors over stable contracts, formatters split by rendered concept, and the generator emits bounded semantic shards with generated indexes. One designated owner updates each shared facade after disjoint file splits land.

**Tech Stack:** Bun, TypeScript 5.7, existing CLI registry/rendering code, generated JSON/Markdown, P01 modularity guard

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- 300 physical lines maximum; 10 direct files maximum per directory.
- Explicit named-export facades; no export-star.
- Cross-directory imports use facades and preserve type-only semantics.
- Generated CLI artifacts are included and deterministic.
- P02 owns `olt/scripts/generate-cli-manifest.ts`, `olt/scripts/harness.ts`, `olt/scripts/index.ts`, `olt/scripts/src/cli/**`, `olt/references/cli-capabilities/**`, and only the seven exact test paths below.
- P02 may read and run every other CLI test but may not edit it. Test decomposition outside the seven-path temporary scope remains P04-owned.
- SOL/high owns cycle planning; Terra/high implements and independently reviews.
- Every reviewed subgroup uses a Conventional Commit and pushes main.

---

## Exact owned baseline

### Oversized CLI files

```text
path | physical_lines
olt/scripts/src/cli/commands/agent-ops.ts | 320
olt/scripts/src/cli/commands/critic-ops.ts | 374
olt/scripts/src/cli/commands/dag-view.ts | 1061
olt/scripts/src/cli/commands/dag.ts | 303
olt/scripts/src/cli/commands/defect-audit.ts | 954
olt/scripts/src/cli/commands/diagnostics-ops.ts | 324
olt/scripts/src/cli/commands/mind-admit.ts | 349
olt/scripts/src/cli/commands/mind-audit.ts | 472
olt/scripts/src/cli/commands/mind-pulse-open.ts | 318
olt/scripts/src/cli/commands/mind-pulse.ts | 955
olt/scripts/src/cli/commands/mind-round.ts | 365
olt/scripts/src/cli/commands/plan.ts | 438
olt/scripts/src/cli/commands/run-ops.ts | 584
olt/scripts/src/cli/commands/shell.ts | 382
olt/scripts/src/cli/commands/smart-task-ops.ts | 437
olt/scripts/src/cli/commands/task-brief.ts | 343
olt/scripts/src/cli/commands/task-check.ts | 857
olt/scripts/src/cli/commands/task-claim.ts | 438
olt/scripts/src/cli/commands/task-review-support.ts | 315
olt/scripts/src/cli/commands/task-review.ts | 452
olt/scripts/src/cli/commands/todo-ops.ts | 516
olt/scripts/src/cli/commands/watchdog-ops.ts | 478
olt/scripts/src/cli/execute.ts | 301
olt/scripts/src/cli/formatters/next-actions.ts | 1218
olt/scripts/src/cli/formatters/plan-formatter.ts | 419
olt/scripts/src/cli/formatters/task-formatter.ts | 311
olt/scripts/src/cli/registry/mind.ts | 725
olt/scripts/src/cli/registry/plan.ts | 506
olt/scripts/src/cli/registry/reporting.ts | 488
olt/scripts/src/cli/registry/task.ts | 418
```

### Owned fanout violations

```text
olt/scripts/src/cli/commands | 87
olt/scripts/src/cli/registry | 23
olt/scripts/src/cli | 13
olt/scripts/src/cli/formatters | 12
olt/references/cli-capabilities/commands/mind | 25
olt/references/cli-capabilities/domains | 18
olt/references/cli-capabilities/commands/reporting | 17
olt/references/cli-capabilities/commands/plan | 13
olt/references/cli-capabilities/commands/task | 13
```

### Facade ownership

- `olt/scripts/index.ts`: P02 entrypoint-directory facade owner; it exposes safe named generator APIs and does not import the executable `harness.ts` for side effects.
- `olt/scripts/src/cli/index.ts`: root CLI owner only.
- `olt/scripts/src/cli/commands/index.ts`: command catalog owner only.
- `olt/scripts/src/cli/registry/index.ts`: registry owner only.
- `olt/scripts/src/cli/formatters/index.ts`: formatter owner only.
- Every new command feature directory owns its own explicit `index.ts`.
- The generator exclusively owns every file under `olt/references/cli-capabilities/**`.

### Exact temporary test write scope

```text
tests/unit/cli/manifest.test.ts
tests/unit/cli/manifest-sharding.test.ts
tests/unit/cli/registry-boundaries.test.ts
tests/unit/cli/registry.test.ts
tests/unit/cli/plan-formatter.test.ts
tests/unit/cli/next-actions.test.ts
tests/unit/cli/execute-middleware.test.ts
```

No other test file may be modified by P02. After all P02 tasks pass independent review and the final
P02 commit is pushed, these seven paths transfer explicitly to P04 for physical splitting; P02 then
becomes read-only for them.

### Wave partition

- C1 registry: `registry/{mind,plan,reporting,task}.ts`.
- C2 formatters: `formatters/{next-actions,plan-formatter,task-formatter}.ts`.
- C3 command batch A: `commands/{agent-ops,critic-ops,dag-view,dag,defect-audit,diagnostics-ops,mind-admit,mind-audit,mind-pulse-open,mind-pulse}.ts`.
- C4 command batch B: `commands/{mind-round,plan,run-ops,shell,smart-task-ops,task-brief,task-check,task-claim,task-review-support,task-review}.ts`.
- C5 command batch C: `commands/{todo-ops,watchdog-ops}.ts` plus `cli/execute.ts`.
- C6 generator: manifest generator and all generated catalogs.

C1–C5 edit disjoint original paths and newly named feature directories. Shared facade edits occur only in the final facade task after all batches pass.

### Task 1: Characterize registry and generation behavior

**Files:**

- Modify: `tests/unit/cli/manifest.test.ts:1-175`
- Create: `tests/unit/cli/manifest-sharding.test.ts:1`
- Create: `tests/unit/cli/registry-boundaries.test.ts:1`
- Read: `olt/scripts/generate-cli-manifest.ts:1-43`
- Read: `olt/scripts/src/cli/registry/index.ts:1-220`

**Interfaces:**

- Consumes: current `findCommand`, `flagShapes`, `renderManifestMarkdown`, `renderDomainMarkdown`.
- Produces: behavioral characterization for command lookup, aliases, flag order, output path set, deterministic bytes, and stale-file removal.

- [ ] **Step 1: Add failing shard expectations**

```ts
test("large domains render bounded semantic shards with indexes", () => {
  writeManifest();
  expect(readCatalog("commands/mind/index.json").entries).toHaveLength(4);
  expect(maxGeneratedPhysicalLines()).toBeLessThanOrEqual(300);
  expect(maxGeneratedDirectoryFanout()).toBeLessThanOrEqual(10);
});
```

- [ ] **Step 2: Run the red tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli/manifest.test.ts tests/unit/cli/manifest-sharding.test.ts tests/unit/cli/registry-boundaries.test.ts`
Expected: FAIL because shard indexes do not exist and four domain Markdown files exceed 300 lines.

- [ ] **Step 3: Record compatibility assertions**

Assert all existing command names, aliases, flag shapes, summaries, and handler identities are unchanged. Assert generation twice yields identical path lists and bytes.

### Task 2: Split registries and formatters

**Files:**

- Modify: C1 and C2 files from the exact partition above.
- Create: semantic subdirectories beneath `olt/scripts/src/cli/registry/` and `olt/scripts/src/cli/formatters/`, each containing at most nine implementation files plus one `index.ts`.
- Modify: `olt/scripts/src/cli/registry/index.ts:1-220`
- Modify: `olt/scripts/src/cli/formatters/index.ts:1-80`
- Modify: `tests/unit/cli/registry.test.ts:1-398`
- Modify: `tests/unit/cli/plan-formatter.test.ts:1-374`
- Modify: `tests/unit/cli/next-actions.test.ts:1-667`

**Interfaces:**

- Consumes: existing `CommandSpec`, `FlagSpec`, formatter inputs.
- Produces: named registry arrays, `findCommand(name: string): CommandSpec | undefined`, `flagShapes(flags): Record<string, FlagShape>`, and unchanged formatter signatures.

- [ ] **Step 1: Split C1 into domain descriptors**

Move flag declarations and command specs into cohesive slices such as `mind/queue.ts`, `mind/lifecycle.ts`, `plan/authoring.ts`, and `task/review.ts`. Every slice remains below 300 lines and imports handlers only through the command facade.

- [ ] **Step 2: Split C2 by rendered concept**

Move next-action tables, plan sections, and task sections into separate directories. Preserve emitted Markdown byte-for-byte with snapshot assertions.

- [ ] **Step 3: Add explicit facades**

```ts
export { mindCommands } from "./mind/index.ts";
export { planCommands } from "./plan/index.ts";
export { reportingCommands } from "./reporting/index.ts";
export { taskCommands } from "./task/index.ts";
export type { CommandSpec, FlagSpec } from "./contracts.ts";
```

No facade may use `export *`.

- [ ] **Step 4: Run targeted green tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli/registry.test.ts tests/unit/cli/plan-formatter.test.ts tests/unit/cli/next-actions.test.ts`
Expected: PASS with byte-identical formatting and command lookup.

- [ ] **Step 5: Run ratchet and review**

Run: `bun scripts/modularity/check.ts --mode ratchet --source index --baseline scripts/modularity/baseline/index.json`
Expected: C1/C2 line and fanout findings decrease, with no new bypass or SCC.

- [ ] **Step 6: Commit and push**

Run: `git commit -m "refactor(cli): split registries and formatters"`
Run: `git push origin main`
Expected: push succeeds.

### Task 3: Split command handlers in three disjoint batches

**Files:**

- Modify: every C3, C4, and C5 path listed above.
- Create: one semantic feature directory per command family beneath `olt/scripts/src/cli/commands/`.
- Modify after all batches: `olt/scripts/src/cli/commands/index.ts:1-200`
- Modify after all batches: `olt/scripts/src/cli/index.ts:1-80`
- Modify: `tests/unit/cli/execute-middleware.test.ts:1-102`

**Interfaces:**

- Consumes: registry contracts and existing command handler signatures `(flags: Flags, context?: CommandContext, remainder?: readonly string[]) => JsonObject | Promise<JsonObject>`.
- Produces: the same public handler names and result shapes through explicit facades.

- [ ] **Step 1: Strengthen only the owned execute middleware characterization**

Add composition-root assertions to `tests/unit/cli/execute-middleware.test.ts` for handler identity,
authenticated context propagation, and invalid-state errors. Existing command-family tests remain
read-only execution evidence; this task may not add assertions to or split any other test module.

- [ ] **Step 2: Run each characterization test and observe green before movement**

Run the exact existing test file matching the command family without editing it.
Expected: PASS on unchanged code.

- [ ] **Step 3: Move one responsibility at a time**

For example, split `task-review.ts` into `task-review/start.ts`, `probe.ts`, `verdict.ts`, and `format.ts`; keep each file below 300 lines and the directory at ten files or fewer. Repeat for every exact C3–C5 path.

- [ ] **Step 4: Run family tests after each move**

Run the same characterization command.
Expected: PASS with unchanged JSON/Markdown and error codes.

- [ ] **Step 5: Have the single facade owner update indexes**

The facade owner explicitly exports only registry-consumed handlers and public types. No parallel worker edits either shared index.

- [ ] **Step 6: Run CLI aggregate checks**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli`
Expected: PASS.

Run: `bun scripts/modularity/check.ts --mode ratchet --source index --baseline scripts/modularity/baseline/index.json`
Expected: all 30 oversized CLI findings and all four CLI source fanout findings are resolved.

- [ ] **Step 7: Commit and push each batch**

Run commits in order:

```text
refactor(cli): split command handlers batch one
refactor(cli): split command handlers batch two
refactor(cli): split command handlers batch three
```

Push after each independent Terra/high review.

### Task 4: Break the CLI registry cycle seam

**Files:**

- Create or modify: `olt/scripts/src/cli/contracts/**`
- Modify: CLI files in the 57-file SCC only.
- Do not modify: non-CLI SCC members owned by P03.

**Interfaces:**

- Produces: dependency direction `contracts <- commands <- registry <- execute`.
- Consumes: no reporting, scheduler, health, mind, or orchestrator implementation from CLI contracts.

- [ ] **Step 1: Add a failing architecture assertion**

```ts
test("CLI contracts and registries are outside non-trivial SCCs", async () => {
  const report = await strictGraphReport(fixtureIndex());
  expect(report.components.filter((c) => c.some((p) => p.includes("/cli/")))).toEqual([]);
});
```

- [ ] **Step 2: Run red cycle test**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli/registry-boundaries.test.ts`
Expected: FAIL and name the current CLI-containing SCC.

- [ ] **Step 3: Invert dependencies**

Move shared types and pure flag helpers into `cli/contracts/`. Replace command-to-registry imports with contract or callback inputs. Keep registry modules as descriptor assembly and `execute.ts` as composition root.

- [ ] **Step 4: Run green cycle and CLI tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli/registry-boundaries.test.ts tests/unit/cli/registry.test.ts`
Expected: PASS; the CLI subtree is absent from non-trivial SCCs.

- [ ] **Step 5: Commit and push**

Run: `git commit -m "refactor(cli): invert command registry dependencies"`
Run: `git push origin main`
Expected: push succeeds.

### Task 5: Generate bounded semantic catalogs

**Files:**

- Modify: `olt/scripts/generate-cli-manifest.ts:1-43`
- Read: `olt/scripts/harness.ts:1-86`
- Create: `olt/scripts/index.ts:1`
- Modify generator implementation reached from that entry point.
- Replace generated paths under `olt/references/cli-capabilities/**`.
- Modify: `tests/unit/cli/manifest.test.ts:1-175`
- Modify: `tests/unit/cli/manifest-sharding.test.ts:1`

**Interfaces:**

- Produces: `writeManifest(): { markdown: string; splitFiles: string[] }` with deterministic bounded shards and indexes.
- Generated index schema: `{ schema: "olt-cli-catalog/v1", domain: string, entries: { id: string, path: string }[] }`.

- [ ] **Step 1: Implement semantic shard keys**

Partition mind, reporting, plan, and task commands by the registry’s semantic subgroup, not by arbitrary numeric chunks. A subgroup with more than ten files receives another semantic level.

- [ ] **Step 2: Emit and verify indexes**

Every generated command shard gets `index.json`; domains over 300 rendered lines get bounded Markdown shards plus a domain index. Root manifest and `index.jsonl` reference each leaf exactly once.

- [ ] **Step 3: Remove stale generated files safely**

Compute the expected relative path set, compare it to tracked generated paths, and unlink only unexpected files physically confined below the canonical generated root.

- [ ] **Step 4: Run generation twice**

Run: `bun olt/scripts/generate-cli-manifest.ts`
Run: `bun olt/scripts/generate-cli-manifest.ts`
Expected: second run produces no Git diff.

- [ ] **Step 5: Run generated and ratchet tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/cli/manifest.test.ts tests/unit/cli/manifest-sharding.test.ts tests/unit/capture/cli-commands.test.ts`
Expected: PASS.

Run: `bun scripts/modularity/check.ts --mode ratchet --source index --baseline scripts/modularity/baseline/index.json`
Expected: zero generated line/fanout/catalog findings.

- [ ] **Step 6: Prove the `olt/scripts` facade**

Run the strict facade probe against direct `generate-cli-manifest.ts` and `harness.ts` plus the new
`index.ts`. Expected: `olt/scripts` is absent from `missing_facade`; the facade uses named exports and
does not execute `harness.ts` when imported.

- [ ] **Step 7: Independent review, commit, push, and test-scope transfer**

Terra/high reviewer verifies semantic grouping, path confinement, deterministic order, complete indexes, and absence of orphan output.

Run: `git commit -m "refactor(cli): shard generated capability catalogs"`
Run: `git push origin main`
Expected: push succeeds.

After the reviewer verdict and pushed SHA are recorded, transfer the seven exact temporary test paths
to P04. P02 may subsequently read them but may not edit or split them.
