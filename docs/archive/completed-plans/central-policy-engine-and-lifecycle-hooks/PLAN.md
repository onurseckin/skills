# Certified Implementation Plan: Central Authoritative Policy Engine, Event Lifecycle Hooks & Fleet Concurrency Safeguards (ARCHIVED)

> **Tracking ID:** `track-13-central-policy-engine-and-lifecycle-hooks`  
> **Status:** `ARCHIVED & COMPLETED`  
> **Target Subsystems:** `olt/scripts/src/policy/`, `olt/scripts/src/engine/runner/`, `olt/scripts/src/telemetry/`, `olt/scripts/src/mind/`  
> **Implementers:** `implementer_14` (`ff63b8cd-30d7-4ab2-845c-6dd4a992f8bc`), `implementer_13` (`21358eb2-d4d0-4ecc-87fb-9e0dd8ce2be9`)  
> **Validator:** `validator_07` (`62c9405c-d1c9-4a10-bc46-b1aecf1e2416`)  
> **Certification:** 5/5 Adversarial Review Rounds Complete (PASS)  
> **Branch:** `feat/track-13-central-policy`  
> **Commit Hash:** `5df07c3c`

---

## 1. Problem Statement, Grounding & Root Cause Analysis

### 1.1 Defect IDs & Task IDs

- `defect-quota-circuit-breaker-latency-detection`: Telemetry quota evaluation reliably detects quota exhaustion ($\le 10\%$), handles offline or unmeasured platform probes with fail-closed safety (`QUOTA_UNKNOWN_CIRCUIT_BROKEN`), computes auto-wake timeouts with a deterministic $+60\text{s}$ safety buffer, and emits structured wrap-up directives to active agents. Command registry aliases (`quota:circuit-break`, `circuit-breaker:check`) registered on `quota:check`.
- `defect-unbounded-subagent-spawning-concurrency-cap`: Fleet concurrency hard cap ($\le 50$ subagents), strict FIFO request queuing, slot receipt lifecycle management, and timeout-based request rejection (`LOCK_TIMEOUT`).
- Backlog: `fb-central-repo-policy-json-engine`: Authoritative `.olt/policy.json` (with fallback to `olt/policy.json`) as the single source of truth with atomic POSIX I/O, SHA-256 drift detection, and ecosystem auto-generation.
- Backlog: `fb-1788021200000-policy-event-lifecycle-hooks-engine`: Event-driven lifecycle hooks engine executing parameterized shell commands on key lifecycle events (`on_wave_complete` / `POST_PHASE`, `on_release_push` / `POST_PUSH`, `on_task_completion` / `POST_TASK_SUBMIT`, `on_task_validate` / `POST_TASK_VALIDATE`, `on_defect_resolved` / `ON_DEFECT_RESOLVED`) with variable interpolation, non-blocking execution, and alias mapping.
- Backlog: `fb-1788019800000-max-50-agent-cap`: Fleet-wide hard limit of $\le 50$ active concurrent subagents across all operational tiers.
- Task: `task-3-fb-central-repo-policy-json-engine`: Unified integration, verification, and certification of the central policy engine, lifecycle hooks, concurrency cap, and quota circuit breaker.

---

## 2. Architectural Constraints & Invariants

1. **Strict LOC Budget ($\le 300$ LOC/file):**
   - `olt/scripts/src/policy/repo-policy.ts`: 247 LOC ($\le 300$).
   - `olt/scripts/src/policy/policy-enforcer.ts`: 256 LOC ($\le 300$).
   - `olt/scripts/src/policy/hooks/lifecycle-hooks-engine.ts`: 199 LOC ($\le 300$).
   - `olt/scripts/src/policy/hooks/lifecycle-hooks.ts`: 60 LOC ($\le 300$).
   - `olt/scripts/src/policy/index.ts`: 165 LOC ($\le 300$).
   - `olt/scripts/src/engine/runner/subagent-pool.ts`: 222 LOC ($\le 300$).
   - `olt/scripts/src/telemetry/circuit-breaker.ts`: 172 LOC ($\le 300$).
   - `olt/scripts/src/telemetry/circuit-breaker-evaluator.ts`: 283 LOC ($\le 300$).
2. **Directory Density Limit ($\le 10$ files/dir):**
   - `olt/scripts/src/policy/`: 8 direct files ($\le 10$).
   - `olt/scripts/src/policy/hooks/`: 5 direct files ($\le 10$).
   - `olt/scripts/src/engine/runner/`: 4 direct files in root ($\le 10$).
   - `olt/scripts/src/telemetry/`: 8 direct files ($\le 10$).
3. **Named Facades (0 Wildcard `export *`):** 100% explicitly named symbols.
4. **Zero Any Invariant:** 0 implicit or explicit `any`, 0 compiler suppressions.
5. **Zero Code Comments:** Production source files contain 0 comments.
6. **Fail-Closed Security Guarantee:** Missing policies fall back to safe templates; corrupt configurations throw `HarnessError("INTEGRITY")`; unmeasured telemetry triggers `QUOTA_UNKNOWN_CIRCUIT_BROKEN`.

---

## 3. Fast Incremental Verification Gates

All gates executed with 100% pass rate:

- Gate 1: `bun run typecheck` (0 type errors)
- Gate 2a: `bun test tests/unit/policy/central-policy-engine.test.ts` (7 pass)
- Gate 2b: `bun test tests/unit/engine/concurrency-cap.test.ts` (14 pass)
- Gate 2c: `bun test tests/unit/telemetry/circuit-breaker.test.ts` (12 pass)
- Gate 3a: `bun test tests/unit/policy/hooks/lifecycle-hooks-engine.test.ts` (14 pass)
- Gate 3b: `bun test tests/unit/policy/repo-policy-authority.test.ts` (7 pass)
- Gate 3c: `bun test tests/unit/policy/repo-policy-io.test.ts` (6 pass)
- Gate 3d: `bun test tests/unit/policy/policy-enforcer.test.ts` (17 pass)
- Gate 4: `bun test tests/unit/mind/concurrency-cap.test.ts` (10 pass)
- Gate 5: `bun scripts/modularity/check.ts --mode ratchet` (0 new violations)

Total: 87 unit tests passed across 8 test suites.

---

## 4. 5-Round Validator Certification Record

- **Validator**: validator_07 (`62c9405c-d1c9-4a10-bc46-b1aecf1e2416`)
- **Implementers**: `implementer_13` (`21358eb2-d4d0-4ecc-87fb-9e0dd8ce2be9`), `implementer_14` (`ff63b8cd-30d7-4ab2-845c-6dd4a992f8bc`)
- **Rounds**:
  - **Round 1 (Contract, Interfaces & Architecture Compliance)**: CERTIFIED PASS
  - **Round 2 (Boundary Conditions, Error Handling & Edge Cases)**: CERTIFIED PASS
  - **Round 3 (Monorepo Density & Static Cleanliness)**: CERTIFIED PASS
  - **Round 4 (Test Coverage, Mock Purity & Performance)**: CERTIFIED PASS
  - **Round 5 (Final Verification, AGP Probes 1–5 & Release Sign-Off)**: CERTIFIED PASS
- **Status**: SEALED, COMMITTED & COMPLETED
