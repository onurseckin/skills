# Skill Architecture: Cascading Scope-Aware Replanning & Fan-Back Protocol

**Document**: `docs/planning/gvui-execution-graph/10-skill-cascading-scope-aware-replanning-protocol.md`  
**Date**: 2026-08-15  
**Status**: Approved Architecture & Locked Planning Specification  
**Canonical Skill**: `skills/orchestrating-long-tasks`  

---

## 1. Executive Summary & Problem Statement

In long-running autonomous multi-agent engineering workflows, tasks are scheduled in topological DAGs with disjoint write scopes. However, when execution reaches the final phase—**Whole-Run Validation** and the **Completeness Critic**—all previous implementer and validator subagents have concluded and gone idle. At this point, only a single agent remains active: the Tier 3 Completeness Critic (or Tier 2 Coordinator).

If this late-stage agent detects compilation errors, type mismatches, broken regression assertions, or missing prompt requirements, a severe systemic failure occurs if the harness lacks a structured **Cascading Fan-Back Protocol**:

### The "Monolithic Single-Agent Trap" Anti-Pattern
Without a structured replanning protocol, the lone agent attempts to remediate all discovered defects directly within its own session. This triggers four catastrophic failure modes:
1. **Violation of Disjoint Write Scopes**: A single agent modifies files across multiple independent subsystems (e.g., React UI components, WebAssembly layout kernels, and CLI scripts), obliterating the core spatial isolation guarantees of the orchestrator.
2. **Destruction of Independent Adversarial Validation**: The agent reviews, writes, and tests its own code modifications without an independent, non-anchored validator auditing the work.
3. **Context Window Saturation & Semantic Drift**: Loading massive diffs and debugging logs across disparate subsystems rapidly exhausts the model's effective context window, leading to hallucinated APIs, broken imports, and cascading syntax errors.
4. **Execution Bottleneck**: Multi-threaded, parallel execution collapses into a slow, brittle single thread.

---

## 2. The Solution: The Cascading "Fan-Back" Architecture

```
[ASCII Cascading Scope-Aware Replanning & Fan-Back Architecture]

┌────────────────────────────────────────────────────────────────────────────────────────┐
│ LATE STAGE: Completeness Critic / Whole-Run Gate (Single Agent Active)                 │
│ Action: Discovers 3 compiler diagnostics in Drawer + 2 bounding errors in Layout       │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ 1. Emits Structured Findings & Rejects Run
                                    │    (CRITIC DOES NOT EDIT CODE)
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 2 COORDINATOR: Dynamic Scope Partitioning & Re-Planning                           │
│ Action: Groups findings by `write_scope` and creates dynamic Repair Tasks:             │
│ • Task repair-R1-drawer (Scope: gvui/src/components/EdgeDetailDrawer/)                 │
│ • Task repair-R1-layout (Scope: gvui/src/engine/layout/)                               │
└───────────────────────────────────┬────────────────────────────────────────────────────┘
                                    │ 2. Dispatches Parallel Batch `invoke_subagent`
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ TIER 3: PARALLEL SCOPED REPAIR WAVE (Multiple Agents Re-Invoked Simultaneously)        │
├────────────────────────────────────────────────────┬───────────────────────────────────┤
│ Scope A (Edge Drawer Subsystem)                    │ Scope B (Layout Subsystem)        │
│ ┌────────────────────────────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ Implementer A: Fixes Drawer Types & JSX        │ │ │ Implementer B: Fixes Clamping │ │
│ └───────────────────────┬────────────────────────┘ │ └───────────────┬───────────────┘ │
│                         ▼                          │                 ▼                 │
│ ┌────────────────────────────────────────────────┐ │ ┌───────────────────────────────┐ │
│ │ Validator A: Runs Drawer Unit & Component Tests│ │ │ Validator B: Runs Layout Gate │ │
│ └────────────────────────────────────────────────┘ │ └───────────────────────────────┘ │
└───────────────────────────────────┬────────────────┴───────────────────────────────────┘
                                    │ 3. Both Scoped Repair Tasks Pass Quality Gates
                                    ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ RE-CONVERGENCE: Return to Completeness Critic                                          │
│ Action: Critic re-audits whole-repo git diff against immutable prompt bytes & seals    │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. The Scope Partitioning Algorithm

When late-stage validation identifies $K$ defects, it outputs an array of structured findings:
$$\mathcal{F} = \{ f_1, f_2, \dots, f_K \}$$
Each finding $f_i$ references a nonempty set of affected repository file paths:
$$\text{Paths}(f_i) = \{ p_{i,1}, p_{i,2}, \dots, p_{i,m_i} \}$$

The objective of the **Scope Partitioning Algorithm** is to compute a minimal partition of disjoint write scopes:
$$\mathcal{S} = \{ S_1, S_2, \dots, S_M \} \quad (M \le K)$$

### Mathematical Guarantees:
1. **Full Coverage**: Every file path across all findings is covered by at least one write scope:
   $$\forall f_i \in \mathcal{F}, \forall p \in \text{Paths}(f_i), \exists S_j \in \mathcal{S} \text{ such that } p \subseteq S_j$$
2. **Strict Disjointness (Zero Collisions)**: No two distinct write scopes share paths or have ancestor/descendant relationships:
   $$\forall S_a, S_b \in \mathcal{S} \ (a \ne b) \implies S_a \cap S_b = \emptyset \land S_a \not\subset S_b \land S_b \not\subset S_a$$
3. **Maximal Concurrency**: The partition maximizes $M$ (the number of parallel repair lanes) while maintaining architectural cohesion within individual subsystem directories.

### Type Definitions
```typescript
export interface FindingDetail {
  readonly id: string;
  readonly requirement_id?: string;
  readonly severity: "critical" | "important" | "suggestion";
  readonly file_paths: readonly string[];
  readonly observation: string;
  readonly remediation: string;
  readonly revalidation_gate?: string;
}

