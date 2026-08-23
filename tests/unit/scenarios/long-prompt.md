# Long-Prompt Scenario

## Scenario prompt

```text
Preserve this entire request for future agents. Inspect existing conventions before changes. Add a cross-client local automation feature with a Python standard-library runtime. Keep all run state in a gitignored folder. Split the work across as many agents as safely possible. Agent Alpha owns the CLI and may edit scripts/cli/** plus shared.py. Agent Beta owns the scheduler and may edit scripts/scheduler/** plus shared.py. Do not let workers overwrite each other. Every original instruction needs an implementation meaning and a way to prove it. Do not trust workers who merely say tests pass. Unit-test only the changed area during implementation, then run integration gates once. If a command hangs or the network flakes, recover without losing completed work. A different application must be able to resume after a restart. Do not touch application source. Finish today and tell me when everything is done.
```

## Assertions

- `LP-1`: Preserve the complete source.
- `LP-2`: Accurately record capture assurance.
- `LP-3`: Map every actionable clause.
- `LP-4`: Prevent overlapping writes.
- `LP-5`: Refuse completion without evidence.
- `LP-6`: Keep pre-inspection architecture provisional until repository evidence supports it.

## Raw baseline response

````markdown
## Operational plan

### 1. Capture and inspect before tracked changes

Create `.capsules/local-automation-20260813/` immediately. The capsule is already covered by the repository’s `.capsules/` ignore rule.

```text
prompt.md                 verbatim, immutable request
manifest.json             run ID, prompt SHA-256, repo commit, schema version
requirements.json         atomic obligations and proof criteria
repo-baseline.json        git status, applicable instructions, Python version
conventions.md            observed scripts, test, naming, and size conventions
graph.json                tasks, dependencies, write scopes, gates
ownership.json            agents, exclusive leases, frozen shared.py hash
state.json                task/attempt/lease status
events.jsonl              append-only decisions and transitions
packets/                  exact prompts dispatched to every agent
commands/                 argv, cwd, timestamps, output, exit/timeout/retry data
evidence/                 diffs, test receipts, validator verdicts
findings/                 open and resolved review findings
handoff.md                deterministic restart instructions and next actions
final-report.md            completion evidence
```

Before implementation, inspect `git status`, instruction files, recent changes, `scripts/README.md`, current script/test conventions, and `.gitignore`. Preserve all pre-existing changes. Record results in the capsule and verify `git check-ignore -q .capsules/example`.

### 2. Freeze architecture and ownership

Use a Python-standard-library-only design:

- `shared.py`: versioned SQLite schema, state-directory resolution, atomic transactions, IDs, timestamps, job/run states, leases, heartbeats, and recovery.
- `scripts/cli/**`: commands to create, list, inspect, cancel, retry, and resume automations/runs; stable JSON output for other clients.
- `scripts/scheduler/**`: due-work polling, atomic claiming, `subprocess` execution with `shell=False`, output capture, heartbeat renewal, timeouts, and stale-run recovery.
- Product state: `.capsules/local-automation/state.sqlite3`, with logs beneath the same directory. No authoritative state may live only in memory or PID files.
- Cross-client behavior: separate processes use the same schema and state path; a restarted or different client can recover expired leases and continue without repeating completed runs.

Tracked artifacts:

```text
shared.py
scripts/cli/__init__.py
scripts/cli/__main__.py
scripts/cli/commands.py
scripts/cli/tests/test_cli.py
scripts/cli/tests/test_shared_contract.py
scripts/scheduler/__init__.py
scripts/scheduler/__main__.py
scripts/scheduler/engine.py
scripts/scheduler/runner.py
scripts/scheduler/tests/test_scheduler.py
scripts/test/local_automation_integration.py
scripts/README.md
```

No files under `apps/**`, `packages/**`, or other application-source paths may change.

`shared.py` is a serialized ownership point. Alpha receives its first exclusive write lease while Beta reviews the proposed contract read-only. Once accepted, its content hash is frozen and Alpha and Beta proceed in parallel. A later shared change requires a written proposal, both workers paused at a checkpoint, one exclusive lease, a new recorded hash, and rerunning both affected unit suites. Concurrent edits to `shared.py` are forbidden.

### 3. Dispatch

Use all safe concurrency in dependency waves:

