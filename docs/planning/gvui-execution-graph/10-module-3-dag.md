# Module 3: Dynamic Repair Wave DAG Compilation

**Document**: `docs/planning/gvui-execution-graph/10-module-3-dag.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Architectural Specification  
**Subsystem**: Graph State Machine & Dynamic Compilation  

---

## 1. The Dynamic Repair Lifecycle & State Machine

When a late-stage validation or Completeness Critic rejects a candidate run, the harness executes a deterministic state transition pipeline that dynamically compiles a **Repair Wave DAG** without losing prior historical evidence:

```
[Late Stage / Completeness Critic Rejection]
                     │
                     ▼
       critic:review --decision request_changes
       (Emits event: "critic-rejected", state: "findings")
                     │
                     ▼
         plan:replan --findings findings.json
         (Runs Scope Partitioning Algorithm)
                     │
                     ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ DAG RE-COMPILATION (Graph Revision N ──► N+1)               │
 │ • Injects dynamic repair tasks: repair-R1-A, repair-R1-B    │
 │ • Sets initial status: "ready" (Wave R)                     │
 │ • Establishes Wave R Validation Barrier                     │
 │ • Blocks gate-run-completion & critic:start                 │
 │ • Emits event: "plan-recompiled"                            │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ PARALLEL REPAIR WAVE EXECUTION (Wave R)                     │
 │ • Implementers claim & submit: repair-R1-A, repair-R1-B     │
 │ • Validators audit via run:exec & task:review --status pass │
 └──────────────────────────────┬──────────────────────────────┘
                                │
                                ▼
 ┌─────────────────────────────────────────────────────────────┐
 │ RE-CONVERGENCE & BARRIER RELEASE                            │
 │ • All Wave R tasks reach status: "done"                     │
 │ • Coordinator re-runs mandatory run gate via run:exec       │
 │ • Authorizes fresh Critic Lease (Attempt 2)                 │
 │ • Completeness Critic seals run via run:complete            │
 └─────────────────────────────────────────────────────────────┘
```

---

## 2. Formal State Transitions in `state.json`

### Transition 1: `critic:reject` (`critic-reviewed` with status `findings`)
```json
{
  "graph_revision": 1,
  "completion_review": {
    "critic_id": "critic-round-1",
    "status": "findings",
    "unresolved_finding_ids": ["F-DRAWER-01", "F-LAYOUT-01"],
    "findings": [
      {
        "id": "F-DRAWER-01",
        "severity": "critical",
        "file_paths": ["src/components/EdgeDetailDrawer/EdgeDrawer.tsx"],
        "observation": "TypeScript error TS2322 in drawer toggle handler",
        "remediation": "Update Props interface to include onToggle callback"
      },
      {
        "id": "F-LAYOUT-01",
        "severity": "important",
        "file_paths": ["src/engine/layout/hierarchical.ts"],
        "observation": "Bounding box clamping fails on negative canvas coordinates",
        "remediation": "Clamp coordinates to zero before layout projection"
      }
    ],
    "review_sha256": "8f3b2a..."
  }
}
```

### Transition 2: `plan:replan` (`plan-recompiled`, Revision $1 \to 2$)
```json
{
  "graph_revision": 2,
  "plan_history": [
    {
      "revision": 1,
      "tasks_count": 3,
      "archived_at": "2026-08-15T01:10:00Z"
    }
  ],
  "tasks": {
    "task-01-types": { "status": "done", "..." : "..." },
    "task-02-drawer": { "status": "done", "..." : "..." },
    "task-03-layout": { "status": "done", "..." : "..." },
    "repair-R1-drawer": {
      "id": "repair-R1-drawer",
      "label": "Repair Wave 1: src/components/EdgeDetailDrawer",
      "status": "ready",
      "write_scope": ["src/components/EdgeDetailDrawer"],
      "dependencies": [],
      "requirement_ids": ["req-drawer-props"],
      "findings": [
        {
          "id": "F-DRAWER-01",
          "status": "open",
          "severity": "critical"
        }
      ],
      "repair_round": 1
    },
    "repair-R1-layout": {
      "id": "repair-R1-layout",
      "label": "Repair Wave 1: src/engine/layout",
      "status": "ready",
      "write_scope": ["src/engine/layout"],
      "dependencies": [],
      "requirement_ids": ["req-layout-clamping"],
      "findings": [
        {
          "id": "F-LAYOUT-01",
          "status": "open",
          "severity": "important"
        }
      ],
      "repair_round": 1
    }
  },
  "completion_critic": null,
  "completion_review": null
}
```

---

## 3. Append-Only Hashed Audit Trail (`events.jsonl`)

Every state mutation generates a cryptographically bound event record in `events.jsonl`:

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

## 4. Re-Convergence & Validation Barrier Invariants

1. **Re-Convergence Barrier**:
   - `completionIssues(state)` in `completion-state.ts` iterates over all tasks in `state.tasks`.
   - If any dynamically added repair task has `status !== "done"`, the run completion preflight **fails closed**.
2. **Fresh Critic Authorization**:
   - When transitioning back to the Critic phase, the previous `completion_critic` lease assignment is invalidated and archived into `completion_critic_history`.
   - A fresh Critic ID (`critic-round-2`) must be authorized via `critic:start`, receiving a brand-new cryptographically random lease token.
3. **Total Coverage of Initial Prompt**:
   - Dynamic repair tasks are linked to the canonical requirement IDs from the original `prompt.md`.
   - The final critic audit verifies that all initial requirements remain satisfied without regression.