export interface ScopedRepairCluster {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly findings: readonly FindingDetail[];
  readonly gateCommand: readonly string[];
  readonly effort: number;
}
```

### Deterministic Implementation (TypeScript)
```typescript
import { posix } from "node:path";
import { checkScopeOverlap, normalizeScopePath } from "./scope-analyzer.ts";

function computeLcaDirectory(paths: readonly string[]): string {
  if (paths.length === 0) return ".";
  const normalized = paths.map(normalizeScopePath);
  if (normalized.length === 1) {
    const single = normalized[0]!;
    const dir = posix.dirname(single);
    return dir === "." ? single : dir;
  }
  const splitPaths = normalized.map((p) => p.split("/"));
  const minLen = Math.min(...splitPaths.map((p) => p.length));
  const commonSegments: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const segment = splitPaths[0]![i]!;
    if (splitPaths.every((p) => p[i] === segment)) {
      commonSegments.push(segment);
    } else {
      break;
    }
  }
  if (commonSegments.length === 0) return ".";
  const joined = commonSegments.join("/");
  return joined.includes(".") ? posix.dirname(joined) : joined;
}

export function partitionFindingsIntoScopes(
  findings: readonly FindingDetail[],
  repairRound = 1,
): readonly ScopedRepairCluster[] {
  if (findings.length === 0) return [];

  interface MutableCluster {
    scope: string;
    findings: FindingDetail[];
  }
  const rawClusters: MutableCluster[] = [];

  for (const finding of findings) {
    const lca = computeLcaDirectory(finding.file_paths);
    const existing = rawClusters.find((c) => c.scope === lca);
    if (existing) {
      existing.findings.push(finding);
    } else {
      rawClusters.push({ scope: lca, findings: [finding] });
    }
  }

  // Iterative merge for parent/child or overlapping scopes
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rawClusters.length; i++) {
      for (let j = i + 1; j < rawClusters.length; j++) {
        const a = rawClusters[i]!;
        const b = rawClusters[j]!;
        const overlap = checkScopeOverlap([a.scope], [b.scope]);
        if (overlap.hasOverlap) {
          const mergedScope =
            a.scope === overlap.conflictingPath && overlap.relation === "parent_child"
              ? a.scope.length < b.scope.length
                ? a.scope
                : b.scope
              : posix.dirname(overlap.conflictingPath);

          a.scope = mergedScope;
          a.findings.push(...b.findings);
          rawClusters.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return rawClusters.map((cluster) => {
    const slug = cluster.scope.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "") || "root";
    const taskId = `repair-R${repairRound}-${slug}`;
    const label = `Repair Wave ${repairRound}: ${cluster.scope}`;
    const effort = Math.min(5, Math.max(1, cluster.findings.length + 1));
    const gateCommand = ["bun", "test", "tests"];

    return {
      taskId,
      label,
      writeScope: [cluster.scope],
      findings: cluster.findings,
      gateCommand,
      effort,
    };
  });
}
```

---

## 4. Dynamic Repair Wave DAG Compilation & State Transitions

### A. Formal State Transitions in `state.json`
1. **`critic:reject`**:
   - `completion_review.status` becomes `"findings"`.
   - Populates `unresolved_finding_ids`.
   - Event `critic-reviewed` appended to `events.jsonl`.
2. **`plan:replan`**:
   - Increments `graph_revision` ($N \to N+1$).
   - Injects dynamic repair tasks ($R_1, R_2, \dots$) into `state.tasks` with initial status `ready`.
   - Creates a **Wave R Validation Barrier**: Downstream run completion gates and `critic:start` are blocked until all repair tasks are `done`.
   - Event `plan-recompiled` appended to `events.jsonl`.

### B. Append-Only Hashed Audit Trail (`events.jsonl`)
```jsonl
{"sequence": 42, "timestamp": "2026-08-15T01:10:05Z", "actor": "critic-round-1", "event": "critic-reviewed", "payload": {"status": "findings", "findings_count": 2}, "prev_hash": "a1...", "hash": "b2..."}
{"sequence": 43, "timestamp": "2026-08-15T01:10:10Z", "actor": "coordinator", "event": "plan-recompiled", "payload": {"revision": 2, "new_tasks": ["repair-R1-drawer", "repair-R1-layout"], "repair_round": 1}, "prev_hash": "b2...", "hash": "c3..."}
{"sequence": 44, "timestamp": "2026-08-15T01:10:15Z", "actor": "worker-repair-drawer", "event": "task-claimed", "payload": {"task_id": "repair-R1-drawer"}, "prev_hash": "c3...", "hash": "d4..."}
{"sequence": 45, "timestamp": "2026-08-15T01:10:15Z", "actor": "worker-repair-layout", "event": "task-claimed", "payload": {"task_id": "repair-R1-layout"}, "prev_hash": "d4...", "hash": "e5..."}
{"sequence": 46, "timestamp": "2026-08-15T01:10:45Z", "actor": "validator-repair-drawer", "event": "task-reviewed", "payload": {"task_id": "repair-R1-drawer", "verdict": "pass"}, "prev_hash": "e5...", "hash": "f6..."}
{"sequence": 47, "timestamp": "2026-08-15T01:10:50Z", "actor": "validator-repair-layout", "event": "task-reviewed", "payload": {"task_id": "repair-R1-layout", "verdict": "pass"}, "prev_hash": "f6...", "hash": "07..."}
{"sequence": 48, "timestamp": "2026-08-15T01:10:55Z", "actor": "coordinator", "event": "command-recorded", "payload": {"gate_id": "gate-run-completion", "exit_code": 0}, "prev_hash": "07...", "hash": "18..."}
{"sequence": 49, "timestamp": "2026-08-15T01:11:00Z", "actor": "critic-round-2", "event": "critic-reviewed", "payload": {"status": "clean"}, "prev_hash": "18...", "hash": "29..."}
{"sequence": 50, "timestamp": "2026-08-15T01:11:05Z", "actor": "coordinator", "event": "run-completed", "payload": {"status": "complete"}, "prev_hash": "29...", "hash": "3a..."}
```

---

## 5. Parallel Batch `invoke_subagent` Integration

### A. The Single-Batch Multi-Lane Invariant
The Tier 2 Coordinator **MUST** dispatch all independent repair lanes concurrently in a single `invoke_subagent` call:

```json
{
  "Subagents": [
    {
      "TypeName": "self",
      "Role": "Repair Implementer: Edge Drawer",
      "Model": "inherit",
      "Prompt": "You are the Dedicated Repair Implementer for task 'repair-R1-drawer'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- Task ID: repair-R1-drawer\n- Strict Write Scope: ['src/components/EdgeDetailDrawer']\n\n### ASSIGNED FINDINGS:\n- F-DRAWER-01: TS2322 error in drawer toggle handler.\n\n### PROTOCOL WORKFLOW:\n1. Claim task: bun harness.ts task:claim --run $RUN --task repair-R1-drawer --agent worker-drawer\n2. Fix code within scope.\n3. Submit task: bun harness.ts task:submit --run $RUN --task repair-R1-drawer --agent worker-drawer --token <TOKEN>\n4. Message parent with completion status."
    },
    {
      "TypeName": "self",
      "Role": "Repair Validator: Edge Drawer",
      "Model": "inherit",
      "Prompt": "You are the Independent Repair Validator for task 'repair-R1-drawer'.\n\n### PROTOCOL WORKFLOW:\n1. Start validation: bun harness.ts task:validate-start --run $RUN --task repair-R1-drawer --validator validator-drawer\n2. Execute gate proof: bun harness.ts run:exec --run $RUN --task repair-R1-drawer --actor validator-drawer -- bun test tests\n3. Review pass: bun harness.ts task:review --run $RUN --task repair-R1-drawer --validator validator-drawer --token <VAL_TOKEN> --status pass\n4. Message parent with pass verdict."
    },
    {
      "TypeName": "self",
      "Role": "Repair Implementer: Layout Engine",
      "Model": "inherit",
      "Prompt": "You are the Dedicated Repair Implementer for task 'repair-R1-layout'.\n\n### CAPSULE CONTEXT:\n- Run Capsule: /Users/onurseckinsenoglu/repos/gvui/.capsules/2026-08-15-cascading-replanning-deep-plan\n- Task ID: repair-R1-layout\n- Strict Write Scope: ['src/engine/layout']\n\n### ASSIGNED FINDINGS:\n- F-LAYOUT-01: Negative coordinate clamping failure.\n\n### PROTOCOL WORKFLOW:\n1. Claim task: bun harness.ts task:claim --run $RUN --task repair-R1-layout --agent worker-layout\n2. Fix code within scope.\n3. Submit task: bun harness.ts task:submit --run $RUN --task repair-R1-layout --agent worker-layout --token <TOKEN>\n4. Message parent with completion status."
    },
    {
      "TypeName": "self",
      "Role": "Repair Validator: Layout Engine",
      "Model": "inherit",
      "Prompt": "You are the Independent Repair Validator for task 'repair-R1-layout'.\n\n### PROTOCOL WORKFLOW:\n1. Start validation: bun harness.ts task:validate-start --run $RUN --task repair-R1-layout --validator validator-layout\n2. Execute gate proof: bun harness.ts run:exec --run $RUN --task repair-R1-layout --actor validator-layout -- bun test tests\n3. Review pass: bun harness.ts task:review --run $RUN --task repair-R1-layout --validator validator-layout --token <VAL_TOKEN> --status pass\n4. Message parent with pass verdict."
    }
  ]
}
```

---

## 6. End-to-End Walkthrough & Worked Examples

### 7-Step Lifecycle:
1. **Wave 0 Completion**: Original tasks (`task-01-types`, `task-02-drawer`, `task-03-layout`) pass unit gates and finish (`status: "done"`).
2. **Critic Start & Audit**: Tier 3 Critic claims session via `critic:start` and audits whole-repo diff against immutable `prompt.md`.
3. **Structured Rejection**: Critic finds TS2322 in `EdgeDrawer.tsx` and clamping bug in `hierarchical.ts`. Critic issues `critic:review --decision request_changes` with structured `review.json`.
4. **Scope Partitioning & Replanning**: Coordinator runs `partitionFindingsIntoScopes` $\to$ computes `repair-R1-drawer` (`src/components/EdgeDetailDrawer/`) and `repair-R1-layout` (`src/engine/layout/`). Advances DAG to Revision 2.
5. **Parallel Subagent Execution**: Coordinator calls `invoke_subagent` with 4 agents. Workers claim, fix, and submit in parallel. Validators run `run:exec` gates and submit passing reviews (`task:review --status pass`).
6. **Re-Convergence**: Validation Barrier verifies all repair tasks are `done`. Coordinator re-runs mandatory run gate `gate-run-completion`.
7. **Critic Seal**: Round 2 Critic (`critic:start`) verifies zero defects and issues `critic:review --decision approve`. Coordinator executes `run:complete`.

---

## 7. Skill Configuration Blueprint

To establish this protocol permanently, the following agent and skill definitions are bound:

1. **`agents/critic.yaml`**:
   - Explicit **"No-Edit / Fan-Back Invariant"**: The Critic is strictly read-only and must reject with structured findings; never edit code.
2. **`agents/coordinator.yaml`**:
   - Explicit **"Dynamic Scope Partitioning & Batch Re-Invocation"** instructions for late-stage replanning.
3. **`SKILL.md`**:
   - New Section: `## Cascading Scope-Aware Replanning & Fan-Back Protocol`.
4. **`references/protocol.md`**:
   - Updated Sections 7 & 8 documenting dynamic repair wave lifecycles, DAG validation barriers, and re-convergence semantics.
