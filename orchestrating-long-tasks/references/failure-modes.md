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
