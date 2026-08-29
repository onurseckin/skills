# Blueprint: Capsule Connectivity & Mandatory Turn 1 Registration Interlock

**Domain:** `engine` / `runtime`  
**Priority:** `CRITICAL`  
**Status:** `READY_FOR_EXECUTION`

---

## 1. Problem Statement & Architectural Gap

Currently, subagents dispatched inside Antigravity (Tier 1 Orchestrator, Tier 2 Coordinator, Tier 3 Implementer) run in host RAM but often jump straight to file reads and modifications without executing `bun harness.ts run:init --run <run_id>` or `bun harness.ts task:claim --run <run_id> --task <task_id>` on Turn 1.

As a result:

1. `.olt/capsules/<run_id>/` (`state.json`, `events.jsonl`, `evidence/`) is never instantiated on disk.
2. The harness CLI storage engine has zero visibility into active subagent work.
3. Leases, gate receipts, and task status transitions are lost during session resets or disconnects.

---

## 2. Target Architecture & Invariants

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│               MANDATORY TURN 1 CAPSULE REGISTRATION INTERLOCK                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  [ Tier 1: Meta-Orchestrator ]                                              │
│    • Turn 1 MUST execute: `bun harness.ts run:init --run <run_id>`          │
│    • Result: Instantiates `.olt/capsules/<run_id>/state.json` on disk       │
│                                                                             │
│  [ Tier 2: Domain Coordinator ]                                             │
│    • Turn 1 MUST execute: `bun harness.ts plan:compile --run <run_id>`      │
│    • Result: Writes compiled task DAG into capsule state                    │
│                                                                             │
│  [ Tier 3: Implementer ]                                                    │
│    • Turn 1 MUST execute: `bun harness.ts task:claim --run <id> --task <id>`│
│    • Result: Leases task and records lease token in capsule state           │
│                                                                             │
│  [ Mechanical Enforcement (Gate Interlock) ]                                │
│    • Any tool call or file modification without an active leased token in   │
│      `.olt/capsules/<run_id>/state.json` is BLOCKED with `LEASE_REQUIRED`. │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Implementation Tasks Breakdown

| Task ID          | Component / File                                    | Deliverable                                                                                                                               | Gate Verification                   |
| :--------------- | :-------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| **`task-cap-1`** | `olt/scripts/src/engine/store/capsule/init.ts`      | Implement deterministic auto-initialization for `run:init` ensuring `.olt/capsules/<run_id>/` exists on disk before any subagent work.    | Unit tests in `tests/unit/engine/`  |
| **`task-cap-2`** | `olt/scripts/src/workflow/lease/guard.ts`           | Add mechanical lease verification interlock: reject task submissions and tool modifications if no valid lease exists in `.olt/capsules/`. | Unit tests with mock unleased state |
| **`task-cap-3`** | `olt/scripts/src/cli/commands/run-init.ts`          | Enhance `run:init` CLI command to output clean structured markdown receipts and verify on-disk persistence.                               | CLI execution tests                 |
| **`task-cap-4`** | `olt/agents/orchestrator.yaml` & `coordinator.yaml` | Update agent manifests with mandatory Turn 1 `run:init` and `plan:compile` imperatives.                                                   | Manifest validation test            |
| **`task-cap-5`** | `olt/agents/implementer.yaml`                       | Update implementer manifest with mandatory Turn 1 `task:claim` requirement before reading or editing files.                               | Manifest validation test            |

---

## 4. Acceptance Criteria & Invariants

1. **Deterministic Persistence**: Every active run strictly creates `.olt/capsules/<run_id>/state.json` and `.olt/capsules/<run_id>/events.jsonl` on Turn 1.
2. **Zero Unleased Modifications**: File modifications by implementers without a registered lease in the capsule ledger fail validation.
3. **Modularity & Zero Comments**: All files strictly $\le 300$ physical lines, explicit named exports in `index.ts`, and 0 comments in `.ts` files.
