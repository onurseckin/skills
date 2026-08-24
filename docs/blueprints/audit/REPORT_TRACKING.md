# Codebase Architectural & State-Transition Audit: Master Tracking Ledger

This ledger tracks the systematic, file-by-file architectural audit of the `@onurseckin/skills` codebase (`olt/scripts/src/`) following the SSoT Unified Agent Architecture consolidation.

### Core Audit Axioms
1. **Zero LLM Intelligence Assumption**: Language models are not smart and require direct, mechanical definitions of what they should do, rigid state guards, and exact 1-shot anchor briefings.
2. **End-to-End State Transition Traceability**: Detailed mapping of what calls what, native host tool interaction protocols, decision-making algorithms, `.olt/` data persistence, and radical simplification opportunities.

---

## Comprehensive Subsystem Audit Matrix

| Target File / Subsystem | Domain | Things to Look For | Status | Blueprint Document |
| :--- | :--- | :---: | :---: | :--- |
| `olt/scripts/src/cli/execute.ts` & `args.ts` | CLI Layer | 3 | **AUDITED** | [cli-execution-engine.md](./cli-execution-engine.md) |
| `olt/scripts/src/cli/registry/` | CLI Layer | 3 | **AUDITED** | [cli-registry-architecture.md](./cli-registry-architecture.md) |
| `olt/scripts/src/cli/commands/agent-brief.ts` | CLI Layer | 3 | **AUDITED** | [cli-agent-task-briefings.md](./cli-agent-task-briefings.md) |
| `olt/scripts/src/cli/commands/task-ops.ts` | CLI Layer | 3 | **AUDITED** | [cli-task-queue-lifecycle.md](./cli-task-queue-lifecycle.md) |
| `olt/scripts/src/cli/commands/plan-ops.ts` | CLI Layer | 3 | **AUDITED** | [cli-plan-compilation.md](./cli-plan-compilation.md) |
| `olt/scripts/src/runtime/capsule.ts` | Runtime & Core | 3 | **AUDITED** | [runtime-capsule-lifecycle.md](./runtime-capsule-lifecycle.md) |
| `olt/scripts/src/runtime/state-machine.ts` | Runtime & Core | 3 | **AUDITED** | [runtime-state-machine-transitions.md](./runtime-state-machine-transitions.md) |
| `olt/scripts/src/runtime/lease.ts` & `locks.ts` | Runtime & Core | 3 | **AUDITED** | [runtime-lease-lock-concurrency.md](./runtime-lease-lock-concurrency.md) |
| `olt/scripts/src/core/paths.ts` & `storage/` | Runtime & Core | 3 | **AUDITED** | [core-storage-paths-olt.md](./core-storage-paths-olt.md) |
| `olt/scripts/src/graph/dag.ts` & `topology.ts` | Engine & Graph | 3 | **AUDITED** | [graph-topology-engine.md](./graph-topology-engine.md) |
| `olt/scripts/src/mind/mind-pulse.ts` | Mind & Orchestration | 3 | **AUDITED** | [mind-autonomous-pulse-cadence.md](./mind-autonomous-pulse-cadence.md) |
| `olt/scripts/src/mind/smart-task-manager.ts` | Mind & Orchestration | 3 | **AUDITED** | [mind-product-owner-backlog.md](./mind-product-owner-backlog.md) |
| `olt/scripts/src/orchestrator/orchestrator-loop.ts` | Mind & Orchestration | 3 | **AUDITED** | [orchestrator-multi-round-loop.md](./orchestrator-multi-round-loop.md) |
| `olt/scripts/src/plan/scope-analyzer.ts` | Mind & Orchestration | 3 | **AUDITED** | [plan-decomposition-dag.md](./plan-decomposition-dag.md) |
| `olt/scripts/src/task/micro-cycle-engine.ts` | Mind & Orchestration | 3 | **AUDITED** | [task-in-lease-micro-cycles.md](./task-in-lease-micro-cycles.md) |
| `olt/scripts/src/validation/` & `capture/` | Verification & Evidence | 3 | **AUDITED** | [validation-cognitive-mechanic-split.md](./validation-cognitive-mechanic-split.md) |
| `olt/scripts/src/reporting/summary-exporter.ts` | Verification & Evidence | 3 | **AUDITED** | [reporting-evidence-grounding.md](./reporting-evidence-grounding.md) |
| `olt/scripts/src/critic/critic-ops.ts` | Verification & Evidence | 3 | **AUDITED** | [critic-prompt-byte-fidelity.md](./critic-prompt-byte-fidelity.md) |
| `olt/scripts/src/heuristics/meta-auditor.ts` | Verification & Evidence | 3 | **AUDITED** | [meta-auditor-behavioral-forensics.md](./meta-auditor-behavioral-forensics.md) |
| `olt/scripts/src/health/doctor.ts` | Verification & Evidence | 3 | **AUDITED** | [health-doctor-diagnostics.md](./health-doctor-diagnostics.md) |

---

## Key Cross-System Architectural Discoveries & Simplifications

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                 CRITICAL CROSS-SYSTEM AUDIT DISCOVERIES                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. Passive Tool Defect Gating:                                             │
│     Calling read-only commands (e.g. `whoami`) from main thread triggered   │
│     spurious `main_thread_direct_execution` defects in `.olt/defects.jsonl`.│
│     *Fix*: Only log defects on active code mutations or raw test runs.      │
│                                                                             │
│  2. Single-Source Materialized Snapshots vs JSONL Parsing:                  │
│     Scattered append-only `.jsonl` files (`events.jsonl`, `findings.jsonl`,  │
│     `reviews.jsonl`) incur parsing overhead on deep multi-round runs.       │
│     *Fix*: Introduce periodic state snapshots / materialized viewpoints.    │
│                                                                             │
│  3. AST-Level Disjointness for Granular Parallelism:                        │
│     Currently, two tasks touching the same `.ts` file are serialized.       │
│     *Fix*: AST-based function/symbol disjointness checking to unlock        │
│     parallel edits on non-overlapping symbols in large files.               │
│                                                                             │
│  4. Cognitive Validator Hard-Lock Enforcement:                              │
│     Cognitive Validators must have 0 bash commands (`can_execute_shell:     │
│     false`) to prevent token burning and maintain pure Socratic critique.   │
│                                                                             │
│  5. 1-Shot Exact-Anchor Briefing Optimization:                              │
│     Parent agents must never craft loose string prompts; all dispatches     │
│     must flow through `agent:brief` and `task:brief` directly from disk.    │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```
