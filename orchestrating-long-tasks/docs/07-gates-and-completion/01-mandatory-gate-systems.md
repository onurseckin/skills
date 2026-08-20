# 01. Mandatory Gate Systems & Verification Contracts

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

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)
