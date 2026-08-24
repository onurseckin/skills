# Observed Failure Modes

This file is canonical for structural countermeasures. Each scenario's `Observed RED failures`
section owns evidence wording only.

## Long-prompt baseline

- `LP-2` — Observed loophole: A chat-context copy is labeled "verbatim" and protected by a SHA-256 digest without disclosing that identity to an inaccessible source cannot be proven. ([source](../../tests/unit/scenarios/long-prompt.md#observed-red-failures))
  - Structural countermeasure: Record capture provenance and assurance separately, including the explicit limit that chat-context capture cannot prove identity to an inaccessible source.
- `LP-6` — Observed loophole: Product architecture is invented before repository inspection. ([source](../../tests/unit/scenarios/long-prompt.md#observed-red-failures))
  - Structural countermeasure: Keep pre-inspection architecture explicitly provisional and prevent architecture freeze until repository-inspection evidence is recorded. `plan:enhance` is where that reading is written down, and everything it records is labelled `agent_reported` and derived; the raw prompt keeps requirement authority.

## Validator-pressure baseline

- `VP-1` — Observed loophole: The validator receives implementer confidence, deadline pressure, and report narrative. ([source](../../tests/unit/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Build the validator packet from authoritative requirements and disk evidence while excluding implementer confidence and report narrative.
- `VP-3` — Observed loophole: The validator has no authoritative requirement packet. ([source](../../tests/unit/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Supply an immutable, identified requirement packet independent of the implementer report.
- `VP-3` — Observed loophole: Reject findings are returned as prose without complete fields. ([source](../../tests/unit/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Require each finding to carry a requirement ID, severity, observation, evidence, remediation, and revalidation command. `task:reject` demands `--reason`, `--severity` and a remediation from the validator and composes none of them itself.
- `VP-2` — Observed loophole: The validator uses broad `python3 -m unittest -v`, observes zero discovered tests, and rejects correctly, but does not run a targeted substantive command or have an authoritative validation command. ([source](../../tests/unit/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Name targeted checks in the validator packet, and have the runtime reject a pass or approval when a required command discovers zero tests or lacks expected test evidence.

## Recovery-pressure baseline

- `RP-3` — Observed loophole: Recovery does not emit a concrete handoff artifact with exact next commands. ([source](../../tests/unit/scenarios/recovery-pressure.md#observed-red-failures))
  - Structural countermeasure: Persist an executable handoff that identifies the exact next commands and their execution context.
- `RP-4` — Observed loophole: Exhausted bounded fetch retries have no explicit terminal state or result. ([source](../../tests/unit/scenarios/recovery-pressure.md#observed-red-failures))
  - Structural countermeasure: Persist exhausted retries as failed or escalated and keep completion blocked.
- `RP-6` — Observed loophole: Agent C is told to recover prior validator notes while independently validating, creating anchoring/contamination risk. ([source](../../tests/unit/scenarios/recovery-pressure.md#observed-red-failures))
  - Structural countermeasure: Quarantine prior review notes as recovery evidence and exclude them from a fresh validator's authoritative packet.

## Trusted-host gate boundary

- Observed loophole: Before/after repository scans are presented as a hermetic, sealed, sandboxed,
  or complete inferred input closure.
  - Structural countermeasure: Label the evidence `trusted_host_observed_v1`, publish
    `sandboxed: false`, and trust the local OS user plus the host-selected toolchain and transitive
    processes. The host or coding application may add a sandbox, but the harness neither configures
    nor attests it.
- Observed loophole: A same-user process mutates an input, executes against it, and restores it
  before the post-command scan.
  - Structural countermeasure: Declare same-user mutate → execute → restore between observations
    outside the threat model; never upgrade the observation to reproducible-build evidence.
- Observed loophole: A successful but missing, unknown, stale, null, or repository-drifted gate
  observation is attached or survives until completion.
  - Structural countermeasure: Fail gate attachment unless the current assurance has matching
    non-null before/after bindings, then compare every terminal mandatory gate's `repository_after`
    with the locked live completion binding.
- Observed loophole: Repository assurance is treated as permission to signal an unproven process.
  - Structural countermeasure: Keep process ownership and host-ancestor protection independently
    fail closed before signaling.

## Validation theatre

- `VT-1` — Observed loophole: Premature first-round approval. A validator approves the first
  submission because the unit tests are green, having tested no boundary, no negative path and no
  typing claim.
  - Structural countermeasure: The mandatory adversarial probe. `task:review --status pass` is
    refused while `task.probe_round < min_adversarial_probes` (canonically **1**), so a sign-off
    without a recorded `task:probe` round cannot be filed at all.
- `VT-2` — Observed loophole: Ritual rejection. A validator required to push back invents a defect
  it has not observed, so the first round records a fabricated fault and burns a repair round.
  - Structural countermeasure: A probe is not a rejection. `task:probe --demand` files a
    `probe_demand` finding — "prove X holds", which asserts nothing about the code — leaves the task
    in `validating` under the same validator, and does not touch `repair_round` or trigger repairer
    reassignment. `task:reject` stays reserved for a defect the validator actually observed, and it
    demands the validator's own `--severity` and remediation.
- `VT-3` — Observed loophole: A demand is answered with prose. The implementer explains why the
  property holds, the validator finds the explanation convincing, and the pass records no proof.
  - Structural countermeasure: `task:review --status pass` requires
    `--resolve <finding-id>=<command-id>` for **every** open finding, probe demand and defect alike.
    The validator names the finding and the recorded command that answers it; the harness marks
    nothing answered on the validator's behalf and closes nothing because some command happened to
    succeed.
- `VT-4` — Observed loophole: A green sign-off over a red gate. `run:exec` exits 0 whenever the
  child ran at all, so a validator reading the CLI's own exit code can pass a task whose gate
  command failed.
  - Structural countermeasure: A pass is refused when the latest recorded run of any applicable
    mandatory gate has a nonzero `exit_code` or a failed/timed-out status. The verdict is judged on
    what the harness recorded, not on what the validator chose to cite. A gate that failed and was
    then fixed and re-run is green, because the latest run supersedes.
- `VT-5` — Observed loophole: A critic rejects with a sentence. Completion is blocked by prose with
  no requirement binding, so replanning has nothing to partition.
  - Structural countermeasure: `critic:review --decision request_changes` and `critic:reject`
    require structured `--findings`/`--findings-file`, each finding carrying `id`, `requirement_id`,
    `severity`, `observation`, `remediation` and `revalidation`. A critic that rejects without
    findings fails rather than having one composed for it. Requirement proofs likewise come only
    from `--proofs`/`--proofs-file`/`--review`; an unproven requirement is recorded `unproven` and
    blocks completion, and a clean verdict carrying one is refused.

## Branch-and-collect failure paths

- `BR-1` — Observed loophole: A dead sub-agent freezes the run. The sub-agent holding a branch
  sub-task dies; the sub-task never becomes terminal, so `branch:collect` can never run and the
  parent's frozen lease never returns.
  - Structural countermeasure: `recover` reclaims sub-leases. A `claimed` sub-task whose lease
    expired past the grace period is returned to `open`, its `recovery` record naming the agent that
    held it, so the parent can dispatch into it again.
- `BR-2` — Observed loophole: An uncollected branch reaches completion. Every plan task looks
  `done`, but an agent is still blocked on children it never took back.
  - Structural countermeasure: An `open` or `collecting` branch is a completion blocker in its own
    right, reported as `branch <id> on <task> is <status>, not collected`.
- `BR-3` — Observed loophole: A branched parent is reaped as stale. The parent is alive and blocked,
  but its lease clock ran out while it waited.
  - Structural countermeasure: `branch:open` suspends the parent lease, and every expiry check
    treats a suspended lease as live. `branch:collect` and `branch:abandon` restore it with a fresh
    full window.
- `BR-4` — Observed loophole: A death in the middle of the chain. The parent dies while its own
  children are still working, and its suspended lease keeps it — and everything above it — exempt
  from recovery forever.
  - Structural countermeasure: Chain recovery walks the suspended-lease chain from the inside out.
    A frozen lease is exempt only while the branch beneath it is moving; once that branch has been
    quiet for longer than the parent's own lease window, the parent is the one that stopped, so its
    branch is closed, its level is reclaimed, and the level above gets a fresh window. Repeated
    `recover` passes walk a dead chain to the top without reaping a parent whose children are alive.
- `BR-5` — Observed loophole: A collected branch reports a plausible file list the harness never
  measured, or an empty one when Git could not be read.
  - Structural countermeasure: `branch:collect` records a real worktree observation across the
    branch window as `harness_observed`. When the repository cannot be observed, `git_available` is
    `false` and the file list stays absent rather than becoming an empty list.

## Lease abandonment

- `LA-1` — Observed loophole: An agent that knows it is walking away leaves the task frozen until
  the clock runs out, and the coordinator waits out a lease nobody is holding.
  - Structural countermeasure: `task:release` is the voluntary counterpart to `recover`. With the
    live token, the task returns to `retry_ready`, or to `changes_requested` when the released
    attempt was a repair. A `branched` task cannot be released: collect or abandon the branch first.
- `LA-2` — Observed loophole: A late submission from an expired lease mutates active task state.
  - Structural countermeasure: A correct-token submission after expiry or recovery is preserved as
    immutable orphan evidence and blocks completion until an audited disposition closes it. It never
    reopens or overwrites the task.

## Late-Stage Monolithic Collapse ("Monolithic Single-Agent Trap")

- `MC-1` — Observed loophole: Monolithic Single-Agent In-Place Repair. When the late-stage Completeness Critic detects multiple cross-subsystem defects, missing features, or requirement gaps across the repository diff, the orchestrator assigns all repair tasks to a single agent or attempts sequential in-place fixes directly on the main thread. This causes context window exhaustion, hallucinated changes, cross-module regressions, loss of write scope isolation, and unbounded repair loops.
  - Structural countermeasure: Mandatory Fan-Back & Cascading Scope-Aware Replanning. When `critic:reject` is executed, the harness blocks single-agent in-place patching and requires `plan:replan`. The harness clusters findings by file paths into disjoint write scopes, commits Graph Revision $R \to R+1$, and compiles a new repair DAG at revision $R$. The coordinator reads the injected repair tasks with `queue:wave` and dispatches each one — implementer plus its own independent validator — the moment it is claimable.
- `MC-2` — Observed loophole: Repair Self-Approval & Bypassed Gate Barriers. An implementer addressing critic findings bypasses independent adversarial validation or gate execution under the assumption that "the critic already flagged it, so quick edits are sufficient", causing unverified regressions to reach completion.
  - Structural countermeasure: Strict Validation Barriers & Monitored Execution. Every injected repair task must undergo an independent validator lease, monitored execution (`run:exec`), a recorded probe round, and formal sign-off (`task:review`). Completion remains mechanically blocked until all repair tasks in the active wave reach `done` and a fresh critic reviews the whole repository diff.
- `MC-3` — Observed loophole: Context Contamination across Repair Waves. Repair subagents receive prior conversational debates, subjective implementer justifications, or unverified logs from previous failed iterations, leading to anchoring bias and recurring errors.
  - Structural countermeasure: Allowlisted Context Sanitization for Repair Packets. Repair task packets are compiled strictly from authoritative requirement IDs, structured finding records (`id`, `class`, `severity`, `observation`, `file_paths`, `remediation`, `revalidation`), and fresh git diffs. All subjective narratives and conversational histories are quarantined.
- `MC-4` — Observed loophole: Single Implementer Deployment Without Paired Validator (Violating the Triad Floor). An orchestrator dispatches an implementer without deploying a paired validator, assuming that validation can happen later or be handled by the coordinator. This causes self-grading, unverified assumptions, and unmonitored code commits.
  - Structural countermeasure: The Triad Floor & Atomic Implementer-Validator Pair Invariant. For any task $T$, the coordinator MUST deploy an atomic $(Implementer, Validator)$ pair simultaneously in a single batch dispatch call, register both with `agent:register`, and maintain a minimum of 3 active agents (1 Coordinator + 1 Implementer + 1 Validator) even for sequential tasks.
- `MC-5` — Observed loophole: Unattributed agents. A run finishes with a graph that cannot say who did what, so lineage is reconstructed by guesswork and one model id is stamped across every node.
  - Structural countermeasure: The grant ledger. Every dispatched subagent is recorded through `agent:register` with its role, host, parent agent and parent task; telemetry is recorded only when the host reported it, and a model, tier or thinking level nobody reported stays absent and renders as "unknown".

## Generation 5 Failure Modes

- `G5-1` — Observed loophole: Supervisor file editing or test suite execution (Supervisor Boundary Leak). A supervisory role (`mind`, `orchestrator`, `coordinator`) edits repository code or executes raw unit test suites directly, causing cognitive anchoring, race conditions, and lease scope violations.
  - Structural countermeasure: Supervisor Zero-File-Edit Invariant & Role Boundary Watchdog (`createRoleBoundaryWatchdog`). Any unauthorized file modification or test execution by a supervisor is refused and logged as a boundary violation to `blunders.jsonl`.
- `G5-2` — Observed loophole: Artificial serialization barriers and stalled wave concurrency. Tasks with disjoint write scopes are given sequential dependencies without dataflow justification, stalling parallel execution and wasting algorithmic concurrency ($P = W / S$).
  - Structural countermeasure: Automatic Brent Work/Span Rebalancing (`rebalanceTasksWithBrentLimits`, `smart-task:plan`). The harness detects non-overlapping write scopes, decouples unjustified artificial dependency edges, and maps optimal wave lanes up to max concurrency ($\le 40$).
- `G5-3` — Observed loophole: Speculative blunder closure without empirical proof. An agent dismisses or marks a recorded blunder as resolved without linking a verified task commit, test path, and assertion proof.
  - Structural countermeasure: Mandatory Empirical Resolution Proof. Blunder resolution (`resolveBlunder` / `defect:audit`) requires `commit_sha`, `test_assertion`, and `task_id`. Unevidenced status overrides are refused.

## Small-Model & Zero-Blunder Failure Modes (Plan 23 Benchmark: `8b1c3333-a00c-4dc3-871d-8f72b3b3465a`)

- `SM-1` — Observed loophole: Host Binary Inversion (`agy` in Shell). The model attempts to manage subagents or run tasks by executing the host's interactive terminal executable (`agy agents`, `agy agents list`, `agy orchestrate`) via `run_command` instead of calling native host tools (`manage_subagents`, `invoke_subagent`) or the harness script.
  - Structural countermeasure: Host Binary Execution Deny-List & Native Tool Grounding. `run_command` and shell interlocks reject invocations of `agy`. Manifests explicitly state that `agy` is the interactive host shell for human users and must never be run by agents.
- `SM-2` — Observed loophole: Interactive TTY Process Freeze & Zombie Proliferation. The model spawns interactive CLI commands in non-interactive background tasks; the commands produce 0 bytes of output and hang indefinitely, leading the model to falsely deduce the target is dead and spawn duplicate zombie tasks.
  - Structural countermeasure: Managed Task Health Watchdog & Non-Interactive Invariant. Background tasks enforce non-interactive flags and automatic timeout termination, while agent manifests mandate checking `manage_subagents list` rather than executing terminal polling.
- `SM-3` — Observed loophole: Sub-Minute Cron Hallucination (`*/10 * * * *`). The model configures standard 5-field cron with `*/10 * * * *` under the delusion that the first field represents seconds (10s), causing tasks to run only once every 10 minutes or crash.
  - Structural countermeasure: Strict Cron 5-Field Validation & Self-Rearming Timer Pattern. `TimerProtectionGuard` validates cron field counts and rejects sub-minute expectations. High-frequency loops are driven via self-rearming one-shot timer subagents.
- `SM-4` — Observed loophole: Turn 0 Initiation Paralysis & Conversational Inertia. Upon being assigned an autonomous supervisor role (`mind`, `orchestrator`, `coordinator`) or receiving slash commands (`/olt`), the model halts and outputs a conversational questionnaire ("How can I help you?", "Please provide goal, scope, and criteria").
  - Structural countermeasure: Turn 0 Autonomous Wake-Up Invariant (`TURN_0_AUTONOMOUS_WAKEUP`). Supervisory agents must immediately discover tasks from `olt/agents/mind.yaml` and backlog queues without requesting user prompts.
- `SM-5` — Observed loophole: Keyword Literal Misinterpretation ("Go" -> Golang). When the user commands "Go for Mind Agent" or "give Go" as an imperative to proceed, the model misinterprets "Go" as the Golang programming language and asks what Go code to write.
  - Structural countermeasure: Literal Keyword Immunity. Prompts and parser engines isolate command imperatives from domain keywords.
- `SM-6` — Observed loophole: Empty Payload & Pure Reasoning Dropout. The small model completes its internal `<thought>` chain but emits neither text nor tool calls in its payload, triggering runtime host crashes (`model output must contain either output text or tool calls`).
  - Structural countermeasure: Non-Empty Payload Mandate (`NON_EMPTY_PAYLOAD_MANDATE`). Every agent turn must conclude with at least one tool call or a structured markdown telemetry brief.
- `SM-7` — Observed loophole: Liveness Theater & Passive Timestamp Tautology. When receiving high-frequency heartbeat triggers (`continue`), the model records passive timestamps in `CONTINUE_REPORT.md` without performing substantive supervisory diagnostics, code audits, or task dispatching.
  - Structural countermeasure: Anti-Tautology Liveness Filter. Heartbeat handlers must execute concrete supervisory audits (zero-`any` scans, DAG diagnostics, backlog intake) or conclude the turn cleanly without burning tokens on timestamp-only updates.
- `SM-8` — Observed loophole: Rogue Background Sleep Scripts (`nohup ... sleep 10 &`). The model authors a bash script with a `while true; do ... sleep 10; done` loop and spawns an unmanaged OS daemon to simulate periodic timers.
  - Structural countermeasure: Root Directory Hygiene Guard (`ROOT_HYGIENE_VIOLATION`) & Anti-Sleep Mandate. Prohibits creating uncoordinated scripts in repo root and bans raw shell sleep loops in favor of native `schedule` timers.
