# OLT Modularity Boundary Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the migration ratchet with mandatory strict whole-tree modularity checks in pre-commit and CI after the repository reaches zero violations.

**Architecture:** Package scripts expose strict index and tree scans, Lefthook scans the complete staged index, and CI scans the checked-out tree. Integration tests plant one violation per rule and prove every enforcement entry point exits non-zero.

**Tech Stack:** Bun, TypeScript 5.7, Lefthook, GitHub Actions, P01 modularity guard

**Spec:** `docs/superpowers/specs/2026-08-27-olt-modularity-guardrail-design.md`

## Global Constraints

- Strict activation requires an empty whole-tree report.
- Pre-commit scans the complete Git index, not only the changed-file list and not unstaged working-tree bytes.
- CI scans the complete checked-out tree.
- No baseline allowlist remains on an enforcement path after activation.
- Existing whole-tree typecheck and staged lint/format behavior remain intact.
- Any partial scan, malformed configuration, or missing guard command fails closed.
- P05 is the sole owner of `scripts/modularity/baseline/**` only after P01’s reviewed baseline-generation commit is pushed and the transfer is recorded; P05 must not touch it earlier.
- SOL/high reconciles the cutover; Terra/high implements and independently reviews.
- The reviewed cutover uses one Conventional Commit and pushes main.

---

### Task 1: Add failing enforcement integration tests

**Files:**

- Create: `tests/unit/architecture/modularity-enforcement.test.ts:1`
- Create: `tests/unit/architecture/modularity-enforcement-fixture.ts:1`
- Modify: `tests/unit/authority/root-hygiene-guard.test.ts:90-125`
- Read: `package.json:18-30`
- Read: `lefthook.yml:1-31`
- Read: `.github/workflows/ci.yml:1-200`

**Interfaces:**

- Consumes: `checkModularity` from `scripts/modularity/index.ts`.
- Produces: `createStrictFixture(rule: ViolationRule): StrictFixture` and assertions for package, hook, and CI wiring.

- [ ] **Step 1: Write one planted violation per rule**

```ts
for (const rule of [
  "line_limit",
  "directory_fanout",
  "missing_facade",
  "export_star",
  "facade_bypass",
  "dependency_cycle",
  "root_no_growth",
  "generated_catalog",
] as const) {
  test(`strict mode rejects ${rule}`, async () => {
    const fixture = createStrictFixture(rule);
    const result = await runStrictTree(fixture.repoRoot);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr + result.stdout).toContain(rule);
  });
}
```

- [ ] **Step 2: Write hook and CI contract tests**

Assert:

```ts
expect(packageScripts["modularity:staged"]).toBe(
  "bun scripts/modularity/check.ts --mode strict --source index",
);
expect(packageScripts["modularity:check"]).toBe(
  "bun scripts/modularity/check.ts --mode strict --source tree",
);
expect(lefthookCommand).toBe("bun run modularity:staged");
expect(ciCommands).toContain("bun run modularity:check");
```

