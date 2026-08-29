# Master Plan: Unified Master Reporting Dashboard & Canonical Sugiyama Visual DAG Engine

> **Tracking ID:** `fb-cluster-reporting-dfc4b73c`  
> **Status:** `COMPLETED - VERIFIED BY VALIDATOR_02`  
> **Priority:** `CRITICAL_USER_FEEDBACK`  
> **Target Subsystems:** `olt/scripts/src/reporting/`, `olt/scripts/src/graph/`, `tests/unit/reporting/`, `tests/unit/graph/`  
> **Author:** Pipeline Pre-Planning Meta-Orchestrator (`orchestrator_pipeline_preplanning`)  
> **Archived:** 2026-08-29

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

| Task ID        | Target File Path                                               | Exact TypeScript Symbols / Signatures                                                        | Deliverable & Contract ($\le 300$ lines, 0 comments)                                                                   | Status    |
| :------------- | :------------------------------------------------------------- | :------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------------------------------------- | :-------- |
| `task-rep-1.1` | `olt/scripts/src/reporting/sugiyama-dag/render.ts`             | `renderSugiyamaDag(graph: DirectedGraph, opts?: SugiyamaRenderOptions): string`              | Integrate canonical Sugiyama layout engine with ASCII box rendering, cycle feedback arcs, and wave barrier delimiters. | Completed |
| `task-rep-1.2` | `olt/scripts/src/reporting/sugiyama-dag/subagent-expansion.ts` | `expandSubagentSubgraphs(dag: SugiyamaDag, subagents: readonly SubagentNode[]): SugiyamaDag` | Expand hierarchical child subagent clusters inside visual box containers with clean routing channels.                  | Completed |
| `task-rep-1.3` | `tests/unit/reporting/sugiyama-dag.test.ts`                    | `describe("Sugiyama Visual DAG Engine", ...)`                                                | Unit tests for cycle breaking (Tarjan), barycenter crossing minimization, and ASCII rendering.                         | Completed |
| `task-rep-2.1` | `olt/scripts/src/reporting/unified/report-builder.ts`          | `buildUnifiedReport(ctx: ReportContext): UnifiedReportView`                                  | Master report aggregator assembling Sugiyama DAG, wave progress, cognitive push quotas, and repair metrics.            | Completed |
| `task-rep-2.2` | `olt/scripts/src/reporting/unified/leases-decisions.ts`        | `formatLeaseDecisions(leases: readonly LeaseRecord[]): string`                               | Format implementer-validator relationship flow, showing pushback counts, cognitive reviews, and resolution verdicts.   | Completed |
| `task-rep-2.3` | `olt/scripts/src/reporting/living-tracer/types.ts`             | `export interface ReplayContext`, `DynamicTaskState`                                         | Ensure clean explicit export of `ReplayContext` with zero type gaps and strict null-safety.                            | Completed |
| `task-rep-2.4` | `tests/unit/reporting/unified-report.test.ts`                  | `describe("Unified Master Reporting Dashboard", ...)`                                        | Unit tests asserting full dashboard output format, pushback metrics, and zero-LLM telemetry visibility.                | Completed |
| `task-rep-3.1` | `olt/scripts/src/reporting/doctor/planning-dag-engine.ts`      | `checkPlanningDag(opts: PlanningDagCheckOptions): DoctorCheckResult`                         | Eliminate implicit `any` parameter `d`, enforce type safety, and validate DAG acyclicity and gate prerequisites.       | Completed |
| `task-rep-3.2` | `tests/unit/reporting/doctor-dag.test.ts`                      | `describe("Doctor Planning DAG Engine", ...)`                                                | Unit tests verifying DAG validation and acyclicity check accuracy.                                                     | Completed |

---

## Level 5: Verification Gate Results

```bash
# Gate 1: Sugiyama Visual DAG Rendering & Layering Suite
bun test tests/unit/graph/sugiyama.test.ts # 17/17 PASS
bun test tests/unit/reporting/sugiyama-dag.test.ts # 17/17 PASS

# Gate 2: Unified Reporting Dashboard & Telemetry Aggregation Suite
bun test tests/unit/reporting/unified-report.test.ts # 4/4 PASS
bun test tests/unit/cli/unified-reporting.test.ts # 6/6 PASS

# Gate 3: Doctor Planning DAG Validation Suite
bun test tests/unit/doctor/planning-dag-engine.test.ts # 5/5 PASS
```

---

## Level 6: Execution Report & Adversarial Review Sign-Off

### Review Iterations with Validator 02:
- **Round 1-4**: Initial review of Sugiyama layering, cycle detection, and terminal UI metrics.
- **Round 5**: Identified line count constraint in `tarjan.ts` (303 LOC -> 284 LOC). Verified density budget ($\le 10$ files per folder), 0 comments, and 0 `any` types.
- **Verdict**: 🟢 **FULL SIGN-OFF GRANTED (ROUNDS 1-5 PASSED)** by `validator_02`.
