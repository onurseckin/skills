# Master Plan: Unified Master Reporting Dashboard & Canonical Sugiyama Visual DAG Engine

> **Tracking ID:** `fb-cluster-reporting-dfc4b73c`  
> **Status:** `PLANNED - READY FOR COORDINATOR DISPATCH`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/reporting/`, `olt/scripts/src/graph/`, `tests/unit/reporting/`, `tests/unit/graph/`  
> **Author:** Pipeline Pre-Planning Meta-Orchestrator (`orchestrator_pipeline_preplanning`)  
> **Created:** 2026-08-29

---

## Level 1: Executive Context & Problem Statement

### 1.1 Architectural Context & Root Causes

The OLT multi-agent runtime requires full observability without reliance on prompting external LLMs to understand system state. The Unified Master Reporting Dashboard (`bun harness.ts report`) serves as the single source of truth for runtime topology, task execution, supervisor-implementer-validator micro-cycles, and adversarial pushback verification.

Forensic analysis revealed three critical deficiencies:

1. **Reporting Subsystem Fragmentation & Inconsistent Rendering**:
   Certain commands and exports bypass the canonical Sugiyama hierarchical layout engine (`reporting/sugiyama-dag/`), producing unlayered, disjointed ASCII graphs that fail to clearly represent parallel execution lanes, wave barriers, and cyclic fallback branches.
2. **Missing Implementer-Validator Relationship & Pushback Telemetry**:
   Default reporting fails to surface real-time cognitive feedback rounds (`Pushes: X/Y`), adversarial probe findings, and in-lease micro-cycle repair metrics, preventing supervisors from quickly assessing convergence bottlenecks.
3. **Subsystem Modularity & Type Gaps**:
   `reporting/living-tracer/types.ts` and `reporting/doctor/planning-dag-engine.ts` suffered from type resolution defects (`ReplayContext` export, implicit `any` parameter `d`), and `reporting/doctor/` contains 22 files in a single folder, violating the density budget ($\le 10$ files per directory).

---

## Level 2: Target Architecture & ASCII Unicode Topology

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                       UNIFIED MASTER REPORTING & VISUAL DAG TOPOLOGY                        │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
                                            │
               ┌────────────────────────────┼────────────────────────────┐
               ▼                            ▼                            ▼
┌─────────────────────────────┐┌─────────────────────────────┐┌─────────────────────────────┐
│     Sugiyama DAG Engine     ││   Micro-Cycle Telemetry     ││    Doctor Integration       │
│ ─────────────────────────── ││ ─────────────────────────── ││ ─────────────────────────── │
│ • Tarjan Cycle Elimination  ││ • Cognitive Pushes (X/Y)    ││ • Strict Policy Auditing    │
│ • Longest-Path Layering     ││ • Adversarial Findings      ││ • Mandatory Quota Checks    │
│ • Barycenter Crossing Min.  ││ • In-Lease Repair Counts    ││ • Zero-LLM CLI Inspection   │
│ • Orthogonal ASCII Router   ││ • Implementer-Validator Flow││ • Unified Health Dashboard  │
└─────────────────────────────┘└─────────────────────────────┘└─────────────────────────────┘
               │                            │                            │
               └────────────────────────────┼────────────────────────────┘
                                            ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                          UNIFIED DASHBOARD & LIVING TRACER FACADE                           │
│ ─────────────────────────────────────────────────────────────────────────────────────────── │
│ • ANSI/ASCII Terminal UI Engine (`bun harness.ts report`)                                   │
│ • Zero Code Comments & Full Type Safety (0 TypeScript `any`, 0 suppressions)                │
│ • Strict Density Budget: ≤ 300 Physical Lines / File, ≤ 10 Files / Subsystem Directory      │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Level 3: Disjoint Scope Boundaries

| Scope Domain                                    | Path Specification                                                                                                              | Access Contract       |
| :---------------------------------------------- | :------------------------------------------------------------------------------------------------------------------------------ | :-------------------- |
| **Write Scope (Lane A: Sugiyama DAG)**          | `olt/scripts/src/reporting/sugiyama-dag/`, `olt/scripts/src/graph/`, `tests/unit/reporting/sugiyama-dag.test.ts`                | Exclusive Write Lease |
| **Write Scope (Lane B: Telemetry & Dashboard)** | `olt/scripts/src/reporting/unified/`, `olt/scripts/src/reporting/living-tracer/`, `tests/unit/reporting/unified-report.test.ts` | Exclusive Write Lease |
| **Write Scope (Lane C: Doctor Diagnostics)**    | `olt/scripts/src/reporting/doctor/`, `tests/unit/reporting/doctor-dag.test.ts`                                                  | Exclusive Write Lease |
| **Read-Only Scope**                             | `olt/scripts/src/core/`, `olt/scripts/src/authority/`, `olt/scripts/src/engine/store/`                                          | Read-Only             |

---

## Level 4: Atomic Implementation Tasks Matrix

| Task ID        | Target File Path                                               | Exact TypeScript Symbols / Signatures                                                        | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                   |
| :------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- |
| `task-rep-1.1` | `olt/scripts/src/reporting/sugiyama-dag/render.ts`             | `renderSugiyamaDag(graph: DirectedGraph, opts?: SugiyamaRenderOptions): string`              | Integrate canonical Sugiyama layout engine with ASCII box rendering, cycle feedback arcs, and wave barrier delimiters. |
| `task-rep-1.2` | `olt/scripts/src/reporting/sugiyama-dag/subagent-expansion.ts` | `expandSubagentSubgraphs(dag: SugiyamaDag, subagents: readonly SubagentNode[]): SugiyamaDag` | Expand hierarchical child subagent clusters inside visual box containers with clean routing channels.                  |
| `task-rep-1.3` | `tests/unit/reporting/sugiyama-dag.test.ts`                    | `describe("Sugiyama Visual DAG Engine", ...)`                                                | Unit tests for cycle breaking (Tarjan), barycenter crossing minimization, and ASCII rendering.                         |
| `task-rep-2.1` | `olt/scripts/src/reporting/unified/report-builder.ts`          | `buildUnifiedReport(ctx: ReportContext): UnifiedReportView`                                  | Master report aggregator assembling Sugiyama DAG, wave progress, cognitive push quotas, and repair metrics.            |
| `task-rep-2.2` | `olt/scripts/src/reporting/unified/leases-decisions.ts`        | `formatLeaseDecisions(leases: readonly LeaseRecord[]): string`                               | Format implementer-validator relationship flow, showing pushback counts, cognitive reviews, and resolution verdicts.   |
| `task-rep-2.3` | `olt/scripts/src/reporting/living-tracer/types.ts`             | `export interface ReplayContext`, `DynamicTaskState`                                         | Ensure clean explicit export of `ReplayContext` with zero type gaps and strict null-safety.                            |
| `task-rep-2.4` | `tests/unit/reporting/unified-report.test.ts`                  | `describe("Unified Master Reporting Dashboard", ...)`                                        | Unit tests asserting full dashboard output format, pushback metrics, and zero-LLM telemetry visibility.                |
| `task-rep-3.1` | `olt/scripts/src/reporting/doctor/planning-dag-engine.ts`      | `checkPlanningDag(opts: PlanningDagCheckOptions): DoctorCheckResult`                         | Eliminate implicit `any` parameter `d`, enforce type safety, and validate DAG acyclicity and gate prerequisites.       |
| `task-rep-3.2` | `tests/unit/reporting/doctor-dag.test.ts`                      | `describe("Doctor Planning DAG Engine", ...)`                                                | Unit tests verifying DAG validation and acyclicity check accuracy.                                                     |

---

## Level 5: Falsifiable Gate Verification Commands

```bash
# Gate 1: Sugiyama Visual DAG Rendering & Layering Suite
bun test tests/unit/reporting/sugiyama-dag.test.ts

