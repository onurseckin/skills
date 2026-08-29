# Master Plan: Hermetic Git Worktree Isolation, Central Policy Engine & Multi-Agent Concurrency Cap

> **Tracking ID:** `fb-cluster-engine-c8048f3b`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/engine/`, `olt/scripts/src/policy/`, `tests/unit/engine/`, `tests/unit/policy/`  
> **Author:** Pipeline Pre-Planning Meta-Orchestrator (`orchestrator_pipeline_preplanning`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

Scaling multi-agent orchestration to high-throughput parallel tracks requires hermetic workspace isolation, central policy authority, and strict fleet capacity limits:

1. **Parallel Track Interference & Shared Workspace Contention**:
   Parallel orchestrator tracks previously executed in the shared root repository working tree. Concurrent edits created dirty working tree conflicts, race conditions during git staging, and uncoordinated push collisions. Binding every orchestrator lane to a hermetic Git worktree in `.olt/worktrees/<track_id>/` isolates execution and provides atomic upstream landing upon wave verification.
2. **Central Authoritative `policy.json` Engine & Event Lifecycle Hooks**:
   Repository configuration was historically scattered across hardcoded values and manifest files. `.olt/policy.json` must be the authoritative single source of truth for reviewer pushback limits, quota thresholds, scheduler cadences, and post-phase event hooks (`on_wave_complete`, `on_release_push`).
3. **Fleet-Wide Hard Concurrency Cap ($\le 50$ Subagents)**:
   Aggressive unconstrained subagent spawning resulted in $>90$ simultaneous subagents, triggering provider 429 quota exhaustion and system thrashing. The runtime engine requires a deterministic concurrency throttle hard-locked at 50 active subagents across all tiers.
4. **Quota Circuit Breaker Latency Detection & Turn 1 Capsule Registration**:
   Provider telemetry lag caused quota circuit breakers to trigger too late. Hardening the threshold at $\le 10\%$ remaining quota and enforcing mandatory Turn 1 capsule registration ensures zero uncoordinated child drops.

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                    HERMETIC WORKTREE, POLICY ENGINE & CONCURRENCY THROTTLE                  │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               ▼                            ▼                            ▼
┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
│   Hermetic Git Worktrees    ││   Central Policy Engine     ││   Fleet Concurrency Cap     │
│ ─────────────────────────── ││ ─────────────────────────── ││ ─────────────────────────── │
│ • Path: .olt/worktrees/<id> ││ • Pinned .olt/policy.json   ││ • Max Concurrency: ≤ 50     │
│ • Isolated Branch Checkouts ││ • Provenance Tagging        ││ • Token Bucket / Leases     │
│ • Atomic Rebase & Fast-Fwd  ││ • Lifecycle Event Hooks     ││ • Latency-Aware Quota Trip  │
│ • Deterministic Teardown    ││ • Dynamic Auto-Reload       ││ • Turn 1 Registration Guard │
└─────────────────────────────┘└─────────────────────────────┘└─────────────────────────────┘
               │                            │                            │
               └────────────────────────────┼────────────────────────────┘
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             ENGINE RUNNER & STORE INTEGRATION                               │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • Hermetic CLI: `worktree:create`, `worktree:land`, `worktree:clean`, `worktree:status`     │
│ • Zero Code Comments & Density Compliance (≤ 300 lines/file, ≤ 10 files/dir)                │
│ • Complete Invariant Preservation (Zero TS 'any', Zero Shims, Named Facades)                │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain                                         | Path Specification                                                                                                                 | Access Contract       |
| :--------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------------------- | :-------------------- |
| **Write Scope (Lane A: Worktree Isolation)**         | `olt/scripts/src/engine/worktree/`, `olt/scripts/src/cli/commands/worktree-ops.ts`, `tests/unit/engine/worktree-isolation.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane B: Policy & Hooks Engine)**      | `olt/scripts/src/policy/`, `tests/unit/policy/central-policy-engine.test.ts`                                                       | Exclusive Write Lease |
| **Write Scope (Lane C: Concurrency & Runner Guard)** | `olt/scripts/src/engine/runner/`, `olt/scripts/src/telemetry/circuit-breaker.ts`, `tests/unit/engine/concurrency-cap.test.ts`      | Exclusive Write Lease |
| **Read-Only Scope**                                  | `olt/scripts/src/core/`, `.olt/`                                                                                                   | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID        | Target File Path                                     | Exact TypeScript Symbols / Signatures                                             | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                            |
| :------------- | :--------------------------------------------------- | :-------------------------------------------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ |
| `task-eng-1.1` | `olt/scripts/src/engine/worktree/domain-sync.ts`     | `createHermeticWorktree(trackId: string): Promise<WorktreeContext>`               | Provision isolated Git worktree in `.olt/worktrees/<trackId>`, attach tracking branch, and isolate staging index.               |
| `task-eng-1.2` | `olt/scripts/src/engine/worktree/domain-sync-ops.ts` | `landHermeticWorktree(ctx: WorktreeContext): Promise<LandingResult>`              | Perform atomic upstream rebase, verify gates, commit via conventional commit format, push to `origin/main`, and clean teardown. |
| `task-eng-1.3` | `olt/scripts/src/cli/commands/worktree-ops.ts`       | `worktreeCreateCommand`, `worktreeLandCommand`, `worktreeCleanCommand`            | CLI command handlers for worktree management and status reporting.                                                              |
| `task-eng-1.4` | `tests/unit/engine/worktree-isolation.test.ts`       | `describe("Hermetic Worktree Pipeline", ...)`                                     | Unit tests for worktree creation, isolated staging, conflict detection, and clean teardown.                                     |
| `task-eng-2.1` | `olt/scripts/src/policy/repo-policy.ts`              | `loadRepoPolicy(repoRoot: string): RepoPolicy`                                    | Parse authoritative `.olt/policy.json` with strict schema validation, provenance tagging, and fail-closed error handling.       |
| `task-eng-2.2` | `olt/scripts/src/policy/hooks/lifecycle-hooks.ts`    | `executePolicyHook(event: PolicyLifecycleEvent, ctx: HookContext): Promise<void>` | Event-driven hook executor firing configured shell actions and OS notifications on wave completion and release push.            |
| `task-eng-2.3` | `tests/unit/policy/central-policy-engine.test.ts`    | `describe("Central Policy & Lifecycle Hooks Engine", ...)`                        | Unit tests verifying configuration loading, override precedence, and lifecycle hook dispatch.                                   |
| `task-eng-3.1` | `olt/scripts/src/engine/runner/subagent-pool.ts`     | `acquireSubagentSlot(): Promise<SubagentSlotReceipt>`                             | Fleet-wide concurrency throttle enforcing hard cap of $\le 50$ active subagents across all tiers with FIFO queueing.            |
| `task-eng-3.2` | `olt/scripts/src/telemetry/circuit-breaker.ts`       | `checkQuotaCircuitBreaker(quota: QuotaState): CircuitBreakerVerdict`              | Low-latency quota circuit breaker tripping at $\le 10\%$ remaining quota to eliminate 429 errors.                               |
| `task-eng-3.3` | `tests/unit/engine/concurrency-cap.test.ts`          | `describe("Fleet Concurrency Cap & Quota Breaker", ...)`                          | Unit tests for 50-agent concurrency limit enforcement and latency-aware quota breaker trips.                                    |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: Hermetic Git Worktree Isolation Verification Suite
bun test tests/unit/engine/worktree-isolation.test.ts