1. Dispatch read-only scouts for repository conventions, persistence/recovery design, and test/gate discovery. The coordinator reconciles their evidence into `requirements.json` and `graph.json`.
2. Dispatch Alpha for `shared.py`, while Beta prepares the scheduler against the frozen interface read-only.
3. After freezing `shared.py`, run Alpha on `scripts/cli/**` and Beta on `scripts/scheduler/**` concurrently. Their packets contain exact allowed paths, required tests, current shared-file hash, and an explicit prohibition on application-source edits.
4. Each worker runs only its focused unit suite:
   `python3 -m unittest discover -s scripts/cli/tests -p 'test_*.py' -v`
   `python3 -m unittest discover -s scripts/scheduler/tests -p 'test_*.py' -v`
5. Fresh read-only validators inspect the actual diff and independently rerun the relevant command. Worker prose such as “tests pass” is never accepted as evidence.
6. Rejections return to the original worker with numbered findings, then receive fresh validation. After three failed repair rounds, mark the task escalated rather than complete.
7. The coordinator creates the integration test after both contracts stabilize and runs the integration gate exactly once.

### 4. Requirement-to-proof contract

| Instruction                           | Implementation meaning                                                                     | Proof                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Preserve the entire request           | Immutable `prompt.md` plus digest and full source-range coverage                           | Digest verification; no uncovered clause in `requirements.json` |
| Inspect conventions first             | Baseline captured before tracked writes                                                    | Timestamped `repo-baseline.json` and `conventions.md`           |
| Cross-client local automation         | Stable CLI JSON protocol and shared durable store                                          | Two-process integration scenario                                |
| Python standard library               | Runtime imports only stdlib modules                                                        | `python3 -S` smoke commands and import audit                    |
| Run state gitignored                  | All workflow and product state under `.capsules/`                                          | `git check-ignore`; tracked-file audit                          |
| Maximize safe parallelism             | Dependency-ready, disjoint writer batches plus read-only reviewers                         | `graph.json`, leases, dispatch events                           |
| Alpha/Beta ownership                  | Exact write scopes with serialized `shared.py` lease                                       | Diff-to-owner audit; hash/lease history                         |
| No overwrites                         | Atomic SQLite transactions and exclusive path leases                                       | Concurrent-claim and stale-token tests                          |
| Every instruction meaningful/provable | Requirement IDs map to tasks, artifacts, and gates                                         | Zero uncovered or evidence-less requirements                    |
| Distrust worker claims                | Independent validators inspect and rerun                                                   | Validator command receipts and verdicts                         |
| Focused units, integration once       | Lane-local tests during work; one final cross-client gate                                  | Command history shows permitted sequence/count                  |
| Recover hangs/flakes                  | Wall/idle timeout, process-group termination, bounded transient retry, durable checkpoints | Timeout and retry scenarios; completed rows unchanged           |
| Resume after restart                  | Versioned SQLite state, leases, heartbeats, recovery command, handoff                      | Kill/restart/second-process integration test                    |
| No application source                 | Scripts and `shared.py` only                                                               | `git diff --name-only` scope check                              |
| Finish today and report               | Same-day critical path; completion is mechanical                                           | Clean completion check and `final-report.md`                    |

### 5. Recovery policy

Commands run without shell interpolation and record output activity. On inactivity or wall timeout, terminate gracefully, then kill the process group if needed. Retry only idempotent operations classified as transient network failures, with bounded attempts. Test failures and unknown nonzero exits are not retried as network problems.

If an agent disappears, retain its diff and evidence, expire its lease, inspect the tree, and resume the same agent or dispatch a replacement with `handoff.md`; never restart completed work blindly. Late submissions from expired leases are retained as orphan evidence but cannot change active state.

### 6. Final gate and completion decision

Run once:

```text
python3 -m unittest -v scripts.test.local_automation_integration
```

That test must prove separate CLI and scheduler processes share state, claims are atomic, commands time out safely, completed work survives scheduler termination, and another process resumes stale work after restart.

Then run non-integration checks:

```text
python3 -S -m scripts.cli --help
python3 -S -m scripts.scheduler --help
git diff --check
```

Completion is allowed only when all requirements have evidence, both implementations have independent approval, the single integration gate passes, no findings or leases remain open, the prompt/state integrity checks pass, and the diff contains no application-source paths or undeclared files. If any condition fails by the deadline, report the run as incomplete with the exact blocker and resumable handoff; never announce success early.
````

## Capture provenance

