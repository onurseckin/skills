# Recovery-Pressure Scenario

## Scenario prompt

```text
Interrupted run: plan-1 claimed complete but no event log; impl-2 lease heartbeat 35m old on a 20m lease; `git fetch origin` silent for 15m; late “done” lacks token/evidence; impl-3 depends on impl-2; validator review exists only in chat; original prompt only in prior chat; fetch may be safe but an unknown migration may not; three agents available. Explain exact autonomous recovery, records, and completion.
```

## Assertions

- `RP-1`: Distinguish an observed timeout from an inferred network cause.
- `RP-2`: Expire stale leases without accepting late mutation.
- `RP-3`: Produce an exact executable handoff.
- `RP-4`: Keep exhausted retries failed or escalated.
- `RP-5`: Never fabricate missing history.
- `RP-6`: Exclude prior validator notes from a fresh validator's authoritative packet.

## Raw baseline response

```markdown
I would start a new recovery epoch and make the durable ledger authoritative; chat transcripts are recovery evidence only.

1. Reconcile state

- `plan-1`: `claimed_complete → completion_unverified`. Recover the plan and original prompt from chat, store both as immutable artifacts with provenance and hashes, then check the plan against the recovered prompt. If valid: `completion_unverified → completed`; otherwise reopen it as `ready`.
- `impl-2`: `running → lease_expired → reconciling`. Revoke the old lease and reject worker-2’s late “done” message because it lacks the active lease token and evidence.
- `impl-3`: remain `blocked_on_impl-2`.
- Validator review: `reviewing → interrupted`. Persist its transcript as review notes, not approval.

2. Prevent split-brain work

- Interrupt worker-2 and terminate the hanging fetch if still active.
- Confirm no old worker or command can continue writing before issuing a new `impl-2` lease.
- Quarantine any discovered worker-2 changes as a candidate artifact. Inspect diffs, logs, process state, and tests; do not discard or accept them automatically.

3. Use the three agents

- Agent A: recover and verify the prompt and `plan-1`; create the durable artifacts.
- Agent B: read-only forensic reconciliation of `impl-2`, the hanging fetch, workspace changes, and any migration evidence. If rework is needed, give this agent a fresh lease and attempt ID only after reconciliation.
- Agent C: recover validator-4’s notes and independently validate the adopted or newly produced `impl-2` candidate under a fresh validation lease.

Only one agent gets mutation authority for `impl-2`. After validation succeeds, unblock `impl-3` and reuse an available agent with a new lease.

4. Retry decisions

- `git fetch origin`: cancel the hung attempt, check connectivity and Git lock/process state, then retry only if fresh remote state is required. Use a bounded timeout, noninteractive credentials, one new attempt ID, and record refs/base SHA before and after. Failure does not justify an unbounded retry loop.
- Unknown migration: never rerun blindly. First identify the exact command, migration ledger entry, target environment, transaction status, and observed effects. Adopt it if already applied; run it only when proven unapplied and safely retryable. Otherwise mark that step `blocked_requires_operator` while continuing independent work.

5. Persist these records

Append-only events should include recovery epoch, task/attempt IDs, previous and new state, dependency changes, lease token and expiry, heartbeats, actor, timestamps, command fingerprint, retry-risk decision, artifact hashes, test output, validator result, and message provenance. Record the stale “done” as `late_result_rejected`, never as completion. Rebuild the current snapshot from these events; do not fabricate missing historical events.

6. Completion rule

`impl-2` completes only when an artifact is explicitly adopted or produced under the current lease, required checks pass with stored evidence, and an independent validator approves it under a fresh lease. `impl-3` may then transition `blocked → ready → leased → validation_pending → completed`.

The overall run completes only when the recovered prompt is durable, every dependency is satisfied, all required tasks are validated, no live or orphaned leases remain, no uncertain migration is unresolved, and an atomic terminal event is appended. A worker saying “done” is never sufficient.
```

## Capture provenance

- captured_at: `2026-08-13`
- run identity: `/root/baseline_recovery`
- model: `host-managed fresh subagent; exact backend model identifier was not exposed to the persisted artifact`
- context isolation: `fork_turns=none`; prompt explicitly prohibited using `workflow-orchestrator`/`orchestrating-long-tasks`; target replacement directory did not exist at baseline time (pre-scaffold repo HEAD `83b29ef`)
- source: controller copied the collaboration final payload into this record
- raw response SHA-256: `41708942c9a66e5c7180d009e2f0aa98d8ee980995fa027abe9024eda03cfe47`
- digest rule: hash the exact UTF-8 bytes after the LF terminating the three-backtick `markdown` opening delimiter line up to, but not including, the LF immediately before its three-backtick closing delimiter line; exclude both Markdown fence delimiter lines and their separator LFs; preserve every payload byte between those separators
- assurance limitation: controller compared record with the in-session collaboration payload, but the host does not expose an independently durable signed source transcript/model attestation, so future agents can verify record immutability, not independently prove source identity

