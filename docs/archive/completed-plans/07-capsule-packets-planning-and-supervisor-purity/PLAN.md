# Plan 7: Capsule Memory Purity, Ultra-Lean Packets & Supervisor Isolation

## 1. Context & Problem Statement

Recent long-task execution runs revealed five critical structural defects in how capsules manage memory, packets, and supervisory boundaries:

1. **Packet Bloat (`PACKET_BLOAT_DEFECT`):**
   - `render-packet.ts` dumps 600–1,000 lines of static boilerplate into `packet.md` (entire 170-line role contracts, full 200-line `AGENTS.md` instructions, raw JSON dumps).
   - This floods subagent context windows and dilutes focus away from actual code line numbers and acceptance criteria.
2. **Unused Capsule Planning Directory (`CAPSULE_PLANNING_FOLDER_UNUSED_DEFECT`):**
   - `.olt/capsules/<run>/planning/` is created on disk but left completely empty because `plan:compile` only mutates `state.json`.
3. **Missing Supervisor Packets (`ORCHESTRATOR_PACKET_OMISSION_DEFECT`):**
   - `agent:register` registers `orchestrator-1` and `coordinator-1` in `state.json` but generates no initialization packet on disk.
4. **Supervisor Direct Test Execution & Single-Thread Simulation (`SUPERVISOR_SINGLE_THREAD_EXECUTION_DEFECT`):**
   - The Tier 1 Orchestrator attempted to sequentially execute 6 tasks and run test suites on its own thread rather than dispatching parallel Tier 3 subagents via `invoke_subagent`.
5. **Uneven Validator Pairing (`VALIDATOR_IMPLEMENTER_UNEVEN_PAIRING_DEFECT`):**
   - 6 implementer tasks were leased simultaneously, but only 1 validator was registered, creating a validation bottleneck.

---

## 2. Objectives & Acceptance Criteria

### 2.1 Ultra-Lean Action Briefs ($\le 30$ Lines)

- `packet.md` must be stripped of all static role contracts and `AGENTS.md` dumps.
- `packet.md` must contain strictly:
  1. Identity: Task ID, Title, Attempt #, Lease Token Digest.
  2. Disjoint Write Scope: Exact directories/files assigned.
  3. Action Anchors: Target files, line coordinates (`StartLine`, `EndLine`), symbols, and drop-in chunks.
  4. Allowed Commands: Targeted file-scoped unit test (`bun test <path.test.ts>`).
  5. Actionable Task Checklist: Discrete checkboxes for this specific task.
- Heavy metadata, raw event streams, dependency graphs, and historical logs remain in Capsule Memory on disk and are queried on demand via `task:brief` and `agent:brief`.

### 2.2 Capsule Planning Disk Memory (`planning/`)

- When `plan:compile` seals a plan, it must write:
  1. `planning/plan.md`: Human-readable summary of the objectives, task breakdown, and write scopes.
  2. `planning/dag.txt`: The compiled ASCII topological wave graph.
  3. `planning/requirements.jsonl`: Discrete requirement lines and mapped criteria.

### 2.3 Supervisor Lifecycle Packets

- `agent:register` for `orchestrator` and `coordinator` roles must generate:
  - `packets/orchestrator-1/packet.md`: Prompt SHA, run constraints, and round goals.
  - `packets/coordinator-1/packet.md`: Wave topology, parallel lanes, and lease limits.

### 2.4 Mechanical 1:1 Validator Pairing & Supervisor Purity

- Implementers own 100% of unit test execution.
- Supervisors (Orchestrator, Coordinator, Mind) are mechanically blocked from running test suites (`bun test`, `npm test`, `vitest`).
- Every claimed implementer task must have an assigned validator before `task:submit` / `task:review`.

---

## 3. Implementation Steps

1. **Step 1: Refactor `render-packet.ts`**:
   - Replace massive contract/AGENTS.md concatenations with concise, focused markdown templates ($\le 30$ lines).
2. **Step 2: Update `plan:compile`**:
   - Add file writers in `compiler/` to persist `planning/plan.md`, `planning/dag.txt`, and `planning/requirements.jsonl` upon graph compilation.
3. **Step 3: Update `agent:register`**:
   - Generate initial supervisor packets for `orchestrator` and `coordinator` roles under `packets/<agent-id>/packet.md`.
4. **Step 4: Mechanical Verification**:
   - Add unit tests in `tests/unit/packets/` and `tests/unit/plan/` verifying lean packet size and disk planning persistence.
