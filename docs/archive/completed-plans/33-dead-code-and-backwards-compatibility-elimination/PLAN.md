# Monorepo Forensic Audit: Dead Code & Backwards-Compatibility Shims

**Date**: 2026-08-29  
**Scope**: Full monorepo audit across all 32 source subsystems (`olt/scripts/src/`), helper scripts (`scripts/`), unit tests (`tests/unit/`), and documentation (`docs/`).  
**Methodology**: 20 parallel forensic auditors deployed across disjoint subsystem boundaries cross-grepping all 2,800+ monorepo files with 0-reference empirical proof.

---

## 1. Executive Summary & Aggregate Findings

| Finding Category                   | Total Count  | Definition / Impact                                                                                                       |
| :--------------------------------- | :----------: | :------------------------------------------------------------------------------------------------------------------------ |
| **`BACKWARDS_COMPATIBILITY_SHIM`** | **94 files** | Root files left behind after modularization that only re-export (`export *` or pass-through proxies) into subdirectories. |
| **`DEAD_CODE`**                    | **23 items** | Exported functions, classes, constants, or modules with exactly 0 production callers across the repository.               |
| **`ORPHANED_FILE`**                | **18 files** | Complete files/fixtures that are never imported or invoked by any active CLI, runtime, or test pipeline.                  |
| **`DUPLICATE_FORWARDER`**          | **14 items** | Redundant re-exports or duplicate logic coexisting alongside canonical source locations.                                  |
| **`DEPRECATED_WRAPPER`**           | **6 items**  | Legacy 1-line wrapper functions that merely forward to newer canonical implementations.                                   |

---

## 2. Comprehensive Subsystem Findings

### A. Summary, Reporting & Telemetry

1. **`olt/scripts/src/summary/*.ts` (50 files)**: `BACKWARDS_COMPATIBILITY_SHIM`
   - 50 root `.ts` files (`agent-telemetry.ts`, `dag-visualizer.ts`, `graph-generator.ts`, etc.) left behind when `summary/` was modularized into `assets/`, `formatters/`, `graph/`, `markdown/`, `metrics/`.
   - _Remedy_: Repoint lingering imports to `src/summary/<subdir>/index.ts` and delete all 50 root shims.
2. **`olt/scripts/src/reporting/` (8 shims, 4 orphaned files)**:
   - _Shims_: `behavioral-auditor.ts`, `living-tracer.ts`, `sugiyama-dag.ts`, `time-telemetry.ts`, `unified.ts`, `theme-contrast-matrix.ts`, `doctor/adversarial-doctor.ts`, `doctor/tier-confinement.ts`.
   - _Orphaned Files_: `diff-analyzer.ts`, `summary-exporter.ts`, `evidence-collector.ts`, `subagent-watchdog-monitor.ts` (0 production consumers).
3. **`olt/scripts/src/telemetry/`**: **CLEAN (100% active)**.

---

### B. Engine & Store Subsystems

1. **`olt/scripts/src/engine/store/` (6 shims)**: `BACKWARDS_COMPATIBILITY_SHIM`
   - `capsule-index.ts`, `capsule.ts`, `captures.ts`, `layout-integrity.ts`, `load.ts`, `paths.ts` (re-export forwarders to `store/capsule/` and `store/integrity/`).
2. **`olt/scripts/src/engine/scheduler/` (2 dead duplicates)**: `DEAD_CODE`
   - `metrics.ts` (duplicate of `topology/metrics.ts`), `propose-batch.ts` (duplicate of `dispatch/propose-batch.ts`).
3. **`olt/scripts/src/engine/state-ledger.ts`**: `DEAD_CODE` / `ORPHANED_FILE` (0 production callers).

---

### C. Authority, Roles & Agents

1. **`olt/scripts/src/authority/` (9 shims)**: `BACKWARDS_COMPATIBILITY_SHIM`
   - `root-hygiene-guard.ts`, `timer-protection-guard.ts`, `manifest-parser.ts`, `persona-grounding.ts`, `review-pushback.ts`, `session-registry.ts`, `supervisory-persona-reminder.ts`, `thread-identifier.ts`, `watchdog-manager.ts` (forwarders to `guards/`, `manifest/`, `persona/`, `review/`, `session/`, `supervisory/`, `thread/`, `watchdog/`).