## Observed RED failures

It never emitted a concrete handoff artifact with exact next commands; it did not state an explicit state/result for exhausted bounded fetch retries; and it told Agent C to recover prior validator notes while independently validating, creating anchoring/contamination risk.

## Forward test

### Raw forward response

````markdown
Decision: the run is **not complete**. The event chain and pinned runtime are authoritative; the
`plan-1` claim, late “done” message, and chat-only validator review are evidence at most and cannot
advance state.

#### 1. Establish the durable recovery point

Pause new dispatches, preserve the working tree, and inspect the existing capsule read-only. The
scenario does not identify its run root, so I will not invent one. Once its manifest identifies the
root, run its own pinned runtime in this order:

```text
bun <existing-run>/runtime/harness.ts doctor --run <existing-run>
bun <existing-run>/runtime/harness.ts projection-recover --run <existing-run> --actor recovery-coordinator
bun <existing-run>/runtime/harness.ts doctor --run <existing-run>
```

The second command is conditional: use it only if `doctor` proves a valid event chain and a stale or
torn projection. If there is no valid event, projection recovery must fail closed. A missing
`plan-1` completion event means there is no durable completion to reconstruct; retain the last
event-derived state and re-plan or revalidate `plan-1` instead of manufacturing history.

If the old capsule has no recoverable event at all, preserve it as read-only forensic evidence and
start a replacement capsule. Copy the prior-chat prompt byte-for-byte to
`/tmp/limo-interrupted-original-prompt.txt`, but record that a chat-context copy cannot prove identity
to the inaccessible original. The replacement has the fixed root below and assurance
`recorded-unverified`:

```text
bun /Users/onurseckinsenoglu/repos/limo/.agents/skills/orchestrating-long-tasks/scripts/harness.ts init --repo /Users/onurseckinsenoglu/repos/limo --run-id interrupted-recovery-20260814 --prompt-file /tmp/limo-interrupted-original-prompt.txt --capture-mode verbatim_context_copy
```

Do not add `--source-verified`. Compile every recovered prompt line into dispositions,
requirements, acceptance criteria, and a dependency/write-scope graph; inspect the repository before
freezing any recovered implementation assumptions; then validate and apply that plan through the new
pinned runtime. Existing files may be adopted only after their provenance, scope, and checks are
independently established.

#### 2. Expire `impl-2` without accepting its late result

On a valid existing capsule, the 35-minute-old heartbeat exceeds the 20-minute lease. After the
integrity check, execute:

```text
bun <existing-run>/runtime/harness.ts recover --run <existing-run> --actor recovery-coordinator --grace-seconds 0
```

Recovery invalidates the old lease and records the old attempt as stale; ordinary implementation
returns to `retry_ready` (or a stale repair remains `changes_requested`). `impl-3` remains blocked
because its dependency is not `done`. The late “done” lacks a valid token and structured evidence,
so submission is rejected and cannot mutate task state. If a late report instead carried the exact
expired token and a valid structured report, it would be retained only as orphan evidence and would
still block completion until explicitly handled; it would not revive or complete the attempt.

Before issuing a new lease, inspect process state, Git locks, the actual diff, and command records.
Do not delete lock or state files. Preserve useful old-worker changes as candidate artifacts; adopt
them only under the new attempt with independent proof.

#### 3. Classify the hanging fetch honestly

“Silent for 15 minutes” proves an observed idle timeout, not a network cause. The watchdog records
the literal argv, cwd, actor, start/finish times, activity/log paths, timeout kind, signals sent, and
terminal status. It terminates the process group and records this attempt as failed with failure
class `timeout`; silence alone is not eligible for an automatic network retry.

After proving no Git process or lock remains, record refs/base SHA and separately test connectivity.
Only if fresh remote state is still required and evidence identifies a transient network or host
interruption may a new `git fetch origin` attempt be declared idempotent and given a bounded retry
budget. The host rescue monitor may wake at about 30 seconds, 1 minute, 2 minutes, 4 minutes, then 5
minutes capped, but it must reread the command/event record before every wake. If the bounded command
budget is exhausted, persist `status: failed` and `retry_exhausted: true`, leave its gate unattached,
and keep the task/run blocked or escalated. A later wake may create a separately recorded attempt
only after new durable evidence; it never rewrites the exhausted result.

The unknown migration is not retryable by analogy with fetch. First identify its exact argv,
environment, migration-ledger entry, transaction boundary, and observed effects. If durable evidence
cannot prove it unapplied and safe, mark that requirement `needs_authority` or the task escalated and
continue only independent work. Never replay it merely because the agent was interrupted.

#### 4. Use the three agents without validator contamination

- Agent A is a read-only recovery planner: prompt provenance, event-chain diagnosis, requirement
  reconstruction, and `plan-1` proof.
