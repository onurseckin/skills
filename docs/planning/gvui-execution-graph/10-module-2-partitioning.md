# Module 2: The Scope Partitioning Algorithm

**Document**: `docs/planning/gvui-execution-graph/10-module-2-partitioning.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Algorithmic Specification  
**Subsystem**: Dynamic Replanning & Scope Independence  

---

## 1. Objective & Mathematical Formulation

When late-stage validation (Whole-Run Gate or Completeness Critic) identifies $K$ defects, it outputs an array of structured findings:
$$\mathcal{F} = \{ f_1, f_2, \dots, f_K \}$$

Each finding $f_i$ references a nonempty set of affected repository file paths:
$$\text{Paths}(f_i) = \{ p_{i,1}, p_{i,2}, \dots, p_{i,m_i} \}$$

The objective of the **Scope Partitioning Algorithm** is to compute a minimal partition of disjoint write scopes:
$$\mathcal{S} = \{ S_1, S_2, \dots, S_M \} \quad (M \le K)$$
such that:
1. **Full Coverage**: Every file path across all findings is covered by at least one write scope:
   $$\forall f_i \in \mathcal{F}, \forall p \in \text{Paths}(f_i), \exists S_j \in \mathcal{S} \text{ such that } p \subseteq S_j$$
2. **Strict Disjointness (Zero Collisions)**: No two distinct write scopes share paths or have ancestor/descendant relationships:
   $$\forall S_a, S_b \in \mathcal{S} \ (a \ne b) \implies S_a \cap S_b = \emptyset \land S_a \not\subset S_b \land S_b \not\subset S_a$$
3. **Maximal Concurrency**: The partition maximizes $M$ (the number of parallel repair lanes) while maintaining architectural cohesion within individual subsystem directories.

---

## 2. Data Contracts & Type Definitions

```typescript
export interface FindingDetail {
  /** Unique deterministic identifier, e.g. "finding-critic-01" */
  readonly id: string;
  /** Associated prompt requirement ID if known */
  readonly requirement_id?: string;
  /** Severity level */
  readonly severity: "critical" | "important" | "suggestion";
  /** Exact repository-relative file paths exhibiting the defect */
  readonly file_paths: readonly string[];
  /** Precise description of the failure / invariant violation */
  readonly observation: string;
  /** Actionable instructions for fixing the defect */
  readonly remediation: string;
  /** Optional targeted verification gate command */
  readonly revalidation_gate?: string;
}

export interface ScopedRepairCluster {
  /** Synthesized task identifier, e.g. "repair-R1-layout" */
  readonly taskId: string;
  /** Human-readable task label */
  readonly label: string;
  /** Normalized, disjoint directory write scopes */
  readonly writeScope: readonly string[];
  /** Subset of findings assigned to this repair task */
  readonly findings: readonly FindingDetail[];
  /** Synthesized focused verification gate command */
  readonly gateCommand: readonly string[];
  /** Estimated effort (1-5 scale) based on finding count & severity */
  readonly effort: number;
}
```

---

## 3. The 5-Stage Partitioning Pipeline

```
[FindingDetail[] Input]
         │
         ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 1: Path Normalization & Canonicalization              │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 2: Subsystem Boundary & LCA Directory Extraction      │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 3: Initial Finding Clustering by Component Stem       │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 4: Overlap Detection & Deterministic Parent Merge     │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ Stage 5: ScopedRepairCluster Generation & Gate Synthesis    │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 [Disjoint ScopedRepairCluster[] Output for Parallel Dispatch]