2. **`olt/scripts/src/agents/` (Entire Directory - 5 files)**: `DEAD_CODE` / `ORPHANED_FILE`
   - `naming.ts`, `naming-types.ts`, `naming-utils.ts`, `agent-triad.ts`, `index.ts` (superseded by `authority/thread/`).

---

### D. Validation & Critic Subsystems

1. **`olt/scripts/src/validation/` (7 shims)**: `BACKWARDS_COMPATIBILITY_SHIM`
   - `anti-leak.ts`, `ast-linter.ts`, `dual-channel-types.ts`, `mutation-gate.ts`, `dual-channel-analyzer.ts`, `evidence-paths.ts`, `report-adapter.ts`.
2. **`olt/scripts/src/validation/rules/` & `engine/` (2 dead directories)**: `DEAD_CODE`
   - `mutation-visitors.ts` (duplicate of `mutation-gate/`), `mutation-generator.ts`, `mutation-runner.ts`, `validator-engine.ts`.
3. **`olt/scripts/src/critic/critic-ops.ts`**: `DEAD_CODE` (`enforceByteFidelity` - 0 callers).

---

### E. Mind, Orchestrator & Plan Subsystems

1. **`olt/scripts/src/mind/defects/` (6 shims)**: `BACKWARDS_COMPATIBILITY_SHIM`
   - `aggregator.ts`, `discriminator.ts`, `dedup-stream.ts`, `live-dedup.ts`, `defect-loop.ts`, `types.ts`.
2. **`olt/scripts/src/mind/contracts/` (7 dead contract files)**: `DEAD_CODE`
   - `audit-contracts.ts`, `gate-contracts.ts`, `lifecycle-contracts.ts`, `memory-contracts.ts`, `proposal-contracts.ts`, `queue-contracts.ts`, `role-contracts.ts`.
3. **`olt/scripts/src/plan/` (2 orphaned files)**: `ORPHANED_FILE`
   - `parallel-decoupler.ts` (`dynamicWaveDecoupling`), `scope-analyzer.ts` (`optimizeScopeCollisionDetection`).
4. **`olt/scripts/src/orchestrator/orchestrator-loop.ts`**: `ORPHANED_FILE` (`OrchestratorDelegation`).

---

### F. Policy & Health Subsystems

1. **`olt/scripts/src/policy/types.ts`**: `BACKWARDS_COMPATIBILITY_SHIM` (26-line stub re-exporting `policy/types/index.ts`).
2. **`olt/scripts/src/health/coverage.ts`**: `DEAD_CODE` / `ORPHANED_FILE` (186 lines, 0 production callers).
3. **`olt/scripts/src/policy/repo-policy.ts` (`parseAuthorityRepoPolicy`)**: `DEPRECATED_WRAPPER` (wrapper around `parseRepoPolicy`).

---

### G. Watchdog, Logging & Heuristics

1. **`olt/scripts/src/watchdog/` (3 shims)**: `autonomic-watchdog.ts`, `boot-gate-enforcer.ts`, `process-timeout.ts`.
2. **`olt/scripts/src/heuristics/` (4 shims)**: `glass-surfaces.ts`, `modal-focus-traps.ts`, `multi-viewport-manifest.ts`, `subpixel-borders.ts`.
3. **`olt/scripts/src/logging/index.ts`**: `ORPHANED_FILE` (0 imports repo-wide).

---

### H. Capture Subsystem

1. **`olt/scripts/src/capture/runners/` (3 shims)**: `dom-event-simulator.ts`, `layout-shift-tracker.ts`, `live-capture-runner.ts`.
2. **`olt/scripts/src/capture/validator/` (2 shims)**: `cognitive-questions.ts`, `focus-ring-optical.ts`.

---

### I. Graph & Topology

