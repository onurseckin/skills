# 01. Mandatory Gate Systems & Falsifiable Gate Proofs

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)

---

## 🧭 Diátaxis Overview

| Quadrant         | Purpose in this Chapter                                                                                                                                               |
| :--------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Explanation**  | Understand the Mandatory Gate Hierarchy, why green gates can be deceptive, the mathematics of falsifiability proofs (`gate:prove`), and repository snapshot bindings. |
| **How-To Guide** | Declaring task and run gates, executing gates under isolation, proving gate falsifiability, and resolving `plan:audit` gate invariant warnings.                       |
| **Reference**    | Gate JSON schemas, CLI command syntax, direct argv grammar rules, and gate execution event payloads.                                                                  |
| **Tutorial**     | Step-by-step walkthrough of authoring a scoped gate, running `gate:prove` in scratch isolation, and validating receipts.                                              |

---

## 🏛️ 1. Explanation: The Mandatory Gate Hierarchy

In `olt`, verification contracts are not informal guidelines—they are **Mandatory Gates** enforced mechanically by the harness runner. Gates exist in a strict two-tier hierarchy:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                         MANDATORY GATE HIERARCHY                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  TIER 1: TASK-SCOPED GATES (`scope: "task"`)                                │
│  ├── Declared by: `plan:add --gate` (or planner graph authoring)            │
│  ├── Bound to: Specific task ID and requirement ID                          │
│  ├── Target: Focused unit tests, scoped typechecks, AST validation          │
│  ├── Evaluated by: Independent Validator (`run:exec --actor <val>`)         │
│  └── Enforcement: Blocks `task:review --status pass` if failing             │
│                                                                             │
│                                     │                                       │
│                                     ▼                                       │
│  TIER 2: RUN-SCOPED COMPLETION GATES (`scope: "run"`)                       │
│  ├── Declared by: `plan:compile --completion-gate` (MANDATORY, NO DEFAULT)  │
│  ├── Bound to: Entire run / whole capsule (`gate-run-completion`)           │
│  ├── Target: Full test suites, end-to-end integration, linter sweeps        │
│  ├── Evaluated by: Completeness Critic (`run:exec --actor <critic>`)        │
│  └── Enforcement: Blocks `run:complete` if failing or unproven              │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Gate Object Schema

```json
{
  "id": "gate-slug",
  "scope": "task",
  "command": ["bun", "test", "tests/unit/slug.test.ts"],
  "cwd": ".",
  "mandatory": true,
  "requirement_ids": ["req-slug"]
}
```

- **Task Gates (`gate-<task-id>`)**: Ensure the localized write scope satisfies its specific behavioral contract.
- **Run Gates (`gate-run-completion`)**: Ensure system-wide integration integrity across all merged task scopes.

---

## 🔬 2. Explanation: Falsifiable Gate Proofs (`gate:prove`)

### The Deceptive Green Gate Anti-Pattern

A test suite that exits `0` does **not** prove that the task's implementation is correct. Consider these common failure modes:

1. **Unscoped Whole-Suite Gates**: Ten disjoint-scope tasks share `bun test`. If any single task does nothing, the suite still passes on existing tests.
2. **Vacuous / Mocked Tests**: The test asserts `expect(true).toBe(true)` or matches hardcoded mock outputs.
3. **Missing Assertions**: The test runs code paths but makes no assertions on side effects or return values.

> **A gate command that cannot fail in the absence of the task's work is not a verification gate; it is decorative theater.**

`gate:prove` tests the gate's discriminatory power by asking one mechanical question:

$$\text{Does this gate exit nonzero when this task's write scope is reverted to base?}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                    GATE:PROVE SCRATCH ISOLATION ENGINE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. CLONE ISOLATION TREE                                                    │
│     Copy all tracked/unignored repository files into a temporary scratch    │
│     directory (`mkdtempSync` outside workspace). Workspace is untouched.    │
│                                   │                                         │
│                                   ▼                                         │
│  2. REVERT TASK WRITE SCOPE                                                 │
│     Inside the scratch copy ONLY: revert files in task's `write_scope`      │
│     to `--base` (default `HEAD`). Files created by task are deleted;        │
│     modified files are restored to their base commit contents.              │
│                                   │                                         │
│                                   ▼                                         │
│  3. EXECUTE COMPILED GATE IN SCRATCH TREE                                   │
│     Execute `gate.command` inside the scratch directory.                    │
│                                   │                                         │
│                                   ▼                                         │
│  4. EVALUATE FALSIFIABILITY & CLEANUP                                       │
│     • Exit code != 0 ──► PROVEN FALSIFIABLE ✅ (Gate catches missing work)  │
│     • Exit code == 0 ──► NOT FALSIFIABLE ❌ (Gate passes on empty work)     │
│     • `rmSync` scratch directory unconditionally. Real repo never modified. │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration with `plan:audit` Invariants

`plan:audit` validates compiled graphs against recorded falsifiability proofs before dispatching workers:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     PLAN:AUDIT GATE INVARIANT CHECKS                        │
├───────────────────────┬─────────────────────────────────────────────────────┤
│ Invariant ID          │ Rule Enforced                                       │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ `A3-gate-discrimination` │ Two disjoint-scope tasks sharing identical gate     │
│                       │ argv are REFUSED unless BOTH tasks have recorded a  │
│                       │ falsifiable proof over their respective scopes.     │
├───────────────────────┼─────────────────────────────────────────────────────┤
│ `A6-whole-suite-gate` │ A task gate that matches a broad suite pattern      │
│                       │ (`bun test`, `npm test`) is REFUSED unless backed   │
│                       │ by an explicit falsifiable proof.                   │
└───────────────────────┴─────────────────────────────────────────────────────┘
```

---

## 📜 3. Reference: Direct Argv Grammar & Security Seams

To prevent shell injection, escaping bugs, and terminal environment leaks:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                        DIRECT ARGV GRAMMAR RULES                            │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ✅ PERMITTED (Literal Bare String Arrays):                                 │
│     ["bun", "test", "tests/unit/slug.test.ts"]                              │
│     ["cargo", "test", "--package", "auth", "--", "test_token"]              │
│     ["pytest", "tests/test_api.py", "-k", "test_auth"]                      │
│                                                                             │
│  ❌ FORBIDDEN & REFUSED:                                                    │
│     ["sh", "-c", "bun test tests/unit/*.test.ts"]  (Shell Wrapper)         │
│     "bun test tests/unit/slug.test.ts"             (Unsplit Bare String)    │
│     ["bash", "-e", "scripts/test.sh"]              (Script Indirection)     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Git Security Seams

Whenever the harness or gate runner invokes Git commands, it injects strict isolation headers into the child process environment:

- `GIT_NO_REPLACE_OBJECTS=1` (Prevents object spoofing)
- `--no-ext-diff` (Disables external diff drivers)
- `GIT_CONFIG_NOSYSTEM=1` (Ignores system-wide config overrides)
- `GIT_CONFIG_GLOBAL=/dev/null` (Ignores user global configs)

---

## 🛡️ 4. Explanation: Live Repository Binding (`trusted_host_observed_v1`)

To prevent the **"green on dirty tree, red on clean commit"** race condition, every gate execution captures cryptographic snapshots before and after command execution:

$$\text{repository\_binding} = \{\text{content\_sha256}, \text{git\_identity\_sha256}, \text{file\_count}, \text{total\_bytes}\}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     LIVE REPOSITORY BINDING TIMELINE                        │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Pre-Command Snapshot ]                                                   │
│    • content_sha256: "e3b0c44298fc1c149afbf4c8996fb924..."                 │
│    • git_identity_sha256: "9f83377b895f26385f361e59..."                   │
│                                  │                                          │
│                                  ▼ (Execute Gate via run:exec)              │
│  [ Gate Command Runs: `bun test tests/slug.test.ts` ]                        │
│                                  │                                          │
│                                  ▼                                          │
│  [ Post-Command Snapshot ]                                                  │
│    • content_sha256: "4a2b918f8e918c..."                                    │
│    • git_identity_sha256: "9f83377b895f26385f361e59..."                   │
│                                                                             │
│                                  │                                          │
│                                  ▼ (Verified during run:complete)           │
│  [ Completion Engine Verifies: Live Repo SHA === Gate Post-Command SHA ]    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

If any files are modified after a gate was executed, the gate receipt becomes **stale** and completion will refuse to seal until the gate is re-executed on the live tree.

---

## 🚦 5. Reference: `run:exec` Execution Semantics

`run:exec` is the sole authorized gateway for executing commands and recording receipts in `events.jsonl`:

```bash
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor <agent-id> \
  --task <task-id> \
  --gate <gate-id> \
  -- bun test tests/unit/slug.test.ts
```

### Semantics:

- **Harness Exit Code**: `run:exec` itself exits `0` whenever the child process launched and completed, regardless of whether the child passed or failed.
- **Child Status Recording**: The child's exit code, duration, stdout, stderr, and repository bindings are recorded into `.capsules/<run-id>/evidence/C-<uuid>.json`.
- **Argv Splitting**: All flags after `--` are forwarded verbatim to the child process. Harness flags (`--format json`, `--actor`) must appear before `--`.

---

## 📖 6. How-To Guide: Working with Gates

### Proving Gate Falsifiability

```bash
bun harness.ts gate:prove \
  --run .capsules/<run-id> \
  --task task-slug \
  --actor coordinator
```

Expected Output:

```text
### Gate Proof: `task-slug`
**PROVEN FALSIFIABLE**: exits 1 once `task-slug`'s write scope is reverted to `HEAD`.
- **Gate**: `bun test tests/unit/slug.test.ts`
- **Write Scope**: src/slug.ts
- **Reverted in Scratch**: 1 restored, 0 removed, of 184 files copied
- **Duration**: 612ms
- **Evidence Stored**: state.gate_proofs["task-slug"]
```

### Executing a Task Gate as a Validator

```bash
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor val-1 \
  --task task-slug \
  --gate gate-slug \
  -- bun test tests/unit/slug.test.ts
```

### Executing the Run Completion Gate as a Critic

```bash
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --actor critic-1 \
  --gate gate-run-completion \
  -- bun test tests/
```

### Overriding a Static Plan Audit Warning

If two tasks legitimately share a regression test fixture:

```bash
bun harness.ts plan:compile \
  --run .capsules/<run-id> \
  --actor planner \
  --completion-gate "bun test" \
  --accept-audit "A3-gate-discrimination:task-a and task-b share common integration fixture"
```

---

## 💻 7. Tutorial: Authoring and Falsifying a Scoped Task Gate

### Step 1: Implement Feature and Author Scoped Test

Write scope: `src/format/date.ts`.
Test file: `tests/format/date.test.ts`.

### Step 2: Declare Task with Scoped Gate in Plan

```bash
bun harness.ts plan:add \
  --run .capsules/run-50 \
  --id task-date-format \
  --title "Implement ISO date formatting helper" \
  --write-scope "src/format/date.ts,tests/format/date.test.ts" \
  --gate "bun test tests/format/date.test.ts"
```

### Step 3: Verify Falsifiability Before Validation

```bash
bun harness.ts gate:prove \
  --run .capsules/run-50 \
  --task task-date-format \
  --actor coordinator
```

Verification Result:

- Scratch isolation directory created.
- `src/format/date.ts` reverted to base state (empty/deleted).
- `bun test tests/format/date.test.ts` executed in scratch.
- Gate exited with code `1` (`Cannot find module 'src/format/date.ts'`).
- `gate-proved` event recorded with `falsifiable: true`.

The gate is confirmed discriminatory and safe for validator enforcement.

---

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)
