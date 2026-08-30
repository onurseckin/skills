# Certified Implementation Plan: Unified Master Dashboard & Sugiyama DAG Engine

> **Tracking ID:** `track-15-unified-master-dashboard-and-sugiyama-dag`  
> **Status:** `COMPLETED & ARCHIVED`  
> **Target Subsystems:** `olt/scripts/src/reporting/`, `olt/scripts/src/reporting/notifications/`, `olt/scripts/src/reporting/sugiyama-dag/`, `olt/scripts/src/reporting/unified/`, `olt/scripts/src/graph/`  
> **Author:** `plan_drafter_05`  
> **Implementers:** `implementer_15`, `implementer_16`  
> **Validator:** `validator_08` (5/5 Adversarial Critique & Verification Rounds Complete)  
> **Specification Version:** `1.0.0-PROD`

---

## Level 1: Problem Statement, Defect IDs, Prompt Bytes Grounding & Root Cause Analysis

### 1.1 Defect IDs, Backlog Items & High-Level Problem Formulation

- **`defect-reporting-unified-sections-missing-sugiyama-export`**:
  Diagnostic runners, CLI dashboard commands, and subagent harnesses attempting to consume structured visual reports encounter missing interface exports or ambiguous wildcard re-exports across `olt/scripts/src/reporting/index.ts`, `olt/scripts/src/reporting/unified/types.ts`, and `olt/scripts/src/reporting/dashboard.ts`. Furthermore, monolithic file sprawl in `olt/scripts/src/graph/sugiyama.ts` (322 physical LOC) exceeds repository density budgets ($\le 300$ LOC/file) while duplicating algorithms present in the modular `olt/scripts/src/reporting/sugiyama-dag/` subpackage.
- **`fb-1787971784118-1aghp` & `task-1-fb-1787971784118-1aghp`**:
  Mandatory cognitive pushback quotas (`MANDATORY_COGNITIVE_PUSHBACKS = 5`) and minimum adversarial probe quotas (`MIN_ADVERSARIAL_PROBES = 5`) were disconnected from master dashboard telemetry and lifecycle task tables. Tasks could transition to `completed` / `satisfied` without the dashboard highlighting quota deficits, allowing substandard outputs to pass unflagged.
- **`fb-1788020500000-os-push-audio-notification-engine`**:
  Multi-platform OS push notification and audio chime notification engine (`darwin`, `linux`, `win32`, `headless`) requires bulletproof process detachment (`detached: true`, `unref()`), safe test environment isolation (`isTestEnvironment()`), bounded rate limiting (sliding window max 30 per 60,000ms), and 100% explicit named facade re-exports in `olt/scripts/src/reporting/notifications/index.ts` and `olt/scripts/src/reporting/index.ts`.

---

## Level 2: Architectural Constraints & Invariants

1. **Physical LOC Budget ($\le 300$ LOC/file)**:
   - `olt/scripts/src/reporting/dashboard.ts`: 276 LOC ($\le 300$)
   - `olt/scripts/src/graph/sugiyama.ts`: 224 LOC ($\le 300$)
   - `olt/scripts/src/reporting/index.ts`: 175 LOC ($\le 300$)
   - `olt/scripts/src/reporting/notifications/index.ts`: 43 LOC ($\le 300$)
   - `olt/scripts/src/reporting/notifications/dispatchers/dispatcher-registry.ts`: 101 LOC ($\le 300$)
   - `tests/unit/reporting/dashboard.test.ts`: 216 LOC ($\le 300$)
2. **Directory Density Budget ($\le 10$ files/directory)**: All directories $\le 10$ files.
3. **Named Facades (0 Wildcard `export *`)**: Exactly 0 wildcard re-exports allowed.
4. **Zero `any` & Strict Type Safety**: 0 `any`, 0 compiler suppressions (`@ts-ignore`, `@ts-expect-error`).
5. **Zero Code Comments**: Source code files contain 0 comments.

---

## Level 3: 8-Vector Expansion Matrix