- [ ] **Step 3: Run red tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/architecture/modularity-enforcement.test.ts tests/unit/authority/root-hygiene-guard.test.ts`
Expected: FAIL because package, hook, and CI strict commands are absent.

### Task 2: Prove migration completion before cutover

**Files:**

- Read: `docs/superpowers/plans/2026-08-27-olt-modularity-inventory.md`
- Read as sole post-transfer owner: migration baseline shards under `scripts/modularity/baseline/**`; deletion is reserved for Task 5 after reconciliation
- Read: complete Git index

**Interfaces:**

- Consumes: P01–P04 outputs.
- Produces: strict zero report and ratchet reconciliation showing every baseline finding resolved.

- [ ] **Step 1: Run strict tree scan**

Before this step, verify the recorded P01 commit SHA, reviewer pass, and ownership-transfer entry. If any
is absent, P05 has no write authority over the baseline and this task stops.

Run: `bun scripts/modularity/check.ts --mode strict --source tree --format json`
Expected: exit 0, `passed: true`, and `violations: []`.

- [ ] **Step 2: Run strict index scan**

Run: `bun scripts/modularity/check.ts --mode strict --source index --format json`
Expected: the same zero finding counts as tree mode.

- [ ] **Step 3: Reconcile inventory categories**

SOL/high verifies:

```text
oversized TypeScript: 406 -> 0
fanout directories: 52 -> 0 (45 TS + 5 generated CLI + 2 governance/reference)
missing source facades: 23 -> 0
facade bypasses: 1234 -> 0
SCCs / cyclic files: 12 / 93 -> 0 / 0
generated line/fanout/catalog findings: 9 -> 0
```

Any non-zero value blocks cutover; the baseline is not edited to fit the result.

### Task 3: Add package and pre-commit strict commands

**Files:**

- Modify: `package.json:18-30`
- Modify: `lefthook.yml:3-26`
- Test: `tests/unit/architecture/modularity-enforcement.test.ts:1`

**Interfaces:**

- Produces: `bun run modularity:staged` and `bun run modularity:check`.
- Consumes: P01 CLI with no baseline argument in strict mode.

- [ ] **Step 1: Add exact package scripts**

```json
{
  "modularity:staged": "bun scripts/modularity/check.ts --mode strict --source index",
  "modularity:check": "bun scripts/modularity/check.ts --mode strict --source tree"
}
```

Insert them in lexical order within the existing scripts object without changing dependency versions or the lockfile.

- [ ] **Step 2: Add a non-parallel pre-commit modularity stage**

Change Lefthook so strict modularity runs before the existing parallel typecheck/lint/format group, or use Lefthook’s ordered job support. The exact guard command is:

```yaml
modularity:
  run: bun run modularity:staged
```

It has no staged-file glob because it scans the complete index.

- [ ] **Step 3: Run green wiring tests**

Run: `bun scripts/testing/test-runner.ts tests/unit/architecture/modularity-enforcement.test.ts`
Expected: package and Lefthook assertions pass.

- [ ] **Step 4: Exercise index-versus-working-tree behavior**

Stage a 300-line fixture, leave 301 lines in the working tree, and run `bun run modularity:staged`.
Expected: PASS because staged bytes are compliant.

Stage the 301st line and rerun.
Expected: FAIL with `line_limit`.

Restore the fixture using normal patch cleanup before proceeding.

### Task 4: Add strict CI gate

**Files:**

- Modify: `.github/workflows/ci.yml:1-200`
- Modify: `tests/unit/architecture/modularity-enforcement.test.ts:1`

**Interfaces:**

- Produces: CI command `bun run modularity:check` after checkout/install and before broad tests.
- Consumes: full checked-out tree.

- [ ] **Step 1: Add the CI step**

```yaml
- name: Check modularity boundaries
  run: bun run modularity:check
```

Place it after dependency installation and before typecheck/tests so structural failures return quickly.

- [ ] **Step 2: Run CI contract test**

Run: `bun scripts/testing/test-runner.ts tests/unit/architecture/modularity-enforcement.test.ts`
Expected: PASS and confirm exactly one active strict CI command.

- [ ] **Step 3: Falsify CI locally**

Run the workflow command against a fixture branch containing an eleventh direct file.
Expected: non-zero exit naming `directory_fanout`.

### Task 5: Retire ratchet enforcement and verify fail-closed behavior

**Files:**

- Delete as sole post-transfer owner after reconciliation: migration baseline JSON shards under `scripts/modularity/baseline/**`.
- Read: `scripts/modularity/policy/baseline.ts`.
- Read: `tests/unit/scripts/modularity/policy/compare.test.ts`.
- Modify: `tests/unit/architecture/modularity-enforcement.test.ts`.

**Interfaces:**

- Strict commands accept no baseline.
- Explicit `--mode ratchet` without an existing baseline remains available only for historical test fixtures and fails when its baseline is missing; no hook or CI uses it.

- [ ] **Step 1: Prove no enforcement reference remains**

Run: `rg -n "mode ratchet|modularity/baseline" package.json lefthook.yml .github/workflows`
Expected: no matches.

- [ ] **Step 2: Delete reconciled baseline shards**

Remove only the migration baseline directory after the zero strict report has been recorded. Keep human inventory/design/plans as historical evidence.

- [ ] **Step 3: Test missing-baseline failure without editing P01 scope**

Run the P01 comparison test that invokes ratchet mode with a missing baseline.
Expected: non-zero integrity failure, never an empty synthetic baseline.

- [ ] **Step 4: Run final verification**

Run: `bun scripts/testing/test-runner.ts tests/unit/scripts/modularity tests/unit/architecture/modularity-enforcement.test.ts tests/unit/authority/root-hygiene-guard.test.ts`
Run: `bun run typecheck`
Run: `bun run test`
Run: `bun run format:check`
Run: `bun run modularity:check`
Expected: every command succeeds; modularity reports zero violations.

- [ ] **Step 5: Independent adversarial review**

Terra/high reviewer plants and removes each rule violation, confirms non-zero exits, confirms the index/tree distinction, verifies no hook bypasses strict mode, and checks that error handling cannot convert a partial scan into success.

- [ ] **Step 6: Commit and push**

Run: `git add package.json lefthook.yml .github/workflows/ci.yml tests/unit/architecture/modularity-enforcement.test.ts tests/unit/architecture/modularity-enforcement-fixture.ts tests/unit/authority/root-hygiene-guard.test.ts`
Run: `git add -A scripts/modularity/baseline`
Run: `git commit -m "ci(modularity): enforce strict feature boundaries"`
Run: `git push origin main`
Expected: push and remote strict CI succeed.