# Gate 2: Central Policy & Event Lifecycle Hooks Suite
bun test tests/unit/policy/central-policy-engine.test.ts

# Gate 3: Fleet Concurrency Cap & Quota Breaker Suite
bun test tests/unit/engine/concurrency-cap.test.ts

# Gate 4: Subsystem Static Verification Interlock
bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .
```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: Absolute zero code comments in all `.ts` files.
2. **Density Budget**: $\le 300$ physical lines per file, $\le 10$ files per directory across `engine/` and `policy/`.
3. **Ban Defect-Prefix Source Files**: 0 `defect-*.ts` / `fb-*.ts` files.
4. **Explicit Named Exports**: All barrel files (`engine/index.ts`, `engine/worktree/index.ts`, `policy/index.ts`) export explicitly named symbols.
5. **Hermetic Workspace Integrity**: No multi-agent writes to the shared working tree during active wave execution.

---

## Level 7: Sequential Critical Path DAG & Work/Span Optimization

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL PATH DAG (KAHN SORT)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  [Wave 1: Worktree Core, Policy Schema & Concurrency Governor]
      ├── Task eng-1.1 (Worktree Creation Engine) ───┐
      ├── Task eng-1.2 (Worktree Landing Engine)  ───┼──► [Gate 1: Worktree Isolation Tests]
      │
      ├── Task eng-2.1 (Repo Policy Loader)       ───┐
      ├── Task eng-2.2 (Lifecycle Hooks Engine)   ───┼──► [Gate 2: Central Policy Tests]
      │
      ├── Task eng-3.1 (Subagent Concurrency Pool) ──┐
      └── Task eng-3.2 (Quota Circuit Breaker)     ──┴──► [Gate 3: Concurrency Cap Tests]
                                                                  │
                                                                  ▼
  [Wave 2: CLI Integration & Integrated Test Suites]
      ├── Task eng-1.3 (CLI Worktree Commands)    ───┐
      ├── Task eng-1.4 (Worktree Unit Tests)      ───┼──► [Gate 1 + Gate 2 + Gate 3 Integrated]
      ├── Task eng-2.3 (Policy Unit Tests)        ───┤
      └── Task eng-3.3 (Concurrency Unit Tests)   ───┘
                                                                  │
                                                                  ▼
  [Wave 3: Full Engine Seal & Verification]
      └── Task eng-4.1 (Clean Release & Verification) ──► [Gate 4: task:check & Skill Sync]
```

