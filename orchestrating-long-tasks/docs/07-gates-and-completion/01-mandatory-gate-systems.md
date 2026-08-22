# 01. Mandatory Gate Systems & Verification Contracts

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)

---

## 🏛️ Why Gates are Non-Negotiable

Even if an independent validator marks a task as `pass`, human developers need objective, automated assurance that compiler, linter, and integration test suites passed cleanly.

In `orchestrating-long-tasks`, verification contracts are represented as **Mandatory Gates**:

```json
{
  "id": "gate-slug",
  "scope": "task",
  "command": ["bun", "test", "tests/slug.test.ts"],
  "cwd": ".",
  "mandatory": true,
  "requirement_ids": ["req-slug"]
}
```

Gate ids are derived from the task that declared them: `task-slug` yields `gate-slug`. The run-scope
gate declared by `plan:compile --completion-gate` is always `gate-run-completion`. Every gate is
executed through the watchdog runner and recorded as `trusted_host_observed_v1`.

---

## 🔒 Scope: Task Gates vs. Run Gates

The harness supports two distinct gate scopes:

### 1. Task Gates (`scope: "task"`)

- Declared by `plan:add --gate`, bound to that task's derived requirement.
- Rerun by the **validator itself** during validation via `run:exec --actor <validator>`.
- `task:review --status pass` is **refused** while a mandatory gate's recorded run exited nonzero:
  a red gate blocks sign-off mechanically, not by convention.
- `--checks` on a verdict must cover every mandatory gate, and each cited command must be the
  validator's own successful run bound to this task.

### 2. Run Gates (`scope: "run"`)

- Declared by `plan:compile --completion-gate`, which is **mandatory and has no default**. The
  compiler refuses to invent the command the whole run is finally held to.
- The declaration is checked for substance. A gate that verifies nothing is rejected at compile time:
  ```text
  {"ok":false,"error":{"code":"INTEGRITY","message":"compiled graph failed validation: gates[2].command must perform substantive verification"}}
  ```
- Evaluated before completeness review:
  ```bash
  bun harness.ts run:exec --run .capsules/<slug> --gate gate-run-completion --actor coordinator -- bun test tests/unit
  ```
- The completeness critic must run it **again under its own actor**, unbound to any task; a
  task-bound command or another agent's run is not critic evidence.
- Must succeed with exit code 0 before `run:complete` will seal the capsule.

---

## 📜 Direct Argv Grammar Rules

To prevent command injection, shell escaping vulnerabilities, and unpredictable terminal environments:

- **No Shell Wrappers:** Gate commands MUST be expressed as literal bare executable string arrays:
  - ✅ `["bun", "test", "tests/unit/cache.test.ts"]`
  - ✅ `["cargo", "test", "--package", "auth"]`
  - ❌ `["sh", "-c", "bun test tests/unit/*.test.ts"]` _(Rejected)_
  - ❌ `"bun test tests/unit/cache.test.ts"` _(Rejected)_