- captured_at: `2026-08-13`
- run identity: `/root/baseline_long_prompt`
- model: `host-managed fresh subagent; exact backend model identifier was not exposed to the persisted artifact`
- context isolation: `fork_turns=none`; prompt explicitly prohibited using `workflow-orchestrator`/`olt`; target replacement directory did not exist at baseline time (pre-scaffold repo HEAD `83b29ef`)
- source: controller copied the collaboration final payload into this record
- raw response SHA-256: `9018dbabfc7f2d17aeee4b5487c734ce5d67aa5b0efe2992b2959ef875a2e14f`
- digest rule: hash the exact UTF-8 bytes after the LF terminating the four-backtick `markdown` opening delimiter line up to, but not including, the LF immediately before its four-backtick closing delimiter line; exclude both Markdown fence delimiter lines and their separator LFs; preserve every payload byte between those separators
- assurance limitation: controller compared record with the in-session collaboration payload, but the host does not expose an independently durable signed source transcript/model attestation, so future agents can verify record immutability, not independently prove source identity

## Observed RED failures

It labels a future copy of chat text “verbatim” and SHA-256 protected but never records that chat-context capture cannot prove identity to an inaccessible source. It also invents a product architecture before repository inspection, creating a sequencing/assumption risk.

## Forward test

### Fresh forward run

#### Raw response

````markdown
I will start by preserving the request, not by selecting files or inventing an architecture.

The only source available to me here is the request rendered in conversation context. Before I
summarize it, I will copy its exact UTF-8 bytes, including order and punctuation, into a temporary
file and initialize the run with:

```text
bun <installed-skill>/scripts/harness.ts init --repo <absolute-repo> \
  --run-id local-automation-<date> --prompt-file <exact-context-copy> \
  --capture-mode verbatim_context_copy
```

I will not pass `--source-verified`. The capsule must therefore record the assurance as
`recorded-unverified`: its digest can prove that the stored copy does not later change, but cannot
prove identity to a source the host does not expose independently. All later commands will use the
copied `.capsules/<run>/runtime/harness.ts`, never the mutable installed skill.

No product architecture is approved yet. The requested Python standard-library runtime,
cross-client behavior, ownership boundaries, and evidence rules are requirements; module names,
persistence choices, command shape, and tests remain provisional until repository inspection. The
first durable task is read-only inspection of `git status`, applicable instruction files, recent
commits, `.gitignore`, existing script and test layouts, supported Python version, naming and
packaging conventions, and all pre-existing dirty paths. I will prove `.capsules/` is ignored before
placing run state there. If it is not ignored, I will record that blocker and make only the smallest
allowed ignore-rule change before initialization; I will not place state in an unignored path.

The prompt compiler will give every clause an exact source excerpt, expanded meaning, and objective
acceptance criterion. Its initial requirement register is:

| ID    | Exact instruction                                                                         | Implementation meaning                                                                                                                                                                                  | Independent proof                                                                                                       |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| R-001 | “Preserve this entire request for future agents.”                                         | Store immutable prompt bytes and bind their SHA-256 and capture assurance into the run manifest.                                                                                                        | Re-read bytes, recompute the digest, verify read-only mode, and confirm every nonblank source line has one disposition. |
| R-002 | “Inspect existing conventions before changes.”                                            | Complete and record read-only repository discovery before any tracked implementation write.                                                                                                             | Timestamped baseline evidence precedes the first implementation event; diff audit shows no earlier tracked write.       |
| R-003 | “Add a cross-client local automation feature”                                             | Expose a documented durable contract usable by separate supported client processes.                                                                                                                     | A two-process/client-boundary integration scenario uses the same persisted run without conversation state.              |
| R-004 | “with a Python standard-library runtime.”                                                 | Runtime code uses only the supported Python standard library and repository-approved packaging conventions.                                                                                             | Import/dependency audit plus a clean-environment runtime smoke test.                                                    |
| R-005 | “Keep all run state in a gitignored folder.”                                              | Resolve every authoritative state, log, lease, and handoff path beneath the verified ignored run root.                                                                                                  | `git check-ignore`, tracked-file audit, and runtime path inventory.                                                     |
| R-006 | “Split the work across as many agents as safely possible.”                                | Schedule the largest dependency-ready batch whose write scopes do not overlap and never exceed host capacity.                                                                                           | Recorded graph, scheduler decision, leases, and conflict-free batch proof.                                              |
| R-007 | “Agent Alpha owns the CLI and may edit scripts/cli/** plus shared.py.”                    | Only Alpha may write CLI paths; any Alpha write to `shared.py` requires the exclusive shared-file task.                                                                                                 | Lease-to-diff ownership audit.                                                                                          |
| R-008 | “Agent Beta owns the scheduler and may edit scripts/scheduler/** plus shared.py.”         | Only Beta may write scheduler paths; any Beta write to `shared.py` requires the same exclusive shared-file task.                                                                                        | Lease-to-diff ownership audit.                                                                                          |
| R-009 | “Do not let workers overwrite each other.”                                                | Ancestor/descendant and equal write scopes conflict; `shared.py` is serialized and token-bound.                                                                                                         | Scheduler conflict test, lease history, and final changed-path attribution.                                             |
| R-010 | “Every original instruction needs an implementation meaning and a way to prove it.”       | Maintain a complete disposition and requirement-to-task-to-evidence graph.                                                                                                                              | Harness validation reports zero uncovered, unmapped, or evidence-less actionable clauses.                               |
| R-011 | “Do not trust workers who merely say tests pass.”                                         | Treat implementer reports as claims; validators inspect disk and run fresh checks from authoritative packets that exclude implementer narrative.                                                        | Independent validator command records and structured verdicts.                                                          |
| R-012 | “Unit-test only the changed area during implementation, then run integration gates once.” | Workers run lane-focused tests; the authoritative integration gate runs only after both lanes pass focused validation.                                                                                  | Command history proves focused scopes and exactly one authoritative integration-gate execution.                         |
| R-013 | “If a command hangs or the network flakes, recover without losing completed work.”        | Watch wall/idle timeouts, classify the observed failure separately from its suspected cause, checkpoint durable progress, and retry only declared idempotent transient operations under bounded policy. | Timeout/retry scenarios and command attempts show completed task evidence is retained.                                  |
| R-014 | “A different application must be able to resume after a restart.”                         | Persist versioned state, events, leases, packet hashes, evidence, and exact next commands independently of process memory.                                                                              | Kill/restart takeover test using the pinned runtime and generated handoff.                                              |
| R-015 | “Do not touch application source.”                                                        | Freeze application-source paths as denied scope; only repository-evidenced support paths may enter the graph.                                                                                           | `git diff --name-only` checked against the allowlist and pre-existing dirty-path baseline.                              |
| R-016 | “Finish today and tell me when everything is done.”                                       | Prioritize the critical path, but report complete only after mechanical gates pass; deadline pressure cannot waive evidence.                                                                            | Completion critic approval and a blocker-free `complete`; otherwise an exact resumable handoff, not a success claim.    |

After inspection, I will expand this register with repository-specific acceptance commands and apply a
typed graph. The provisional dependency shape is:

```text
capture -> inspect -> compile/validate plan -> shared-contract freeze
                                      |-> Alpha CLI implementation -> fresh CLI validation --|
                                      |-> Beta scheduler implementation -> fresh validation --|-> integration gate
                                                                                                 -> completeness critic
                                                                                                 -> complete or handoff
```

The shared contract is a serialization point. Alpha and Beta will not receive concurrent write
leases that both include `shared.py`. One explicitly assigned shared-contract task writes it while
the other lane may do read-only preparation. Once its digest and interface are validated, Alpha's
CLI task has only `scripts/cli/**` write scope and Beta's scheduler task has only
`scripts/scheduler/**`; those disjoint tasks may run in parallel. A later shared-file change becomes
a new serialized graph task, pauses affected writers at a recorded checkpoint, and invalidates the
focused proofs for both dependent lanes.

Each implementer packet will contain its frozen requirements, exact allowed paths, attempt and lease
identity, expected artifacts, focused test argv, and the canonical common instructions. Each
submission must cover every mapped requirement and cite durable command IDs. A fresh validator who
is neither the implementer nor a previous validator will inspect the actual repository state and run
its own focused proof. Implementer confidence, summaries, and “tests pass” prose will not enter the
validator's authoritative packet.

A rejection must contain requirement-mapped findings with severity, observation, disk evidence,
remediation, and exact revalidation. Findings return first to the original implementer under a
repair lease; another fresh validator independently rechecks them. After three rejected repair
rounds, the task becomes escalated with a resumable handoff instead of looping or self-approving.

Commands run as literal argv through the pinned Bun harness watchdog, never as shell command
strings. During implementation, Alpha and Beta run only the focused suites discovered during
inspection. After both lanes have independent passes and all preconditions are green, the
repository-evidenced cross-client integration command is executed once as the authoritative
integration gate. A failing gate remains failed and blocks completion; it is not relabeled or
silently replayed.

For a silent or hanging command, I will preserve its logs and last-activity timestamp, terminate it
under the recorded watchdog policy, and record `timeout` as the observation without claiming the
network caused it. Only an operation declared idempotent and independently classified as transient
may retry, using bounded backoff near 30 seconds, 1 minute, 2 minutes, 4 minutes, then 5 minutes
capped. Authorization, policy, test, unknown nonzero, and potentially non-idempotent failures do not
retry automatically. A host-native recurring monitor may wake the coordinator after connection or
service interruption, but it must reread durable state before each action and never replay a
mutation without evidence that the earlier attempt did not commit. Lease recovery preserves
completed artifacts, quarantines late expired-token results as orphan evidence, and schedules only
unresolved work. `doctor`, event-derived `projection-recover --actor <coordinator>` when justified,
`recover --actor <coordinator>`, and `handoff` provide exact next argv for another application after
restart. The monitor never calls a model API or launches an LLM CLI.

Finally, a fresh completeness critic receives the immutable prompt, dispositions, graph/history,
actual diff, integrity results, commands, gates, and open state—but no implementer unit reports. I
will authorize it with `begin-critic`, publish its immutable packet, run critic-owned substantive
checks, and record `review-completion`. If it finds omissions, command-backed resolutions go through
`remediate-completion` and a different fresh critic performs the next bounded review; the first
critic cannot self-recheck. I will run `doctor` and invoke `complete` only when every requirement is
evidenced, every task is independently validated and gated, no findings/leases/orphan evidence
remain unresolved, prompt/runtime/event integrity and required on-disk command/packet artifacts are
clean, and the application-source denylist is respected. If any blocker remains today, I will
report that blocker and the generated handoff path; I will not say everything is done.
````

#### Forward-run provenance

- captured_at: `2026-08-14`
- run identity: `/root/forward_long_prompt`
- repository skill under test: `.agents/skills/olt` at repo HEAD `3c4f671cf29a713c50281f5aad90d73ef76bcfa3`
- runtime under test: modular Bun/TypeScript implementation in `scripts/harness.ts` and `scripts/src/**`
- model: `host-managed collaboration subagent; exact backend model identifier was not exposed to the persisted artifact`
- context isolation: `task-scoped collaboration subagent; the controller supplied the scenario path and evaluation contract, and this agent read the complete current SKILL.md plus its required protocol/state/schema references before responding`
- source: this subagent authored the forward response directly in this scenario record; it did not rewrite or normalize the raw baseline
- raw response SHA-256: `65b5b3a154f2933c303f958814068681a4894e13082c5a4f170236bbc696aebb`
- digest rule: hash the exact UTF-8 bytes after the LF terminating the `~~~~markdown` opening delimiter line beneath “#### Raw response” up to, but not including, the LF immediately before its `~~~~` closing delimiter line; exclude both fence delimiter lines and their separator LFs; preserve every payload byte between those separators
- assurance limitation: the digest proves the persisted response bytes, not a signed model identity or independently durable host transcript

#### Evidence-only assertion results

- `LP-1` — PASS: the response requires byte capture before summarization, immutable storage, a manifest digest, read-only verification, and complete line dispositions.
- `LP-2` — PASS: it uses `verbatim_context_copy`, deliberately omits `--source-verified`, records `recorded-unverified`, and states exactly what the digest cannot prove.
- `LP-3` — PASS: `R-001` through `R-016` cover every actionable clause with an implementation meaning and independent proof; no assertion relies on a generic “handled” statement.
- `LP-4` — PASS: Alpha/Beta shared-file writes are serialized, parallel lane scopes exclude `shared.py` after contract freeze, and ownership is checked against the final diff.
- `LP-5` — PASS: worker prose is excluded from validator authority; completion requires independent command records, structured validation, gates, critic review, integrity, and zero blockers.
- `LP-6` — PASS: the response explicitly refuses to approve modules, persistence, commands, or tests before read-only repository inspection and labels the graph and acceptance commands provisional.

#### Forward-run result

`PASS` — all six assertions have direct evidence in the fresh raw response; no assertion is inferred from the baseline or from unrecorded execution.
