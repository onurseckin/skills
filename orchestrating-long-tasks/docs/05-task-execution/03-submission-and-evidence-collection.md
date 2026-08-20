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

```text
### Submission Accepted: task-slug
- **Agent**: `impl-slug` | Status: `submitted`
- **Write Scope Compliance**: Passed (1 files touched within `src/slug.ts`)
- **Diff Stats**: 1 files touched
- **Report**: `.capsules/slugger/reports/task-slug-submission.json`
- **Next Step**: Dispatch independent validator via `bun harness.ts task:validate-start …`
```

### Where each field comes from

| Field           | Source                                                                                                 |
| :-------------- | :----------------------------------------------------------------------------------------------------- |
| `summary`       | `--summary`. **Mandatory** unless `--report` carries the whole report. Nothing is substituted for it.  |
| `files_changed` | `--files-changed` when given, otherwise a Git observation of the worktree narrowed to the write scope. |
| `checks`        | `--evidence <command-id>` when given, otherwise the agent's own recorded commands.                     |
| `report`        | `--report <path>` for a complete pre-built payload.                                                    |

If neither source yields anything, the command **fails** rather than submitting an empty report. There
is no fallback path, no default command id, and no invented gate check.

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

1. **`record.json`** — the whole observation: `argv`, `cwd`, `actor`, `task_id`, `gate_id`, `status`,
   `exit_code`, `started_at` / `finished_at`, `signal` and `signals_sent`, `repository_before` and
   `repository_after` bindings, `fingerprint`, `attempt_signing_public_key`, and a `logs` block naming
   each stream's path, byte count and SHA-256.
2. **`attempt-<n>/stdout.log`** and **`attempt-<n>/stderr.log`** — the exact bytes, per attempt.

A matching `evidence/<command-id>.json` file is written for the evidence index.

```text
+-----------------------------------------------------------------------------------------------+
|                                    COMMAND RECORD RECEPTACLE                                  |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  .capsules/<run-id>/commands/C-89145bcc-77ff-4439-bd83-06060bcd160a/                           |
|  ├── record.json        ---> argv, cwd, actor, gate_id, exit_code: 0, status: "succeeded",     |
|  │                           repository_before/after, assurance: trusted_host_observed_v1      |
|  └── attempt-1/                                                                                |
|      ├── stdout.log     ---> 28 bytes  (SHA-256: d6684989b...)                                 |
|      └── stderr.log     ---> 319 bytes (SHA-256: 1c20f149a...)                                 |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔒 Submission Invariants Enforced by `task:submit`

When `task:submit` is called with `--token <bearer-token>`:

1. **Token Authentication:** Matches bearer token against `lease.token_digest`.
2. **Packet Authority:** Asserts a role packet was actually published for this agent and attempt, so a
   report cannot arrive from an identity that was never issued a contract.
3. **Scope Enforcement:** Every touched file must fall within `task.write_scope`.
4. **Substance:** `--summary` (or a `--report` that carries one) is required, and the report must end
   up with a non-empty file list and non-empty checks.
5. **State Advance:** Transitions the task from `leased` / `running` $\to$ `submitted` and releases the
   implementer's write lease.
6. **Next Step Activation:** Unblocks independent validation (`task:validate-start`).

---

## 🚫 No Substitutions on This Path

Three rules keep a submission from _looking_ complete when it is not:

- **No default file list.** `files_changed` is what the agent declared or what Git showed. When neither
  yields a path, the command fails; it never falls back to a plausible one.
- **No synthetic check ids.** Every entry in `checks` names a command the harness actually recorded.
- **Every accepted flag is read.** `--evidence` and `--report` change the report they are passed to.

A report that cannot be backed is worth less than no report at all, so the failure is loud.

---

[⬅ Previous: Atomic Filesystem Scopes](./02-atomic-filesystem-scopes.md) | [Master Table of Contents](../README.md) | [Next: Chapter 06 — Adversarial Validation ➡](../06-validation-repair/01-adversarial-validation-philosophy.md)