# Gate 2: Unified Reporting Dashboard & Telemetry Aggregation Suite
bun test tests/unit/reporting/unified-report.test.ts

# Gate 3: Doctor Planning DAG Validation Suite
bun test tests/unit/reporting/doctor-dag.test.ts

# Gate 4: Subsystem Static Verification Interlock
bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .
```

---

## Level 6: Strict Invariant Enforcement

1. **Zero Code Comments**: No inline, block, or docblock comments in any `.ts` source file.
2. **Density Budget**: $\le 300$ physical lines per file. Reorganize `reporting/doctor/` into cohesive submodules with $\le 10$ files per directory.
3. **Ban Defect-Prefix Source Files**: Strict 0 `defect-*.ts` / `fb-*.ts` files. All enhancements modify canonical modular files in-place.
4. **Explicit Named Exports**: `reporting/index.ts` and `reporting/sugiyama-dag/index.ts` export explicitly named symbols with zero `export *`.
5. **Deterministic Zero-LLM CLI Inspection**: Complete runtime state rendered via deterministic TypeScript logic without prompting an external LLM.

---

## Level 7: Sequential Critical Path DAG & Work/Span Optimization

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│                             CRITICAL PATH DAG (KAHN SORT)                                   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘

  [Wave 1: Core DAG & Type Hardening]
      ├── Task rep-1.1 (Sugiyama Renderer) ──────────┐
      ├── Task rep-1.2 (Subagent Expansion) ─────────┼──► [Gate 1: Sugiyama DAG Tests]
      ├── Task rep-1.3 (Sugiyama Unit Tests) ────────┘
      │
      ├── Task rep-2.3 (Living Tracer Types Export) ─┐
      ├── Task rep-3.1 (Doctor Planning DAG Typings) ┼──► [Gate 3: Doctor Typings & DAG Tests]
      └── Task rep-3.2 (Doctor DAG Tests) ───────────┘
                                                                  │
                                                                  ▼
  [Wave 2: Unified Dashboard & Pushback Telemetry]
      ├── Task rep-2.1 (Unified Report Builder) ─────┐
      ├── Task rep-2.2 (Lease Decisions Formatter) ──┼──► [Gate 2: Unified Report Tests]
      └── Task rep-2.4 (Unified Report Unit Tests) ──┘
                                                                  │
                                                                  ▼
  [Wave 3: Full Reporting Seal & Verification]
      └── Task rep-4.1 (Clean Release & Verification) ──► [Gate 4: task:check & Skill Sync]
```