| Vector                       | Edge Condition / Failure Mode                                                                                    | Hardened Mitigation & Assertion Formula                                                                                                                                                                                                                                                            |
| :--------------------------- | :--------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **V1: EMPTY_PAYLOAD**        | `generateDashboardReport("", "", [], [])` called with empty task and agent lists                                 | Returns valid empty dashboard with `totalTasks: 0`, `totalWork: 0`, `asciiDiagram: "(Empty DAG)"`, and empty table placeholders without runtime error.                                                                                                                                             |
| **V2: TIMEOUT_STAGNATION**   | Audio chime or OS push notification command hangs on unresponsive system binary (`afplay`/`paplay`/`powershell`) | Subprocess spawned detached with `stdio: "ignore"` and unreferenced immediately via `child.unref()`. Spawner returns within $<5\text{ms}$.                                                                                                                                                         |
| **V3: CONCURRENCY_MUTATION** | Rapid burst of notifications triggered across parallel worker threads                                            | `NotificationDispatcherRegistry` enforces a sliding window rate limiter ($\le 30$ events per $60,000\text{ms}$). Events exceeding capacity return `{ delivered: false, error: "Notification rate limit exceeded" }`.                                                                               |
| **V4: HOST_BOUNDARY**        | Execution on unsupported host platform (e.g. AIX, Solaris, Cygwin) or headless CI container                      | `getDispatcher` gracefully falls back to `HeadlessNotificationDispatcher`, safely returning `{ delivered: false, platform: target }` without throwing.                                                                                                                                             |
| **V5: STATE_TRANSITION**     | Task marked as `completed` / `satisfied` without meeting mandatory pushback or probe quotas                      | Invariant Formula: $\text{isQuotaDeficit}(t) = (t.\text{status} \in \{\text{"done"}, \text{"completed"}, \text{"satisfied"}\}) \land ((t.\text{pushes} ?? 0) < 5 \lor (t.\text{probes} ?? 0) < 5)$. Flagged with `⚠️ [DEFICIT: P<5/Pr<5]` in telemetry and counted in `metrics.quotaDeficitTasks`. |
| **V6: TYPE_INVARIANT**       | Type divergence between `graph/sugiyama.ts` and `reporting/sugiyama-dag/types.ts`                                | Canonical interfaces in `reporting/sugiyama-dag/types.ts` unified and re-exported through `reporting/unified/types.ts` and `reporting/index.ts`.                                                                                                                                                   |
| **V7: CLI_TELEMETRY**        | Terminal width narrower than default (e.g. 60 columns)                                                           | `renderTaskSummaryTable` and `renderAgentMatrixSection` apply character slicing and column width bounding to prevent terminal text overflow.                                                                                                                                                       |
| **V8: ADVERSARIAL_GATE**     | Missing audio file or corrupted file path provided to `playCompletionChime`                                      | Wrapped in fail-safe `try/catch`; returns `{ delivered: false, error: ... }` without crashing the master orchestrator.                                                                                                                                                                             |

---

## Level 4: Execution & Verification Summary

### Implementation Recap

- **Wave 1**:
  - `olt/scripts/src/reporting/dashboard.ts`: Implemented `quotaDeficitTasks` and `renderMicroCycleTelemetry` deficit formatting.
  - `olt/scripts/src/graph/sugiyama.ts`: Streamlined matrix rendering and algorithm delegation to 224 LOC ($\le 300$).
  - `olt/scripts/src/reporting/notifications/dispatchers/dispatcher-registry.ts`: Added 100-entry history capping and sliding window rate limiting.
- **Wave 2**:
  - `olt/scripts/src/reporting/index.ts`: Converted 37 wildcard `export *` statements to 100% explicit named exports.
- **Wave 3**:
  - `tests/unit/reporting/dashboard.test.ts`: Added AGP-1 and AGP-2 assertions (15/15 PASS).
  - Executed all 5 verification gates.

### Verification Results

| Gate ID    | Target Command                                                                                                              | Scope                                    | Result                  |
| :--------- | :-------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------- | :---------------------- |
| **GATE-1** | `bun x tsc --noEmit`                                                                                                        | Strict Typecheck (0 any, 0 suppressions) | PASS (0 errors)         |
| **GATE-2** | `bun test tests/unit/reporting/dashboard.test.ts`                                                                           | Unit: Dashboard & Telemetry              | PASS (15 tests)         |
| **GATE-3** | `bun test tests/unit/graph/sugiyama.test.ts tests/unit/reporting/sugiyama-dag.test.ts`                                      | Unit: Sugiyama Layout & Visualizer       | PASS (34 tests)         |
| **GATE-4** | `bun test tests/unit/reporting/notifications/system-notifier.test.ts tests/unit/reporting/notifications/formatters.test.ts` | Unit: OS Notifications & Audio Chime     | PASS (16 tests)         |
| **GATE-5** | `bun test tests/unit/reporting/core/reporting.test.ts`                                                                      | Master Reporting Facade & Status Handoff | PASS (8 tests)          |
| **GATE-6** | `bun scripts/modularity/check.ts --mode ratchet`                                                                            | Modularity Ratchet Verification          | PASS (0 new violations) |

---

## Level 5: 5-Round Validator Sign-Off Log

- **Validator**: `validator_08` (`723d782b-e8b9-41dd-8ed1-a4132b836ab0`)
- **Review Rounds**:
  - Round 1 (Contracts & Architecture): PASS
  - Round 2 (Boundary & Error Handling): PASS
  - Round 3 (Density & Cleanliness): PASS
  - Round 4 (Coverage & Performance): PASS
  - Round 5 (Final Certification): CERTIFIED PASS
