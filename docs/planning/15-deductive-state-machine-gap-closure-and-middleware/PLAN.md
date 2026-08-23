# Plan 15: Deductive State Machine Universal Middleware & Cumulative Phase Gating

## 1. Problem Statement & Context

The long-task orchestration harness relies on a cumulative, multi-phase lifecycle:

- **Phase 0 (Intake & Capsule Memory)**: Verbatim prompt hashing and capsule state allocation.
- **Phase 1 (Planning & Sealing)**: Disjoint write scopes, non-cyclic DAG construction, and disk persistence (`planning/plan.md`, `planning/dag.txt`).
- **Phase 2 (Role Identity & Grants)**: Session token registration and caller authentication.
- **Phase 3 (Dependency & Lease Enforcement)**: Inbound DAG dependency satisfaction and 1:1 validator pairing.
- **Phase 4 (Execution Evidence & AST Invariants)**: Cryptographic command receipts in `evidence/` and static type safety.
- **Phase 5 (2-Key Review & Sealing)**: Independent validator Socratic critique and run completion.

### Observed Systemic Failure Mode:

While the initial `DeductiveStateMachine` and `CumulativePhaseInvariantEngine` classes were integrated into `execute.ts`, several critical gaps remain:

1. Some CLI commands allow execution if invoked with specific direct flags, bypassing state validation.
2. Caller session resolution (`session-registry.ts`) is not universally applied as a global pre-command middleware across every command domain.
3. Mid-flight dynamic plan enhancements (`plan:add`, `plan:enhance`) must be cleanly distinguished from invalid phase bypasses so that legitimate dynamic expansion is permitted while out-of-order execution is strictly blocked.

---

## 2. Root Cause Analysis & Behavioral Dynamics

1. **Fragmented Command Handlers**:
   - Commands historically performed ad-hoc validations inside their individual handler functions rather than passing through a unified, centralized middleware pipeline.
2. **Inconsistent State-Machine Coverage**:
   - Domains like `queue:*`, `doctor:*`, `finding:*`, and `critic:*` need precise mapping within the cumulative phase hierarchy.
3. **Session Token Decoupling**:
   - `execute.ts` needs a single, unified caller identity resolution step that binds the active OS PID / workspace `.session.json` to the command before any handler executes.

---

## 3. Scope of the Problem & Affected Subsystems

- **Core CLI Execution**: `olt/scripts/src/cli/execute.ts`, `olt/scripts/src/cli/options.ts`.
- **Deductive Engine**: `olt/scripts/src/cli/execute.ts` (`DeductiveStateMachine`, `CumulativePhaseInvariantEngine`).
- **Authority & Sessions**: `olt/scripts/src/authority/session-registry.ts`.
- **State Store**: `olt/scripts/src/engine/store/`.

---

## 4. Key Invariants & Acceptance Criteria

Future orchestrators, planners, and implementers designing the solution for this plan must ensure the following non-negotiable invariants are met:

1. **Universal Pre-Command Middleware**:
   - 100% of CLI commands must pass through unified caller identity derivation and cumulative phase verification before any handler logic runs.
2. **Strict Phase Invariant Gating**:
   - A command belonging to a lower phase must be mathematically blocked with `INVALID_STATE` if any higher prerequisite phase in capsule memory is incomplete.
3. **Safe Mid-Flight Plan Enhancement**:
   - Dynamic plan expansion (`plan:add`, `plan:enhance`) during active execution must remain fully supported, allowing the graph to grow forward safely while preventing execution of uncompiled nodes.