```

### Stage 1: Path Normalization & Canonicalization
- Normalize path separators (`\` $\to$ `/`).
- Strip leading `./` and trailing `/`.
- Ensure all paths are strictly repository-relative (rejecting absolute paths or paths traversing outside repository root via `..`).

### Stage 2: Subsystem Boundary & LCA Directory Extraction
For any set of paths belonging to a single finding, compute the **Lowest Common Ancestor (LCA)** directory:
1. Split each path into directory segments: `["src", "components", "EdgeDrawer", "EdgeDrawer.tsx"]`.
2. Compute the shared prefix across all paths in the finding.
3. If the LCA is a single file, expand to its parent directory unless the file is an isolated root configuration (e.g. `vite.config.ts`).
4. Snap to the nearest **Architectural Component Boundary** (e.g., if paths are in `src/engine/layout/clamping.ts` and `src/engine/layout/tree.ts`, snap to `src/engine/layout/`).

### Stage 3: Initial Finding Clustering
- Group findings that resolve to identical LCA directory stems into candidate clusters.
- Associate all related `FindingDetail` records with the candidate cluster.

### Stage 4: Overlap Detection & Deterministic Parent Merge
- Pairwise evaluate all candidate clusters $(C_a, C_b)$ using `checkScopeOverlap(C_a.writeScope, C_b.writeScope)`:
  - If $C_a$ and $C_b$ have exact match or parent-child overlap (e.g. $C_a = \text{"src/engine"}$ and $C_b = \text{"src/engine/layout"}$):
    - **Merge Action**: Collapse $C_b$ into $C_a$, assigning the wider scope $\text{"src/engine"}$ and combining their findings.
    - Repeat until no overlaps exist across any pair in the cluster set.
- **Invariant**: The resulting clusters are guaranteed to pass `analyzeScopeIndependence` with zero collisions.

### Stage 5: Task Synthesis & Gate Generation
- Construct a deterministic `taskId`: `repair-R<round>-<subsystem-slug>` (e.g., `repair-R1-drawer`, `repair-R1-layout`).
- Generate focused test gate commands:
  - If package/subsystem has a co-located test directory (e.g. `tests/unit/drawer`), configure `bun test tests/unit/drawer`.
  - Fallback to repository-wide unit tests targeting the changed scope: `bun test tests`.

---

## 4. Formal Reference Implementation (TypeScript)

```typescript
import { posix } from "node:path";
import type { FindingDetail, ScopedRepairCluster } from "./types.ts";
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
  // If common segments point to a file, take its directory
  const joined = commonSegments.join("/");
  return joined.includes(".") ? posix.dirname(joined) : joined;
}

export function partitionFindingsIntoScopes(
  findings: readonly FindingDetail[],
  repairRound = 1,
): readonly ScopedRepairCluster[] {
  if (findings.length === 0) return [];

  // 1. Initial Cluster per finding based on LCA
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

  // 2. Iterative merge for parent/child or overlapping scopes
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rawClusters.length; i++) {
      for (let j = i + 1; j < rawClusters.length; j++) {
        const a = rawClusters[i]!;
        const b = rawClusters[j]!;
        const overlap = checkScopeOverlap([a.scope], [b.scope]);
        if (overlap.hasOverlap) {
          // Merge b into a, choosing the parent / wider scope
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

  // 3. Synthesize ScopedRepairCluster objects
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

## 5. Edge Cases & Safety Guarantees

| Edge Case Scenario | Algorithmic Handling | Guarantees |
| :--- | :--- | :--- |
| **All findings in single file** | Scope resolves to parent directory containing that file. | Single repair task generated; zero fragmentation. |
| **Findings in shared root files** (e.g. `package.json`, `index.html`) | Scope resolves to root `.`. Overlap detection merges any child subsystem scopes into `.` | Safe single-lane execution; prevents conflicting writes to root manifest. |
| **Findings across 4 completely disjoint modules** | Scopes resolve to `src/moduleA`, `src/moduleB`, `src/moduleC`, `src/moduleD`. | 4 parallel repair tasks created; maximum concurrency with zero write contention. |
| **Nested Subsystem finding + Parent finding** (e.g. `src/components/` and `src/components/EdgeDrawer/`) | Stage 4 merges `EdgeDrawer` into parent `src/components/`. | Eliminates parent-child collision; guarantees DAG compilation passes cleanly. |