- **Git Security Seams:** When running Git commands, the harness injects strict isolation headers (`GIT_NO_REPLACE_OBJECTS=1`, `--no-ext-diff`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`).
- **Everything After `--` Belongs to the Child:** `run:exec` forwards the remainder verbatim. Harness
  flags such as `--format json` must therefore appear **before** the `--`, or they are consumed by the
  command being measured.

---

## 🛡️ Live Repository Binding (`trusted_host_observed_v1`)

To eliminate the "pass on dirty tree, commit on broken tree" race condition, every gate execution captures cryptographic snapshots before and after command execution:

$$\text{repository\_binding} = \{\text{content\_sha256}, \text{git\_identity\_sha256}, \text{file\_count}, \text{total\_bytes}\}$$

During final completion, the harness verifies that the current live repository matches the post-command repository binding of the gate receipts. If any files were modified after the gate ran, the gate is marked stale and must be re-executed.

---

## 🚦 `run:exec` Exit Semantics

`run:exec` exits **0 whenever the child ran at all**, and reports the child's own status in
`exit_code`. A failing gate is a recorded fact, not a CLI error:

```text
### Command Executed: `bun test tests/slug.test.ts`
- **Exit Code**: `1` (Failure) | **Duration**: 0.72s
- **Output Summary**: Command returned non-zero exit code
- **Evidence Recorded**: `.capsules/slugger/evidence/C-237045e3-….json`
```

The enforcement lives one step later, where it belongs: `task:review --status pass` refuses while a
required gate's recorded exit code is nonzero, and completion refuses while any mandatory gate is
unsatisfied. Recording a failure and refusing to sign off on it are two different jobs.

---

## 🔬 Falsifiability: Proving a Gate Can Actually Fail (`gate:prove`)

Everything above establishes that a gate _ran_ and _exited 0_. It says nothing about whether that
command was capable of ever exiting nonzero _for this task specifically_. A real forensics run
(`docs/planning/coordinator-conformance/FORENSICS.md`) found ten disjoint-scope tasks sharing one
whole-repository `bun run typecheck` gate, verbatim. That command passes whether any one of those ten
tasks did its work or nothing at all — a green gate that proves nothing about the task it is nominally
attached to. A command that can't fail for a task isn't verifying that task; it's decoration.

`gate:prove` answers one narrow, mechanical question honestly instead of trusting the gate's shape by
eye: **does this task's own compiled gate actually fail once this task's own work is reverted?**

```bash
bun harness.ts gate:prove --run .capsules/<run-id> --task task-1 --actor coordinator
bun harness.ts gate:prove --run .capsules/<run-id> --task task-1 --actor coordinator --base HEAD~1
```

### What it actually does

```text
┌──────────────────────────────────────────────────────────────────────┐
│  1. Copy every tracked/not-ignored file into a throwaway scratch      │
│     directory (`git ls-files -z --cached --others --exclude-standard`)│
│                          │                                            │
│                          ▼                                            │
│  2. Inside the SCRATCH copy only: revert the task's own write scope   │
│     back to --base (default HEAD) — files present at base are         │
│     restored to that content; files the task created that base never │
│     knew about are deleted                                           │
│                          │                                            │
│                          ▼                                            │
│  3. Run the task's compiled gate command against the reverted copy    │
│                          │                                            │
│                          ▼                                            │
│  4. falsifiable = (exit code is not null, and is not 0)               │
└──────────────────────────────────────────────────────────────────────┘
```

The **real repository is never touched.** Every read and every write happens inside a `mkdtempSync`
scratch directory that is `rmSync`'d, recursively, before the command returns — success, failure, or a
thrown error alike. This is also why `gate:prove` is a **deliberate post-compile step**, never something
`plan:compile` runs for you automatically: at compile time the task's work does not exist yet, so
reverting it would produce a scratch copy identical to the current tree, and every verdict would
degenerate to "not falsifiable" regardless of the gate's real quality.

`gate:prove` **always exits 0**, whether the verdict comes back falsifiable or not — a negative verdict
("this gate still passes with the task's work reverted") is exactly the real information the command
exists to surface, not a failure of the command itself. Only a genuine setup problem throws: no
compiled gate for the task, an empty write scope (nothing to revert), a repository with no Git history
to revert against, or a symlink/submodule inside the write scope (unsupported — `gate:prove` only
reverts plain files).

```text
### Gate Proof: `task-1`
**PROVEN FALSIFIABLE**: exits 1 once `task-1`'s write scope is reverted to `HEAD`.
- **Gate**: `bun test tests/unit/slug.test.ts`
- **Write scope**: src/slug.ts
- **Reverted in scratch**: 1 restored, 0 removed, of 214 files copied
- **Duration**: 842ms
- **Prior proof**: none recorded for this exact gate.
```

Each proof is recorded as a durable `gate-proved` event and appended to `state.gate_proofs`, keyed by
task id and the gate's own argv. Running `gate:prove` again against the same task and the same gate
command shows drift against the last recorded proof — a gate that used to prove falsifiable and no
longer does is a real regression, surfaced explicitly rather than silently overwritten.

### How this feeds `plan:audit`'s gate invariants

Two of `plan:audit`'s six invariants exist specifically to judge whether a task's gate can
actually discriminate its own work — both blocking, not advisory — and they consult exactly this recorded proof, via
`graph/plan-audit.ts`'s `latestGateProof`, rather than duplicating the falsifiability check themselves:

- **A3 — gate discrimination**: two tasks with disjoint write scopes sharing byte-identical gate argv
  is refused _unless both tasks individually carry a falsifiable proof over their own current scope_ —
  a proof for only one of the pair is not enough, since it only shows the shared command can tell that
  task's absence from its presence, not the other's.
- **A6 — whole-suite gate**: a task whose gate command _looks_ like it walks the whole repository (no
  narrow, path-scoped invocation) is refused _unless_ it carries a matching falsifiable proof — an
  actual, measured falsifiability result overrides the static "this looks too broad" heuristic.

A proof only counts toward either invariant when its recorded write scope still matches the task's
**current** declared scope — a proof taken before the task's scope changed says nothing about the scope
it has now, and is not treated as satisfying it. `plan:compile` refuses to seal the plan while a
blocking `plan:audit` finding stands, unless the coordinator explicitly overrides it with
`--accept-audit "<invariant-id>:<reason>"` — naming the exact invariant and the reason, once per
blocking invariant; there is no blanket override. The full six-invariant audit (decomposition,
dependency justification, false barriers, straggler risk, and the two gate invariants above) is its own
mechanism, run via `plan:audit`; this chapter only owns the part of it that is actually about gates.

---

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)
