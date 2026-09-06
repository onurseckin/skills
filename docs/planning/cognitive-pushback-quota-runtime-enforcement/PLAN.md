# Plan: Cognitive Pushback Quota Runtime Enforcement & Gate Hardening

## 1. Executive Summary & Defect Topology

- **Defect ID**: `defect-cognitive-pushback-quota-runtime-gap`
- **Error Code**: `COGNITIVE_PUSHBACK_QUOTA_RUNTIME_GAP`
- **Severity**: Critical
- **Root Cause**: Quota enforcement currently exists strictly as a post-hoc diagnostic in `pushback-quotas-engine.ts` inside `runDoctor`. Core runtime lifecycle transitions (specifically `finishTask` in `finish-task.ts`) transition tasks to `done` without asserting cognitive pushback quotas. In `task-review-support.ts`, `minProbes` defaults to 1 when unconfigured instead of the mandatory quota of 5. In addition, `validatorProfile.evaluate` in `sentinel/profiles/tier3/validator.ts` checks only shell execution and source mutation prohibitions, completely omitting cognitive pushback quota verification.

---

## 2. Mathematical Strategic Priority & Invariant Specifications

### Invariant 1: Mandatory Pushback Quota Before Task Finish

No task may transition to `done` in `finishTask` unless it satisfies the cognitive pushback quota:
$$\text{Probes}(T) \ge \min(\text{MinProbes}, 5) \quad \land \quad \text{Pushbacks}(T) \ge \min(\text{MinPushbacks}, 5)$$
If quotas are unmet, `finishTask` must throw `HarnessError("INVALID_STATE", "Cognitive deepening protocol not satisfied: task has insufficient probes/pushbacks")`.

### Invariant 2: Default Probe Quota Elevation

In `task-review-support.ts`, `reviewPolicyFor` must default `minProbes` to `MIN_ADVERSARIAL_PROBES` (5) rather than 1 when `min_adversarial_probes` is unconfigured.

### Invariant 3: Sentinel Cognitive Quota Auditing

In `sentinel/profiles/tier3/validator.ts`, `validatorProfile.evaluate` must inspect the active task's cognitive rounds and flag `VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS` if task validation is attempted without the requisite communication rounds.

---

## 3. Work Breakdown Structure (WBS) & Exact File Anchors

### Task 1: Runtime Gate Enforcement in `finish-task.ts`

- **Target File**: `olt/scripts/src/workflow/gates/finish-task.ts`
- **Specification**:
  - Import `MIN_ADVERSARIAL_PROBES`, `MANDATORY_COGNITIVE_PUSHBACKS`, and probe/pushback counting helpers (or implement direct quota verification against task and events).
  - Verify that `task.adversarial_probes` or review rounds meet the threshold prior to `transition(task, "done", ...)`.
  - Throw `HarnessError("INVALID_STATE", ...)` if unfulfilled.

### Task 2: Default Probe Quota Calibration in `task-review-support.ts`

- **Target File**: `olt/scripts/src/cli/commands/task-review-support.ts`
- **Specification**:
  - Import `MIN_ADVERSARIAL_PROBES` from `../../reporting/doctor/pushback-quotas-engine.ts`.
  - In `reviewPolicyFor`, default `minProbes` to `MIN_ADVERSARIAL_PROBES` (5) instead of 1.

### Task 3: Sentinel Validator Profile Cognitive Quota Evaluation

- **Target File**: `olt/scripts/src/sentinel/profiles/tier3/validator.ts`
- **Specification**:
  - In `validatorProfile.evaluate`, evaluate context probe and review telemetry.
  - If review action lacks required cognitive probe depth, emit violation `VALIDATOR_INSUFFICIENT_PUSHBACK_ROUNDS`.

### Task 4: Unit Test Suite & Regression Verification

- **Target File**: `tests/workflow/gates/finish-task-pushback-quotas.test.ts`
- **Specification**:
  - Verify `finishTask` enforces quota >= 5 and rejects tasks with 0 probes.
  - Verify `task-review-support.ts` defaults to 5.
  - Verify `sentinel` validator profile flags deficient pushbacks.

---

## 4. Concurrency & Execution Plan

- **Worktree**: `.olt/worktrees/track-pushback-quota`
- **Execution Tier**: Tier 3 Implementer + Mechanic Validator
- **Quota Check**: Mandatory pre-flight quota gate verified (> 10.0%).
