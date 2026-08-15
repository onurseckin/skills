# 03. Structured Submission Reports & Monitored Evidence

[⬅ Previous: Atomic Filesystem Scopes](./02-atomic-filesystem-scopes.md) | [Master Table of Contents](../README.md) | [Next: Chapter 06 — Adversarial Validation ➡](../06-validation-repair/01-adversarial-validation-philosophy.md)

---

## 📑 The Structure of an Implementation Submission

When an implementer completes its assigned coding work, it does not send conversational text to the coordinator. Instead, it generates a **Structured JSON Submission Report** conforming to the `harness.submission-report` schema.

```json
{
  "summary": "Implemented lease timeout engine with atomic POSIX fsync durability.",
  "requirement_ids": ["R-LEASE-01", "R-LEASE-02"],
  "files_changed": ["src/engine/lease.ts", "src/engine/timeout.ts"],
  "checks": [{ "command_id": "C-ca197aba-a389-40a2-9d36-9b775d8f237b" }],
  "evidence": [{ "path": "src/engine/lease.ts" }]
}
```

---

## 🔬 Monitored Command Proofs (`commands/`)

In `orchestrating-long-tasks`, an agent cannot claim _"I ran the tests and they passed"_ without attaching an immutable **Command Record ID** (`C-xxx`).

All commands must be executed through the watchdog runner (`harness.ts run`):

```bash
bun orchestrating-long-tasks/scripts/harness.ts run \
  --run .capsules/<run-id> \
  --actor implementer-1 \
  --task task-1 \
  --cwd . \
  --wall-ms 30000 \
  --idle-ms 10000 \
  -- bun test tests/unit/lease.test.ts
```

### What `run` Produces on Disk:

Under `.capsules/<run-id>/commands/<command-id>/`:

1. **`intent.json`**: Literal argv, cwd, actor, task ID, timeouts, environment overrides.
2. **`stdout.log` & `stderr.log`**: Exact output streams captured directly from OS file descriptors with SHA-256 digests.
3. **`activity.json`**: Timing marks, process PID, memory snapshots, signals sent.
4. **`record.json`**: Final exit status, duration, repository binding before/after, and Ed25519 attempt signature.

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
|  └── record.json      ---> exit_code: 0, status: "succeeded", assurance: "trusted_host"       |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔒 Submission Invariants Enforced by `harness.ts submit`

When `submit` is called with `--token <bearer-token> --report report.json`:

1. **Token Authentication:** Matches bearer token against `lease.token_digest`.
2. **Scope Enforcement:** Every entry in `files_changed` must fall within `task.write_scope`.
3. **Requirement Mapping:** `requirement_ids` must be a subset of the task's assigned requirements.
4. **Valid Command Proofs:** Every command ID listed in `checks` must exist in `commands/`, have `status: "succeeded"`, `exit_code: 0`, and match the task ID and actor.
5. **State Advance:** Transitions task from `leased` / `running` $\to$ `submitted`. Releases the implementer's write lease.

---

[⬅ Previous: Atomic Filesystem Scopes](./02-atomic-filesystem-scopes.md) | [Master Table of Contents](../README.md) | [Next: Chapter 06 — Adversarial Validation ➡](../06-validation-repair/01-adversarial-validation-philosophy.md)