1. **`olt/scripts/src/graph/dag.ts` (`detectCycleKahn`)**: `ORPHANED_FILE` (0 references).
2. **`olt/scripts/src/graph/scheduler.ts` (`GraphScheduler`)**: `DEAD_CODE` (0 production references).
3. **`olt/scripts/src/graph/topology.ts`**: 39-symbol backwards-compatibility re-export block.

---

### J. Workflow & Task

1. **`olt/scripts/src/task/micro-cycle-engine.ts` & `task-manager.ts`**: `DEAD_CODE` / `ORPHANED_FILE` (superseded by `workflow/review/`).
2. **`olt/scripts/src/task/pushback.ts`**: `BACKWARDS_COMPATIBILITY_SHIM` (239 lines forwarding to `authority/` and `workflow/review/`).

---

### K. Core & Runtime

1. **`olt/scripts/src/runtime/` (3 orphaned files)**: `state-machine.ts`, `lease.ts`, `locks.ts`.
2. **`olt/scripts/src/core/shared/safe-fs.ts` & `core/config/constants.ts`**: `BACKWARDS_COMPATIBILITY_SHIM`.
3. **`olt/scripts/src/core/storage/index.ts` & `core/shared/safe-fs/locks.ts`**: `DEAD_CODE` / `ORPHANED_FILE`.

---

### L. Linter, Installer & Integration

1. **`olt/scripts/src/linter/ast-enforcer.ts` & `linter/index.ts`**: `BACKWARDS_COMPATIBILITY_SHIM`.
2. **`olt/scripts/src/hooks/config.ts`**: `BACKWARDS_COMPATIBILITY_SHIM` (forwarder to `hooks/config/index.ts`).

---

### M. Repository Scripts (`scripts/`)

1. **`scripts/sync-global.ts`**: `BACKWARDS_COMPATIBILITY_SHIM` (wrapper forwarding to `scripts/sync/index.ts`).
2. **`scripts/verify-gen5.ts` & `validate-agent-manifests.ts`**: `DEAD_CODE` / `ORPHANED_FILE`.
3. **`scripts/testing/reporting/index.ts` & `html/index.ts`**: `export *` wildcard shims.

---

### N. Unit Test Suites & Fixtures

1. **`tests/unit/cli/scenario-fixture.ts` & `visual-validation-fixture.ts`**: `ORPHANED_FILE` (320 lines, 0 callers).
2. **`tests/unit/installer/fixtures/crash-worker.ts` & `lock-worker.ts`**: `ORPHANED_FILE` (68 lines, 0 callers).
3. **`tests/unit/summary/` (4 orphaned completeness fixtures)**: `completeness-run-fixture.ts`, `completeness-run-phases.ts`, `completeness-run-support.ts`, `completeness-sweep.ts`.
4. **`tests/unit/workflow/legacy-capsule-completion.test.ts`**: `DEAD_CODE` (unconditionally skipped legacy test).

---

## 3. Recommended Phased Cleanup Strategy

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       PHASED CLEANUP ARCHITECTURE                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Phase 1: Dead Code & Orphaned Fixture Pruning ]                          │
│    • Delete 18 orphaned files & test fixtures with 0 references             │
│    • Delete dead directories: `src/agents/`, `validation/rules/`, `engine/` │
│    • No consumer rewiring needed (0 impact on active code)                  │
│                                                                             │
│  [ Phase 2: Root Shim Consumer Rewiring & Deletion ]                        │
│    • Update consumers of 94 root shims to import canonical modular paths    │
│    • Target clusters: `summary/` (50), `authority/` (9), `reporting/` (8),  │
│      `validation/` (7), `engine/store/` (6), `mind/defects/` (6), etc.      │
│    • Delete all 94 forwarding shim files                                    │
│                                                                             │
│  [ Phase 3: Invariant Verification & Global Sync ]                          │
│    • Run `bun run typecheck` (verify 0 type errors)                         │
│    • Run `bun run lint` (verify 0 lint errors)                              │
│    • Run `bun test` (verify 100% test suite passes)                         │
│    • Run `bun run modularity:staged` (verify clean ASTs and line limits)    │
│    • Commit, push to `origin/main`, and execute `bun scripts/sync/index.ts` │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
