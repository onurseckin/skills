# 03. Structured Submission & Monitored Command Evidence

[⬅ Previous: Atomic Filesystem Scopes](./02-atomic-filesystem-scopes.md) | [Master Table of Contents](../README.md) | [Next: Chapter 06 — Adversarial Validation ➡](../06-validation-repair/01-adversarial-validation-philosophy.md)

---

## 📑 Submitting Implementation Work

When an implementer completes its assigned coding work within its leased write scope, it submits its progress using the Zero-JSON `task:submit` command:

```bash
bun harness.ts task:submit \
  --run .capsules/<run-id> \
  --task <task-id> \
  --agent <worker-id> \
  --token <bearer-token> \
  --summary "Implemented lease timeout engine with atomic POSIX fsync durability."
```

Upon execution, the harness CLI validates write scope containment against repository git diffs, marks the task as `submitted`, and emits a compact Markdown brief ($\le 30$ lines).

---

## 🔬 Monitored Command Execution (`run:exec`)

In `orchestrating-long-tasks`, an agent cannot claim _"I ran the tests and they passed"_ without attaching verified, monitored execution receipts.

All gate executions and validation checks are executed through `run:exec`:

```bash
bun harness.ts run:exec \
  --run .capsules/<run-id> \
  --task <task-id> \
  --gate <gate-id> \
  --actor <validator-id> \
  -- bun test tests/unit/lease.test.ts
```

### What `run:exec` Produces on Disk:

Under `.capsules/<run-id>/commands/<command-id>/`:

1. **`intent.json`**: Literal argv, cwd, actor, task ID, timeouts, environment overrides.
2. **`stdout.log` & `stderr.log`**: Exact output streams captured directly from OS file descriptors with SHA-256 digests.
3. **`activity.json`**: Timing marks, process PID, memory snapshots, signals sent.
4. **`record.json`**: Final exit status, duration, repository binding before/after, and `trusted_host_observed_v1` evidence record.

```text
+-----------------------------------------------------------------------------------------------+
|                                    COMMAND RECORD RECEPTACLE                                  |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  .capsules/<run-id>/commands/C-ca197aba/                                                       |
|  ├── intent.json      ---> Argv: ["bun", "test", "tests/unit/lease.test.ts"], Cwd: "."        |
|  ├── stdout.log       ---> "pass 12 tests in 45ms\n" (SHA-256: d6684989b...)                  |
|  ├── stderr.log       ---> Empty or warnings (SHA-256: 647c7d92f...)                          |
|  ├── activity.json    ---> CPU/Wall timing, PID, OS signals                                   |
|  └── record.json      ---> exit_code: 0, status: "succeeded", assurance: "trusted_host_observed_v1" |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔒 Submission Invariants Enforced by `task:submit`

When `task:submit` is called with `--token <bearer-token>`:

1. **Token Authentication:** Matches bearer token against `lease.token_digest`.
2. **Scope Enforcement:** Every touched file must fall within `task.write_scope`.
3. **State Advance:** Transitions task from `leased` / `running` $\to$ `submitted`. Releases the implementer's write lease.
4. **Next Step Activation:** Unblocks independent validation (`task:validate-start`).

---

[⬅ Previous: Atomic Filesystem Scopes](./02-atomic-filesystem-scopes.md) | [Master Table of Contents](../README.md) | [Next: Chapter 06 — Adversarial Validation ➡](../06-validation-repair/01-adversarial-validation-philosophy.md)
