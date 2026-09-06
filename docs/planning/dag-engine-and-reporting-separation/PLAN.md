# Architecture Plan: DAG Engine & Advanced Reporting System Separation

## 1. Executive Summary & Core Architectural Axioms

In the `@onurseckin/skills` CLI, reporting and graph operations must be cleanly decoupled:

```
┌──────────────────────────────────────────────────────────────────────────────────┐
│                   SEPARATION OF RESPONSIBILITIES ARCHITECTURE                    │
├────────────────────────────────────────┬─────────────────────────────────────────┤
│ ACTIVE ENGINES (Logic & System Health) │ PURE REPORTERS (Visualization & Format) │
├────────────────────────────────────────┼─────────────────────────────────────────┤
│ `doctor` (Domain: `diagnostics`)       │ `report:health` (Domain: `reporting`)   │
│ - Re-hashes cryptographic event chains │ - Calls `runDoctor()` from diagnostics  │
│ - Audits supervisory agent invariants  │ - Formats concise terminal/Markdown     │
│ - Verifies host vs harness desync      │ - Zero mutating or diagnostic logic     │
├────────────────────────────────────────┼─────────────────────────────────────────┤
│ `dag:*` (Domain: `graph` / `engine`)   │ `report` & `report:dag` (`reporting`)   │
│ - Multi-agent graph generation & flows │ - Calls DAG engine layout algorithms    │
│ - Cycle detection (Tarjan SCC)         │ - Renders rounded Unicode ASCII boxes   │
│ - Lane bypass & scope overlap checks   │ - Global on-the-spot snapped dashboard  │
│ - System correction, healing & prune   │ - Pure read-only presentation           │
└────────────────────────────────────────┴─────────────────────────────────────────┘
```

### The 4 Core Architectural Additions

1. **Global On-The-Spot Snapped Dashboard (Default `report` Mode)**:
   - When invoked without arguments (`bun harness.ts report`), the CLI must **never** pick a random single capsule, and must **never** pick `archive/` or `.locks/`. It must discover and aggregate **ALL active running capsules across the entire repository**, presenting a unified, whole-fleet command dashboard.
2. **Whole-Repository Multi-Tier Agent Roster**:
   - Aggregates all registered agents across all active capsules into a single canonical view: Tier 0 Mind & Auditor, Tier 1 Orchestrator, Tier 2 Coordinator, Tier 3 Implementers & Validators.
3. **Multi-Capsule Sugiyama Hierarchical DAG**:
   - Renders the execution DAGs for all active execution capsules, showing dependencies, wave groupings, parallel lane coordinates `[W<wave>:L<lane>]`, and task completion states using Unicode rounded boxes (`╭─╮`, `│`, `╰─╯`).
4. **Hard Retirement of `run:status` & `dag` (as viewer)**:
   - Top-level `dag` viewer is moved strictly to `report:dag`, while `dag` is repurposed as the active graph engine (`dag:check`, `dag:heal`).

---

## 2. Work Breakdown Structure (WBS) & Exact File Anchors

### Task 1: Safe Capsule Enumeration & Global Fleet Aggregator

- **Target File**: `olt/scripts/src/reporting/unified/fleet-builder.ts` (new)
- **Target File**: `olt/scripts/src/cli/commands/dag-view.ts` (`findLatestCapsuleIn` fix)
- **Specification**:
  - Filter out `archive/`, `.locks/`, and directories lacking `state.json` or `manifest.json`.
  - In `fleet-builder.ts`, discover all active capsules, load their tasks, agents, and wave metrics.
  - Return aggregated fleet metrics: total subagents, global tasks, overall occupancy, supervisory health.

### Task 2: Multi-Capsule Sugiyama Hierarchical DAG & Agent Roster Renderer

- **Target File**: `olt/scripts/src/reporting/unified/fleet-renderer.ts` (new)
- **Target File**: `olt/scripts/src/reporting/unified/index.ts`
- **Specification**:
  - Render Section 1: Whole-Repository Multi-Tier Agent Roster table.
  - Render Section 2: Global Fleet Concurrency & Phase Rollup table.
  - Render Section 3: Multi-Capsule Sugiyama Hierarchical DAG with rounded Unicode boxes and `[W<wave>:L<lane>]` lane badges.
  - Render Section 4: Supervisory Health Rollup.

### Task 3: Unified Reporting Command Integration

- **Target File**: `olt/scripts/src/cli/commands/unified-reporting.ts`
- **Specification**:
  - When `--run` is omitted in `reportUnifiedCommand`, invoke the Global Fleet Aggregator and render the global fleet dashboard.
  - When `--run` is explicitly provided, render the single-capsule report.

### Task 4: Unit Test Suite & Comprehensive Coverage

- **Target File**: `tests/reporting/fleet-reporting.test.ts`
- **Specification**:
  - Verify safe capsule enumeration skips `archive/`, `.locks/`.
  - Verify multi-capsule aggregation and Sugiyama DAG formatting.
  - Verify unified report command displays fleet overview when `--run` is omitted.

---

## 3. Concurrency & Execution Plan

- **Worktree**: `.olt/worktrees/track-dag-reporting`
- **Execution Tier**: Tier 3 Implementer + Mechanic Validator
- **Quota Check**: Mandatory pre-flight quota gate verified (> 10.0%).
