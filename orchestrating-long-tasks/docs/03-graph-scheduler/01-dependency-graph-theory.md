# 01. Dependency Graph Theory & Schema

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)

---

## 🕸️ Why a Formal Graph?

Complex engineering projects cannot be represented as simple linear "to-do lists." In any non-trivial codebase:

- Task D depends on Task A and Task B.
- Task C can run completely in parallel with Task A.
- Task E produces an artifact consumed by Task F.
- Multiple tasks might relate to the same semantic topic or feature requirement.

To model these multi-dimensional relationships deterministically, `orchestrating-long-tasks` uses a **Strict Relational Dependency Graph** defined in `planning/graph.json`.

---

## 🏷️ The 8 Node Types

The graph schema recognizes exactly eight formal node types:

```text
+-----------------------------------------------------------------------------------------------+
|                                      THE 8 GRAPH NODE TYPES                                   |
+-----------------------------------------------------------------------------------------------+
|                                                                                               |
|  1. requirement  ---> An atomic, testable obligation decomposed from the prompt.              |
|  2. task         ---> An executable unit of work with exclusive write scopes and gates.       |
|  3. artifact     ---> A concrete deliverable or file collection produced by a task.          |
|  4. gate         ---> A literal, non-interactive command contract proving task acceptance.    |
|  5. agent        ---> A named identity leased to execute, validate, or criticize.            |
|  6. finding      ---> A structured defect report issued by an independent validator.          |
|  7. decision     ---> An audited user authority decision (grant/decline) or architectural choice|
|  8. topic        ---> A high-level semantic grouping or domain concept.                      |
|                                                                                               |
+-----------------------------------------------------------------------------------------------+
```

---

## 🔗 The 10 Edge Types & Directionality

Edges represent typed relationships between nodes. The vocabulary is strictly closed to prevent ambiguity:

| Edge Type             | Valid Source Node         | Valid Target Node      | Meaning                                                                              |
| :-------------------- | :------------------------ | :--------------------- | :----------------------------------------------------------------------------------- |
| **`depends_on`**      | `task`                    | `task` (Prerequisite)  | **Directional execution prerequisite.** Target must be `done` before Source can run. |
| **`implements`**      | `task`                    | `requirement`          | Declares which atomic requirements the task fulfills.                                |
| **`produces`**        | `task`                    | `artifact`             | Declares the deliverables created by this task.                                      |
| **`validates`**       | `gate` / `agent`          | `task` / `requirement` | Binds verification evidence to work.                                                 |
| **`evidenced_by`**    | `requirement` / `finding` | `gate` / `command`     | Points to command execution receipts.                                                |
| **`assigned_to`**     | `task`                    | `agent`                | Records worker leasing.                                                              |
| **`discovered_from`** | `finding`                 | `task` / `gate`        | Traces defect origin.                                                                |
| **`supersedes`**      | `task` / `artifact`       | `task` / `artifact`    | Versioning and replacement links.                                                    |
| **`blocks`**          | `finding`                 | `task`                 | Prevents task completion.                                                            |
| **`relates_to`**      | Any                       | Any                    | General semantic relation (can form cycles).                                         |

---

## 🔄 Execution DAG vs. Relational Cycles

The harness makes a critical distinction between **Execution Dependencies** and **Semantic Relations**:

1. **`depends_on` (Execution Graph): MUST BE A DAG (Directed Acyclic Graph)**
   - Cyclic dependencies (`Task A -> Task B -> Task A`) represent deadlock and are **strictly rejected** during `validate`.
   - The graph engine runs a topological cycle-detection algorithm on all `depends_on` edges before plan application.

2. **`relates_to` (Semantic Graph): CYCLES PERMITTED**
   - Topic nodes and semantic concepts (e.g. `Auth System` $\leftrightarrow$ `Database Layer`) can have bidirectional or cyclic relations without affecting task execution.

---

## 📜 Full `graph.json` Schema Example

```json
{
  "schema": "harness.graph",
  "version": 1,
  "revision": 1,
  "nodes": [
    {
      "id": "req-1",
      "type": "requirement",
      "label": "R-001",
      "requirement_id": "R-001"
    },
    {
      "id": "art-1",
      "type": "artifact",
      "label": "Prompt capsule module"
    },
    {
      "id": "task-1",
      "type": "task",
      "label": "Implement prompt capsule",
      "requirement_ids": ["R-001"],
      "write_scope": ["src/store"],
      "resource_scope": [],
      "artifact_ids": ["art-1"],
      "status": "ready",
      "priority": 100,
      "effort": 3,
      "created_order": 0
    }
  ],
  "edges": [
    { "source": "task-1", "target": "req-1", "type": "implements" },
    { "source": "task-1", "target": "art-1", "type": "produces" }
  ],
  "gates": [
    {
      "id": "gate-task-1",
      "command": ["bun", "test", "tests/store/prompt.test.ts"],
      "cwd": ".",
      "scope": "task",
      "requirement_ids": ["R-001"],
      "mandatory": true
    }
  ]
}
```

---

[⬅ Previous: Authority Decisions](../02-requirements/03-authority-decisions-and-dispositions.md) | [Master Table of Contents](../README.md) | [Next: Topological Conflict-Free Batching ➡](./02-topological-conflict-free-batching.md)
