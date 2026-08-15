# 01. Mandatory Gate Systems & Verification Contracts

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)

---

## 🏛️ Why Gates are Non-Negotiable

Even if an independent validator marks a task as `pass`, human developers need objective, automated assurance that compiler, linter, and integration test suites passed cleanly.

In `orchestrating-long-tasks`, verification contracts are represented as **Mandatory Gates**:

```text
┌────────────────────────────────────────────────────────┐
│                   MANDATORY GATE SCHEMA                │
│                                                        │
│  gate_id: "gate-auth"                                  │
│  scope: "task" (or "run")                              │
│  command: ["bun", "test", "tests/auth/jwt.test.ts"]    │
│  cwd: "."                                              │
│  mandatory: true                                       │
│  requirement_ids: ["R-JWT-AUTH"]                       │
└──────────────────────────┬─────────────────────────────┘
                           │
                           ▼
[ Executed under Watchdog Runner: trusted_host_observed_v1 ]
```

---

## 🔒 Scope: Task Gates vs. Run Gates

The harness supports two distinct gate scopes:

### 1. Task Gates (`scope: "task"`)

- Bound to specific task nodes in `graph.json`.
- Evaluated immediately after a task passes independent validation.
- Must succeed with exit code 0 before the task can transition from `gating` to `done`.

### 2. Run Gates (`scope: "run"`)

- Global repository verification suites (e.g. full end-to-end integration tests, package build gates).
- Evaluated at the end of the entire project run.
- Must succeed with exit code 0 before the harness permits final terminal completion (`complete`).

---

## 📜 Direct Argv Grammar Rules

To prevent command injection, shell escaping vulnerabilities, and unpredictable terminal environments:

- **No Shell Wrappers:** Gate commands MUST be expressed as literal bare executable string arrays:
  - ✅ `["bun", "test", "tests/unit/cache.test.ts"]`
  - ✅ `["cargo", "test", "--package", "auth"]`
  - ❌ `["sh", "-c", "bun test tests/unit/*.test.ts"]` _(Rejected)_
  - ❌ `"bun test tests/unit/cache.test.ts"` _(Rejected)_
- **Git Security Seams:** When running Git commands, the harness injects strict isolation headers (`GIT_NO_REPLACE_OBJECTS=1`, `--no-ext-diff`, `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`).

---

## 🛡️ Live Repository Binding (`trusted_host_observed_v1`)

To eliminate the "pass on dirty tree, commit on broken tree" race condition, every gate execution captures cryptographic snapshots before and after command execution:

$$\text{repository\_binding} = \{\text{content\_sha256}, \text{git\_identity\_sha256}, \text{file\_count}, \text{total\_bytes}\}$$

During final completion, the harness verifies that the current live repository matches the post-command repository binding of the gate receipts. If any files were modified after the gate ran, the gate is marked stale and must be re-executed!

---

[⬅ Previous: Repair Routing & Escalation](../06-validation-repair/03-repair-routing-and-escalation.md) | [Master Table of Contents](../README.md) | [Next: Completeness Critic Verification ➡](./02-completeness-critic-verification.md)