**Work/Span Calculation**:

- Total Work ($W$): 9 discrete implementation tasks $\approx 18$ minutes.
- Critical Path Span ($S$): 3 sequential wave barriers $\approx 6$ minutes.
- Optimal Concurrency: $P = \lceil W / S \rceil = \lceil 18 / 6 \rceil = 3$ concurrent implementers.
- Concurrency Hard-Lock: Stay within the $\le 50$ simultaneous subagent fleet cap.

---

## Level 8: Exhaustive Traceability Matrix

| Backlog / Defect ID                              | Title / Requirement                                       | Resolved By Tasks                              | Falsifiable Gate Verification Target                              |
| :----------------------------------------------- | :-------------------------------------------------------- | :--------------------------------------------- | :---------------------------------------------------------------- |
| `fb-1787971784118-1aghp`                         | Canonical Sugiyama Visual DAG Engine & Subagent Expansion | `task-rep-1.1`, `task-rep-1.2`, `task-rep-1.3` | `bun test tests/unit/reporting/sugiyama-dag.test.ts`              |
| `fb-1787971784118-1aghp`                         | Unified Master Reporting Dashboard & Pushback Telemetry   | `task-rep-2.1`, `task-rep-2.2`, `task-rep-2.4` | `bun test tests/unit/reporting/unified-report.test.ts`            |
| `defect-living-tracer-unresolved-replay-context` | Explicit `ReplayContext` Export & Typings                 | `task-rep-2.3`                                 | `bun test tests/unit/reporting/unified-report.test.ts`            |
| `defect-doctor-planning-dag-implicit-any`        | Doctor Planning DAG Engine Type-Safety Fix                | `task-rep-3.1`, `task-rep-3.2`                 | `bun test tests/unit/reporting/doctor-dag.test.ts`                |
| `fb-1787971784118-1aghp`                         | Zero-LLM CLI Inspection & Full State Visibility           | All Tasks                                      | `bun ~/.agents/skills/olt/scripts/harness.ts task:check --repo .` |
