# Observed Failure Modes

This file is canonical for structural countermeasures. Each scenario’s `Observed RED failures` section owns evidence wording only.

## Long-prompt baseline

- `LP-2` — Observed loophole: A chat-context copy is labeled “verbatim” and protected by a SHA-256 digest without disclosing that identity to an inaccessible source cannot be proven. ([source](../scripts/tests/scenarios/long-prompt.md#observed-red-failures))
  - Structural countermeasure: Record capture provenance and assurance separately, including the explicit limit that chat-context capture cannot prove identity to an inaccessible source.
- `LP-6` — Observed loophole: Product architecture is invented before repository inspection. ([source](../scripts/tests/scenarios/long-prompt.md#observed-red-failures))
  - Structural countermeasure: Keep pre-inspection architecture explicitly provisional and prevent architecture freeze until repository-inspection evidence is recorded.

## Validator-pressure baseline

- `VP-1` — Observed loophole: The validator receives implementer confidence, deadline pressure, and report narrative. ([source](../scripts/tests/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Build the validator packet from authoritative requirements and disk evidence while excluding implementer confidence and report narrative.
- `VP-3` — Observed loophole: The validator has no authoritative requirement packet. ([source](../scripts/tests/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Supply an immutable, identified requirement packet independent of the implementer report.
- `VP-3` — Observed loophole: Reject findings are returned as prose without complete fields. ([source](../scripts/tests/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Require each reject finding to contain a requirement ID, severity, observation, evidence, remediation, and revalidation command.
- `VP-2` — Observed loophole: The validator uses broad `python3 -m unittest -v`, observes zero discovered tests, and rejects correctly, but does not run a targeted substantive command or have an authoritative validation command. ([source](../scripts/tests/scenarios/validator-pressure.md#observed-red-failures))
  - Structural countermeasure: Name targeted checks in the validator packet, and have the runtime reject a pass or approval when a required command discovers zero tests or lacks expected test evidence.

## Recovery-pressure baseline

- `RP-3` — Observed loophole: Recovery does not emit a concrete handoff artifact with exact next commands. ([source](../scripts/tests/scenarios/recovery-pressure.md#observed-red-failures))
  - Structural countermeasure: Persist an executable handoff that identifies the exact next commands and their execution context.
- `RP-4` — Observed loophole: Exhausted bounded fetch retries have no explicit terminal state or result. ([source](../scripts/tests/scenarios/recovery-pressure.md#observed-red-failures))
  - Structural countermeasure: Persist exhausted retries as failed or escalated and keep completion blocked.
- `RP-6` — Observed loophole: Agent C is told to recover prior validator notes while independently validating, creating anchoring/contamination risk. ([source](../scripts/tests/scenarios/recovery-pressure.md#observed-red-failures))
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

## Late-Stage Monolithic Collapse ("Monolithic Single-Agent Trap")

- `MC-1` — Observed loophole: Monolithic Single-Agent In-Place Repair. When late-stage Completeness Critic detects multiple cross-subsystem defects, missing features, or requirement gaps across the repository diff, the orchestrator assigns all repair tasks to a single agent or attempts sequential in-place fixes directly on the main thread. This causes context window exhaustion, hallucinated changes, cross-module regressions, loss of write scope isolation, and unbounded repair loops.
  - Structural countermeasure: Mandatory Fan-Back & Cascading Scope-Aware Replanning. When `critic:reject` is executed, the harness blocks single-agent in-place patching and requires `plan:replan`. The harness dynamically clusters findings by file paths into disjoint write scopes, commits Graph Revision $R \to R+1$, and compiles a new Repair Wave $R$ DAG. The coordinator must dispatch $2N + 1$ Tier 3 subagents (independent implementers and adversarial validators) in a parallel batch.
- `MC-2` — Observed loophole: Repair Self-Approval & Bypassed Gate Barriers. An implementer addressing critic findings bypasses independent adversarial validation or gate execution under the assumption that "the critic already flagged it, so quick edits are sufficient", causing unverified regressions to reach completion.
  - Structural countermeasure: Strict Validation Barriers & Monitored Execution. Every injected repair task must undergo independent validator lease, monitored execution (`run:exec`), and formal sign-off (`task:review`). Completion remains mechanically blocked until all repair tasks in the active wave reach `done` and a fresh critic reviews the whole repository diff.
- `MC-3` — Observed loophole: Context Contamination across Repair Waves. Repair subagents receive prior conversational debates, subjective implementer justifications, or unverified logs from previous failed iterations, leading to anchoring bias and recurring errors.
  - Structural countermeasure: Allowlisted Context Sanitization for Repair Packets. Repair task packets are compiled strictly from authoritative requirement IDs, structured finding records (`id`, `severity`, `observation`, `file_paths`, `remediation`, `revalidation`), and fresh git diffs. All subjective narratives and conversational histories are quarantined.
- `MC-4` — Observed loophole: Single Implementer Deployment Without Paired Validator (Violating the Triad Floor). An orchestrator dispatches an implementer without deploying a paired validator, assuming that validation can happen later or be handled by the coordinator. This causes self-grading, unverified assumptions, and unmonitored code commits.
  - Structural countermeasure: The Triad Floor & Atomic Implementer-Validator Pair Invariant. For any task $T$, the coordinator MUST deploy an atomic $(Implementer, Validator)$ pair simultaneously in a single batch `invoke_subagent` call, maintaining a minimum of 3 active agents (1 Coordinator + 1 Implementer + 1 Validator) even for sequential tasks.
- `MC-5` — Observed loophole: Premature First-Round Approval (Bypassing the Adversarial Gauntlet). A validator immediately approves a task submission on Round 1 because basic unit tests pass, ignoring edge cases, boundary inputs, zero-any checks, and negative tests.
  - Structural countermeasure: Mandatory 3-Round Adversarial Rejection Gauntlet. The harness mandates that Rounds 1, 2, and 3 MUST be rejected with structured pushback findings, requiring the implementer to prove robustness against extreme inputs, typing strictness, and architectural depth before conditional approval in Round 4+.

