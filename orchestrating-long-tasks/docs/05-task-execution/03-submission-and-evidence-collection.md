# 03. Structured Submission & Monitored Command Evidence

> [!IMPORTANT]
> **HUMAN DEVELOPER REFERENCE ONLY**: This documentation is written for human engineers maintaining and evolving the skill. Autonomous LLM runtime subagents MUST NOT ingest these files directly into context; all operational directives, topology graphs, and task assignments MUST be queried exclusively through the Harness CLI.

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

## 🔐 Effort Evidence: The Write-Scope Content Digest (C4)

A summary is prose. Prose can claim work was done when the write scope on disk never moved at all —
not from dishonesty necessarily, but from a rebase that touched mtimes, a claim that outlived its own
attempt, or a submission built from the wrong checkout. `task:submit` does not take the claim on faith;
it compares two **measurements**.

### The two measurements

`task:claim` hashes the write scope's content the moment the lease is issued, and stores that digest on
the lease itself (`write_scope_content_hash`, `evidence_class: harness_observed`). `task:submit` hashes
the same write scope again, against the same base, right before it accepts the report:

```text
[ task:claim ]  hash(write_scope) ──> stored on lease.write_scope_content_hash
       │
       ▼ (agent edits files…)
[ task:submit ] hash(write_scope) ──> compared against lease.write_scope_content_hash
```

The digest itself (`hashWriteScope`) is a sha256 over every regular file the write scope currently
holds on disk, keyed by repository-relative path and sorted so traversal order can never move the
result. It deliberately never reads a file's mtime — a `git checkout` or rebase can rewrite the mtime of
a file nobody touched, which would otherwise misreport untouched work as changed. A write-scope path
with nothing on disk yet contributes no entry and is not an error; creating that file later is exactly
the divergence the digest exists to detect. A symlink inside the scope is refused outright rather than
followed, and both a per-file size ceiling (64 MB) and a total entry-count ceiling (20,000) bound the
walk, mirroring the same caution the harness applies to every other filesystem walk it doesn't control
the size of.

Under [worktree isolation](./02-atomic-filesystem-scopes.md) (see its final section), both
measurements are taken against the task's **assigned worktree**, not the shared repository checkout —
hashing the shared checkout would make every isolated submission look unchanged regardless of what the
agent actually did.

### The refusal, and the one honest way past it

If the two digests are byte-identical, `task:submit` refuses:

```text
{"ok":false,"error":{"code":"INVALID_STATE","message":"task task-slug write scope (src/slug.ts) is byte-identical to its content at claim; nothing was written. Submit --no-op --reason \"<why>\" if this task legitimately needed no change, or make the change its write scope requires."}}
```

There is exactly one way past this refusal, and it is a declaration, not a bypass: `--no-op --reason
"<why nothing needed to change>"`.

```bash
bun harness.ts task:submit --run .capsules/<run-id> --task task-slug --agent worker-1 --token <token> \
  --summary "Investigated; no code change was needed" \
  --no-op --reason "task-0 already fixed the same defect"
```

`--no-op` and `--reason` are inseparable — one without the other is a CLI error before the digest is
even compared. And `--no-op` is refused, not honored, if the scope actually **did** change since claim:
a submission cannot simultaneously claim "I made this change" (a different digest) and "nothing needed
to change" (`--no-op`). The recorded `no_op` field on the task (`reason`, `declared_by`, `at`) is set
**only** on a truly byte-identical scope carrying an explicit reason — never inferred, and never a
stand-in for "unknown."

This whole comparison is skippable only in one narrow, honest sense: it runs exclusively when **both**
digests were actually measured. A workflow-layer test driving `submitTask` directly through an in-memory
port, with no real filesystem behind it, simply never gets a digest to compare — production `task:claim`
and `task:submit` always supply one against the real repository.

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

`signal` and `signals_sent` can name more than the one signal you'd expect from a single process,
because `run:exec` tracks the **whole process tree** the command spawns, not just its direct child. It
polls the live process table (`ps`) on a backoff — sharpening its attention the instant it spots a new
descendant, since a descendant has to be seen while its parent is still alive or an intermediate exit
can sever the ancestry link — and on timeout or cancellation it terminates every process still
recognizably part of that tree. Without this, a command that spawns a background watcher or a detached
build daemon could report "done" while a child of the killed process silently outlives it.

No second document restates the record. `evidence:get` reads this record and the capture ledger,
because a separate evidence file could disagree with the record and nothing would say which was true.

The `--gate <gate-id>` flag on `run:exec` is what later lets a passing review attach this exact command
as proof of that exact mandatory gate. When a validator's `task:review --status pass` succeeds, the
harness looks for a cited command whose own recorded `gate_id` matches the gate being closed — a
command that merely happened to exit 0 is not interchangeable with one bound to the gate at execution
time, even if both ran the identical argv.

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
7. **Effort Evidence (C4):** When the write scope's content digest at submit is byte-identical to the
   one recorded at claim, the submission is refused unless `--no-op --reason "<why>"` explicitly
   declares that nothing needed to change. See the previous section for the full mechanism.

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