**Work/Span Calculation**:

- Total Work ($W$): 10 discrete implementation tasks $\approx 20$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 20 / 6 \rceil = 4$ concurrent implementers.
- Concurrency Cap: Fleet total bounded by $\le 50$ active subagents.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                                                 | Title / Requirement                                     | Resolved By Tasks                                              | Falsifiable Gate Verification Target                       |
| :------------------------------------------------------------------ | :------------------------------------------------------ | :------------------------------------------------------------- | :--------------------------------------------------------- |
| `fb-1788022500000-hermetic-git-worktree-isolation-and-wave-landing` | Hermetic Git Worktree Isolation & Atomic Wave Landing   | `task-eng-1.1`, `task-eng-1.2`, `task-eng-1.3`, `task-eng-1.4` | `bun test tests/unit/engine/worktree-isolation.test.ts`    |
| `fb-central-repo-policy-json-engine`                                | Central Authoritative Policy JSON Configuration Engine  | `task-eng-2.1`, `task-eng-2.3`                                 | `bun test tests/unit/policy/central-policy-engine.test.ts` |
| `fb-1788021200000-policy-event-lifecycle-hooks-engine`              | Policy Lifecycle Event Hooks (Post-Phase, Post-Push)    | `task-eng-2.2`, `task-eng-2.3`                                 | `bun test tests/unit/policy/central-policy-engine.test.ts` |
| `fb-1788019800000-max-50-agent-cap`                                 | Fleet-Wide Hard Concurrency Cap ($\le 50$ Subagents)    | `task-eng-3.1`, `task-eng-3.3`                                 | `bun test tests/unit/engine/concurrency-cap.test.ts`       |
| `defect-quota-circuit-breaker-latency-detection`                    | Quota Circuit Breaker Latency Detection & Safety Buffer | `task-eng-3.2`, `task-eng-3.3`                                 | `bun test tests/unit/engine/concurrency-cap.test.ts`       |
