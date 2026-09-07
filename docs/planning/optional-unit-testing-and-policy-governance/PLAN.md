# Optional Unit-Testing & Multi-Repository Policy Governance Master Plan

> **Tracking ID:** `plan-optional-unit-testing-and-policy-governance`  
> **Backlog Candidate:** `fb-optional-unit-testing-and-policy-governance`  
> **Priority:** `P1_USER_MANDATE`  
> **Status:** `ADMITTED - PHASE 1 ARCHITECTURAL BLUEPRINT`  
> **Target Subsystems:** `policy/`, `reporting/doctor/`, `cli/commands/`, `sentinel/`, `scripts/testing/`, `lefthook.yml`  
> **Author:** Tier 0 Strategic Mind Supervisor (`mind-gen-8`)  
> **Date:** 2026-09-06

---

## 1. Executive Summary & Root Cause Analysis

### 1.1 Context & Problem Statement

The OLT harness was historically designed with a hardcoded assumption that every target repository is a TypeScript/JavaScript project featuring an active unit test suite running under Bun or Node.js. In the current substrate:

1. **Mandatory Schema Constraint:** [`olt/scripts/src/policy/types/index.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/policy/types/index.ts) declares `readonly test_runner: TestRunnerPolicy;` as a strictly required field on `RepoPolicy`, where `TestRunnerPolicy` requires non-empty strings for `default_command`, `targeted_pattern`, and `full_suite_command`.
2. **Forced Synthetic Defaults:** In [`olt/scripts/src/policy/schema/workflow-schema.ts:51`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/policy/schema/workflow-schema.ts#L51), omitting `test_runner` or passing `undefined` forcibly injects `"bun test"`. If a user supplies `null`, `false`, or `{ enabled: false }`, schema parsing throws a fatal `HarnessError("INTEGRITY", "must be an object")` or fails required string validations.
3. **Rigid Doctor Certification Gate:** In [`olt/scripts/src/reporting/doctor/certify-command.ts:34`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/certify-command.ts#L34), `certify` demands that `--write-scope` must name a `.test.ts` or `.spec.ts` file so the default runner can execute it. Pure documentation, configuration, research, or prototyping repositories fail doctor verification immediately.
4. **Task Lifecycle Friction:** In [`olt/scripts/src/cli/commands/task-brief.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/task-brief.ts) and [`olt/scripts/src/cli/commands/task-review.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/cli/commands/task-review.ts), gates and check IDs mandate unit test execution receipts. A task touching markdown, assets, or non-test code is blocked from landing if no test suite exists.
5. **Unconditional Git Pre-Commit/Pre-Push Hooks:** [`lefthook.yml`](file:///Users/onurseckinsenoglu/repos/skills/lefthook.yml) runs `bun run test:changed` and `bun run test:coverage` on every commit and push. In repositories where testing is not configured or applicable, Lefthook fails on push, deadlocking developer workflows.

---

## 2. Core Architectural Pillars & Desired State

```text
               ┌─────────────────────────────────────────┐
               │           .olt/policy.json              │
               │   "test_runner": { "enabled": false }   │
               │            (or omitted / null)          │
               └────────────────────┬────────────────────┘
                                    │
               ┌────────────────────┴────────────────────┐
               ▼                                         ▼
┌──────────────────────────────┐        ┌──────────────────────────────┐
│       TESTING ENABLED        │        │       TESTING DISABLED       │
├──────────────────────────────┤        ├──────────────────────────────┤
│ • Mandatory unit test runs   │        │ • Test execution skipped     │
│ • Coverage >= 90% enforced   │        │ • No test receipts demanded  │
│ • Task review requires tests │        │ • Task review passes on diff │
│ • Doctor verifies test gates │        │ • Doctor reports INFO state  │
│ • Lefthook runs test suites  │        │ • Lefthook skips with exit 0 │
└──────────────────────────────┘        └──────────────────────────────┘
```

### Pillar 1: Tri-State Test Capability Governance

The policy schema must support three explicit states for unit testing:

1. **`ENABLED`**: `test_runner.enabled === true` (or object with valid commands). Full suite execution, targeted test running, and coverage enforcement active.
2. **`DISABLED`**: `test_runner === null`, `test_runner === false`, or `test_runner: { enabled: false }`. All test execution gates, receipts, and pre-push hooks are gracefully skipped.
3. **`AUTO_DETECT`**: When omitted from `policy.json`, the toolchain scanner inspects the repo for test files (`*.test.ts`, `*.spec.ts`, `*_test.go`, `test_*.py`, etc.) and test scripts. If no tests are detected, testing is treated as **DISABLED** without raising an error or injecting synthetic test commands.

### Pillar 2: Friction-Free Task Lifecycle

- **Implementer Briefings:** `task:brief` suppresses test command recommendations when tests are disabled.
- **Task Review & Acceptance:** `task:review` evaluates code correctness, cognitive probes, and typechecking without requiring test run command receipts.
- **Doctor Certification:** `doctor:certify` accepts non-test write scopes when test runner is disabled.

### Pillar 3: Zero-Bypass Clean Hook Grace

In `scripts/testing/test-runner.ts` and `scripts/testing/test-changed.ts`:

- Check repository policy before launching test subshells.
- If `test_runner` is disabled, output a structured diagnostic:
  `[test] Unit testing is disabled in repository policy (.olt/policy.json); skipping test suite.`
- Exit with return code `0`.
- Lefthook hooks pass on merit with zero warnings, zero bypasses (`LEFTHOOK=0` remains strictly banned).

---

## 3. Detailed Specification & Interface Changes

### 3.1 Policy Schema (`olt/scripts/src/policy/types/index.ts`)

```typescript
export interface TestRunnerPolicy {
  readonly enabled?: boolean;
  readonly default_command?: string | undefined;
  readonly targeted_pattern?: string | undefined;
  readonly full_suite_command?: string | undefined;
  readonly timeout_ms?: number | undefined;
}

export interface RepoPolicy {
  readonly schema_version: number;
  readonly ecosystem: RepoEcosystem;
  readonly package_manager?: PackageManager | undefined;
  readonly skill_home_repo_root?: string | undefined;
  readonly test_runner?: TestRunnerPolicy | null | undefined;
  // ... remaining fields unchanged
}
```

### 3.2 Schema Parsing & Normalization (`olt/scripts/src/policy/schema/workflow-schema.ts`)

```typescript
export function parseTestRunner(raw: unknown, p: string): TestRunnerPolicy | null {
  // Case 1: Explicitly disabled or null
  if (raw === null || raw === false) {
    return { enabled: false };
  }
  // Case 2: Omitted (auto-detection mode)
  if (raw === undefined) {
    return { enabled: false }; // Auto-detect handles default if tests exist
  }
  if (!isRecord(raw)) integrity(p, "must be an object, boolean, or null");
  assertAllowedKeys(raw, TEST_RUNNER_KEYS, p);

  const enabled = raw["enabled"] !== undefined ? reqBool(raw["enabled"], `${p}.enabled`) : true;
  if (!enabled) {
    return { enabled: false };
  }

  return {
    enabled: true,
    default_command: reqString(raw["default_command"] ?? "bun test", `${p}.default_command`),
    targeted_pattern: reqString(
      raw["targeted_pattern"] ?? "bun test <path>",
      `${p}.targeted_pattern`,
    ),
    full_suite_command: reqString(
      raw["full_suite_command"] ?? "bun test",
      `${p}.full_suite_command`,
    ),
    ...(raw["timeout_ms"] !== undefined
      ? { timeout_ms: reqInt(raw["timeout_ms"], `${p}.timeout_ms`, 1) }
      : {}),
  };
}
```

### 3.3 Helper Function: `isTestingEnabled(policy?: RepoPolicy): boolean`

Exported from `olt/scripts/src/policy/index.ts`:

```typescript
export function isTestingEnabled(policy?: RepoPolicy | undefined): boolean {
  if (!policy || !policy.test_runner) return false;
  if (policy.test_runner.enabled === false) return false;
  return Boolean(
    policy.test_runner.default_command && policy.test_runner.default_command.trim().length > 0,
  );
}
```

---

## 4. Subsystem Touchpoints & Affected Modules

| Component                | File Path                                               | Modification Scope                                                      |
| :----------------------- | :------------------------------------------------------ | :---------------------------------------------------------------------- |
| **Policy Types**         | `olt/scripts/src/policy/types/index.ts`                 | Make `test_runner` optional/nullable; add `enabled?: boolean`.          |
| **Workflow Schema**      | `olt/scripts/src/policy/schema/workflow-schema.ts`      | Support boolean/null `test_runner`; handle `{ enabled: false }`.        |
| **Policy Validator**     | `olt/scripts/src/policy/schema/validator.ts`            | Accommodate optional test runner in policy validation.                  |
| **Policy Index**         | `olt/scripts/src/policy/index.ts`                       | Export `isTestingEnabled` utility helper.                               |
| **Toolchain Scanner**    | `olt/scripts/src/policy/generator/toolchain-scanner.ts` | If no test runner found, set `enabled: false` instead of fake defaults. |
| **Policy Doctor**        | `olt/scripts/src/reporting/doctor/policy-doctor.ts`     | Report `TESTING_DISABLED (INFO)` instead of `POLICY_CORRUPT`.           |
| **Certify Command**      | `olt/scripts/src/reporting/doctor/certify-command.ts`   | Skip test-file requirement when testing is disabled.                    |
| **Policy Coverage**      | `olt/scripts/src/mind/governance/policy-coverage.ts`    | Do not deduct score when testing is intentionally disabled.             |
| **Task Brief**           | `olt/scripts/src/cli/commands/task-brief.ts`            | Suppress test recommendations when testing is disabled.                 |
| **Task Review**          | `olt/scripts/src/cli/commands/task-review.ts`           | Permit task approval without requiring test command receipts.           |
| **Test Runner Wrapper**  | `scripts/testing/test-runner.ts`                        | Check policy; exit 0 gracefully when disabled.                          |
| **Test Changed Wrapper** | `scripts/testing/test-changed.ts`                       | Check policy; exit 0 gracefully when disabled.                          |

---

## 5. Phased Implementation Plan & Delegation Strategy

Mind (Tier 0) maintains strict adherence to **The Three Hard Zeros**: Mind authors this plan and manages task queues, but delegates 100% of source edits and test executions to leased Tier 3 Implementers and Validators via Tier 1 Orchestrator.

### Phase 1: Policy Domain Core (Track `track-policy-optional-tests`)

- **Assigned Subagent:** `implementer_policy` (supervised by `orchestrator_policy`)
- **Deliverables:**
  - Update `olt/scripts/src/policy/types/index.ts` and `schema/workflow-schema.ts`.
  - Add `isTestingEnabled` helper in `policy/index.ts`.
  - Update `toolchain-scanner.ts` and `validator.ts`.
  - Author comprehensive unit tests in `tests/policy/optional-testing.test.ts`.

### Phase 2: Doctor & Gate Engines

- **Assigned Subagent:** `implementer_doctor`
- **Deliverables:**
  - Update `policy-doctor.ts` to log informational findings for disabled testing.
  - Update `certify-command.ts` to respect `isTestingEnabled`.
  - Update `policy-coverage.ts` to ignore disabled test runner in scoring.

### Phase 3: Task Review & Lifecycle Integration

- **Assigned Subagent:** `implementer_task`
- **Deliverables:**
  - Update `task-brief.ts` and `task-review.ts` to bypass test check mandates when testing is disabled.
  - Update `scripts/testing/test-runner.ts` and `scripts/testing/test-changed.ts` to exit 0 gracefully.

### Phase 4: Socratic Adversarial Probes & Cognitive Validation

- **Assigned Subagent:** `validator_policy`
- **Deliverables:**
  - Run $\ge 10$ adversarial probes verifying:
    1. `test_runner: null` parses cleanly and disables tests.
    2. `test_runner: false` parses cleanly and disables tests.
    3. `test_runner: { enabled: false }` parses cleanly.
    4. Missing `test_runner` in doc-only repo does not fail doctor.
    5. `lefthook` test command exits 0 without error when disabled.
    6. Enabled test runner still strictly enforces 90% coverage gate.

### Phase 5: Landing onto Main

- **Assigned Subagent:** `publisher_policy`
- **Action:** Land via `bun ./olt/scripts/harness.ts worktree:land --track track-policy-optional-tests`.

---

## 6. Socratic Cognitive Validation Probes

| Probe ID                      | Target Condition                                                  | Expected Behavior                                                                   |
| :---------------------------- | :---------------------------------------------------------------- | :---------------------------------------------------------------------------------- |
| `probe-test-null`             | `test_runner: null` in policy                                     | Parsed as `enabled: false`, doctor reports HEALTHY, `isTestingEnabled() === false`. |
| `probe-test-false`            | `test_runner: false` in policy                                    | Parsed as `enabled: false`, doctor reports HEALTHY.                                 |
| `probe-test-disabled-obj`     | `test_runner: { "enabled": false }`                               | Parsed as `enabled: false`, no command validations required.                        |
| `probe-test-enabled-valid`    | `test_runner: { "enabled": true, "default_command": "bun test" }` | Parsed as `enabled: true`, normal execution preserved.                              |
| `probe-test-empty-cmd`        | `test_runner: { "default_command": "" }`                          | Treated as disabled, does not crash with empty string error.                        |
| `probe-task-review-bypass`    | `task:review` with testing disabled                               | Task approved without requiring test execution check ID.                            |
| `probe-certify-non-test`      | `doctor:certify` on markdown file when testing disabled           | Certification succeeds without demanding `.test.ts` file.                           |
| `probe-test-runner-exit-zero` | Execute `bun run test:coverage` when testing disabled             | Exits code 0 with message `[test] Unit testing disabled by repository policy`.      |

---

## 7. Invariant Compliance Checklist

- [x] **Strict 3 Hard Zeros:** Mind authors architectural plan and manages queue; zero direct edits to repository source code or test executions on Mind thread.
- [x] **Host-Tool Interlock:** All agent communications conducted via POSIX mailbox IPC (`msg:send`).
- [x] **Pre-Commit / Pre-Push Merit:** All hooks must pass on merit without bypass flags (`LEFTHOOK=0` and `--no-verify` prohibited).
- [x] **Hermetic Worktree Execution:** All changes implemented in dedicated worktree `track-optional-unit-testing`.