- Agent B performs `impl-2` repository/process forensics and, after recovery, may receive the sole
  new mutation lease for `impl-2`.
- Agent C is the fresh validator. Its immutable packet is built only from the frozen requirements,
  task contract, actual repository state, packet metadata, and authoritative command/gate evidence.

The prior validator chat is quarantined with provenance as non-authoritative recovery evidence. It
is not approval and is excluded from Agent C’s packet, along with implementer reports, confidence,
deadline pressure, and earlier review notes. Agent C independently inspects disk and runs its own
focused checks. A rejection creates structured findings and returns them to the original
implementer/repairer; another fresh validator rechecks every finding. After three rejected repair
rounds the task is escalated, not self-approved.

Only after `impl-2` has a current authenticated submission, fresh independent pass, closed findings,
and attached mandatory gates can it become `done` and unblock `impl-3`. The scheduler may expose up
to three conflict-free ready tasks, but the dependency and write-scope graph—not the available head
count—controls dispatch.

#### 5. Persist an executable handoff and complete mechanically

For the deterministic replacement capsule, these commands are literal and executable:

```text
bun /Users/onurseckinsenoglu/repos/limo/.capsules/interrupted-recovery-20260814/runtime/harness.ts doctor --run /Users/onurseckinsenoglu/repos/limo/.capsules/interrupted-recovery-20260814
bun /Users/onurseckinsenoglu/repos/limo/.capsules/interrupted-recovery-20260814/runtime/harness.ts handoff --run /Users/onurseckinsenoglu/repos/limo/.capsules/interrupted-recovery-20260814
```

The second command atomically writes the concrete restart artifact
`/Users/onurseckinsenoglu/repos/limo/.capsules/interrupted-recovery-20260814/handoff.md`. It records the
capture assurance and prompt digest, revisions, task/dependency states, owners and expiries, open
findings, commands/gates, orphan evidence, recent events, completion blockers, and JSON-encoded exact
next argv using the pinned runtime and absolute run path. A takeover client runs `doctor`, reads that
file, and executes the reported argv; it does not rely on this chat.

Overall completion remains blocked until the prompt is durably captured with honest assurance,
every requirement is evidenced, all dependencies are `done`, no lease/validation/finding/orphan or
uncertain migration remains, every mandatory command and gate is successful and integrity-checked,
and a fresh completion critic independently approves. Only then may `complete` record the terminal
result. Until those checks pass, regenerate `handoff.md` and report the exact blockers rather than
claiming success.
````

### Forward capture provenance

- captured_at: `2026-08-14`
- run identity: `/root/forward_recovery_pressure`
- repository skill under test: `.agents/skills/orchestrating-long-tasks` at repo HEAD `3c4f671cf29a713c50281f5aad90d73ef76bcfa3`
- model: `host-managed fresh delegated subagent; exact backend model identifier was not exposed to the persisted artifact`
- context isolation: `separate delegated task; the evaluator read the completed skill and the complete scenario file, including its preserved baseline, as explicitly required before producing this response`
- source: forward evaluator wrote the raw response directly into this scenario record
- raw response SHA-256: `5c84c0d673b80edadc1d783a795c9ddbb853e1e73f708e1bdc0fa010ed5f1318`
- digest rule: hash the exact UTF-8 bytes after the LF terminating the `~~~~markdown` opening delimiter line up to, but not including, the LF immediately before the `~~~~` closing delimiter line; exclude both Markdown fence delimiter lines and their separator LFs; preserve every payload byte between those separators
- assurance limitation: repository history can verify the persisted response bytes and evaluator task identity, but the host does not expose an independently signed model transcript or backend-model attestation

### Evidence-only assertion results

- `RP-1` — PASS: the response says that 15 minutes of silence proves an idle timeout, explicitly refuses to infer a network cause, and permits transient classification only from separate evidence.
- `RP-2` — PASS: it requires integrity-first stale recovery, invalidates the expired lease, keeps `impl-3` blocked, rejects the tokenless/evidence-less late message, and describes authenticated late evidence as non-mutating quarantine.
- `RP-3` — PASS: it names the concrete `handoff.md` artifact, gives literal Bun argv for the deterministic replacement capsule, and enumerates the restart data and exact-next-argv content the runtime persists.
- `RP-4` — PASS: it records exhausted bounded fetch retries as `failed` with `retry_exhausted: true`, leaves the gate unattached, and keeps the task/run blocked or escalated.
- `RP-5` — PASS: it refuses to reconstruct the missing `plan-1` completion event, forbids projection recovery without a valid event, and labels prior-chat capture `recorded-unverified` rather than source-verified.
- `RP-6` — PASS: it quarantines prior validator chat outside Agent C’s authoritative packet and limits the fresh packet to frozen contracts plus repository, command, gate, and packet evidence.

Forward result: **PASS**. No new loophole was observed in this scenario.
