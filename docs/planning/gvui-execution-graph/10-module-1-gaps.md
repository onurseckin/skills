# Module 1: Real Codebase Analysis & Gaps

**Document**: `docs/planning/gvui-execution-graph/10-module-1-gaps.md`  
**Date**: 2026-08-15  
**Status**: Authoritative Technical Specification & Gap Analysis  
**Repository Target**: `skills/orchestrating-long-tasks`

---

## 1. Executive Summary & Problem Formulation

In long-running autonomous multi-agent engineering workflows, tasks are scheduled in topological DAGs with disjoint write scopes. However, when execution reaches the final phase—**Whole-Run Validation** and the **Completeness Critic**—all previous implementer and validator subagents have concluded and gone idle. At this point, only a single agent remains active: the Tier 3 Completeness Critic (or Tier 2 Coordinator).

If this late-stage agent detects compilation errors, type mismatches, broken regression assertions, or missing prompt requirements, a severe systemic failure occurs if the harness lacks a structured **Cascading Fan-Back Protocol**:

### The "Monolithic Single-Agent Trap" Anti-Pattern

Without a structured replanning protocol, the lone agent attempts to remediate all discovered defects directly within its own session. This triggers four catastrophic failure modes:

1. **Violation of Disjoint Write Scopes**: A single agent modifies files across multiple independent subsystems (e.g., React UI components, WebAssembly layout kernels, and CLI scripts), obliterating the core spatial isolation guarantees of the orchestrator.
2. **Destruction of Independent Adversarial Validation**: The agent reviews, writes, and tests its own code modifications without an independent, non-anchored validator auditing the work.
3. **Context Window Saturation & Semantic Drift**: Loading massive diffs and debugging logs across disparate subsystems rapidly exhausts the model's effective context window, leading to hallucinated APIs, broken imports, and cascading syntax errors.
4. **Execution Bottleneck**: Multi-threaded, parallel execution collapses into a slow, brittle single thread.

---

## 2. In-Depth Inspection of the Current Codebase

A systematic audit of the `orchestrating-long-tasks` skill implementation reveals specific structural gaps across its CLI commands, workflow engine, agent definitions, and documentation references:

### A. CLI Commands (`scripts/src/cli/commands/`)

#### 1. `critic-ops.ts` (`criticReviewCommand`)

- **Current Implementation**:
  - Accepts `--decision approve` or `--decision request_changes`.
  - When `decision === "request_changes"`, the command constructs a single hardcoded finding (`finding-critic-01`) associated with the first requirement in the state (`state.requirements[0]?.id ?? "req-1"`).
  - Flags supported: `--run`, `--critic`, `--token`, `--decision`, `--summary`, `--finding`, `--review`.
- **Gaps Identified**:
  - **No Structured Multi-Finding Ingestion**: There is no mechanism to pass a structured array or JSON payload of multiple findings across different files/subsystems (`FindingDetail[]`).
  - **No Path Association**: Findings do not explicitly record structured file paths (`paths: string[]`), making automated directory clustering impossible.
  - **Missing Dedicated `critic:reject` Command**: Critic rejection is currently an overload of `critic:review --decision request_changes` without dedicated validation of finding severity or scope.

#### 2. `plan.ts` (`planAddCommand` & `planCompileCommand`)

- **Current Implementation**:
  - `planAddCommand` enforces a strict invariant:
    ```typescript
    if (state.graph !== undefined && state.graph !== null) {
      throw new HarnessError("INVALID_STATE", "cannot add tasks to compiled plan");
    }
    ```
  - `planCompileCommand` computes concurrency waves and writes `graphDocument` at `revision = 1`.
- **Gaps Identified**:
  - **Immutability Barrier Prevents Dynamic Repair Waves**: Once a plan is compiled, new tasks cannot be registered into `state.planning_buffer` without a dedicated `plan:replan` or repair compilation command.
  - **No Revision Increment Logic**: While `guardPlanRevision` and `graph_revision` exist in the schema, the CLI does not expose a command to transition from Revision $N \to N+1$ with injected repair tasks.

#### 3. `task-ops.ts`, `task-review.ts`, `task-claim.ts`

- **Current Implementation**:
  - Supports task claiming (`task:claim`), heartbeats, submissions (`task:submit`), validation initiation (`task:validate-start`), and reviews (`task:review`, `task:reject`).
  - `task:reject` allows intra-task repair rounds on the _same_ pre-existing task, incrementing `repair_rounds` up to 5.
