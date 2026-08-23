# Plan 16: 2-Key Validator Pairing & Review Binding

## 1. Problem Statement & Context

In the 2-Key Orchestration model, every implementation task requires independent dual-key verification before completion:

- **Key 1 (Implementer)**: Responsible for implementation within a strictly leased disjoint write scope and providing file-scoped test execution receipts.
- **Key 2 (Paired Cognitive Validator)**: Dedicated to independent, adversarial Socratic review of the code diff, verifying that invariants hold, zero `any` or suppressions were introduced, and that acceptance criteria are genuinely satisfied.

### Observed Systemic Failure Mode:

During multi-lane execution runs, several integrity breakdowns occur:

1. **Uneven / Missing Pairing**: Implementers claim leases without a dedicated, named Validator being assigned to the task.
2. **Review Identity Spoofing**: `task:review` or `task:validate-start` is called by arbitrary agents or supervisors rather than the specific 1:1 paired validator assigned to the task.
3. **Superficial Rubber-Stamping**: Validators occasionally approve tasks without conducting substantive Socratic inquiry or generating concrete critique receipts.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Disconnected Lease State in `state.json`**:
   - `task.lease` previously tracked the implementer's identity, but lacked an immutable binding to the assigned paired validator's session.
2. **Missing Reviewer Authorization Gate**:
   - `task:review` verified that the task was in `submitted` or `validating` status, but did not strictly enforce that `caller.agent_id === task.assigned_validator_id`.
3. **Cognitive Validator Command Temptation**:
   - When Validators want to double-check a type error, they frequently attempt to run `tsc` or `bun test` rather than performing static code analysis and requesting the implementer to provide execution evidence via in-lease micro-cycles.

---

## 3. Scope of the Problem & Affected Subsystems

- **Validation Commands**: `olt/scripts/src/cli/commands/task-review.ts`, `task-validate-start.ts`, `task-reject.ts`.
- **Review Engine**: `olt/scripts/src/reporting/socratic-validator.ts`, `olt/scripts/src/packets/command-authority.ts`.
- **Lease State Schema**: `olt/scripts/src/core/contracts/capsule.ts`.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Strict 1:1 Immutable Pairing**:
   - A task cannot enter `leased` state without an explicitly assigned, authenticated Cognitive Validator grant bound to the task ledger.
2. **Cryptographic Review Binding**:
   - Only the designated paired Validator can issue review verdicts (`task:review --decision approve/reject`); attempts by other agents or supervisors must be rejected with `AUTHENTICATION_FAILURE`.
3. **Substantive Socratic Critique Enforcement**:
   - Approvals must require non-empty, substantive critique and verification proofs; unevidenced rubber-stamping must be rejected by the review gate.