- **Gaps Identified**:
  - **Scope Limitation to Existing Tasks**: Intra-task repair only works for defects discovered by a validator _during_ that specific task's lifecycle. It cannot handle cross-cutting bugs discovered later during whole-run integration or critic audit.
  - **No Fan-Out Capability**: If a late gate fails due to defects spanning 3 distinct modules, `task:reject` cannot split the failure into 3 parallel repair tasks.

#### 4. `execute.ts`

- **Current Implementation**:
  - Maps CLI arguments to commands (`plan:init`, `plan:add`, `plan:compile`, `plan:status`, `queue:*`, `task:*`, `critic:*`, `run:*`, `summary:*`).
- **Gaps Identified**:
  - Lacks entries for `critic:reject` and `plan:replan` (or `plan:repair-wave`).

---

### B. Agent Protocol Definitions (`agents/`)

#### 1. `critic.yaml`

- **Current Text**: Instructs the critic to inspect `prompt.md`, `git diff`, and run gates. If defects exist, run `critic:review --decision request_changes`.
- **Gaps Identified**:
  - Lacks an explicit, non-negotiable **"Read-Only / No-Edit Invariant"**.
  - Does not mandate that the Critic must output structured JSON findings with exact file paths.
  - Does not instruct the Critic to immediately yield control back to the Coordinator for parallel fan-back dispatch.

#### 2. `coordinator.yaml`

- **Current Text**: Covers Phases 1–5 (Planning, Waves, Validation, Repair, Critic). In Phase 4, mentions routing findings back to the original worker.
- **Gaps Identified**:
  - Assumes all repairs are intra-task (Round 1 $\to$ Round 2 for Task $T_i$).
  - Missing the **Dynamic Scope Partitioning & Batch Re-Invocation** algorithm when receiving a late-stage Critic rejection.
  - Lacks explicit instructions for constructing parallel `invoke_subagent` batch payloads for multi-lane repair waves.

---

### C. Protocol & State Specifications (`references/`)

#### 1. `references/protocol.md`

- Documents Section 7 ("Repair with bounded feedback") and Section 8 ("Gates and completeness"), but restricts repair loops to the single-task level.
- Does not define the lifecycle of a **Repair Wave DAG** (`Wave R`), its concurrency barriers, or how the state re-converges to `critic:start`.

#### 2. `references/state-model.md`

- Schema defines `completion_reviews`, `findings`, and `tasks`, but lacks explicit state transition definitions for `status: "repaired"` or dynamic task injection under graph revisions $> 1$.

---

## 3. Comparison Matrix: Current State vs. Target Cascading Protocol

| Feature / Subsystem          | Current State (`orchestrating-long-tasks`)                                          | Target Cascading Protocol (`Protocol 10`)                                                                                           |
| :--------------------------- | :---------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| **Critic Defect Action**     | Emits single textual `--finding` string; agent often tempted to edit code directly. | Emits structured `FindingDetail[]` with exact file paths via `critic:reject`; strictly forbidden from writing code.                 |
| **Replanning Mechanism**     | Plan is frozen after initial compilation (`plan:compile`); cannot add tasks.        | Dynamic `plan:replan` partitions findings into disjoint `write_scope` clusters and increments `graph_revision`.                     |
| **Repair Concurrency**       | Serial single-task re-run or single-agent manual edits.                             | Parallel Concurrency `Wave R` dispatching multiple Implementer-Validator subagent pairs simultaneously.                             |
| **Dispatch Mode**            | Serial agent invocation loops.                                                      | Single batch `invoke_subagent` call with complete role sanitization and zero-noise prompts.                                         |
| **Re-Convergence Barrier**   | Ad-hoc manual re-test.                                                              | Deterministic DAG barrier: Run-level completion gate and `critic:start` unlock only when all `Wave R` repair tasks pass validation. |
| **Cryptographic Provenance** | Review hashes exist, but repair wave lineage is untracked across graph revisions.   | Full event sourcing in `events.jsonl` linking `critic-rejected` $\to$ `plan-recompiled` $\to$ `task-claimed` $\to$ `run-completed`. |

---

## 4. Architectural Requirements for Protocol 10

To eliminate the monolithic single-agent failure mode permanently, the specification must provide:

1. **Deterministic Scope Partitioning Algorithm**: An exact clustering algorithm that groups arbitrary file paths into disjoint directory scopes without overlaps or parent-child collisions.
2. **Dynamic Repair Wave DAG Compiler**: Formal state machine rules and transaction semantics for `plan:replan`.
3. **Parallel Batch Subagent Invocation Schema**: Exact templates and JSON payloads for coordinating multi-lane repair waves.
4. **End-to-End Verification Proofs**: Concrete worked examples demonstrating end-to-end execution without manual intervention.
