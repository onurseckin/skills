# Pillar 1: Elastic Dynamic Hierarchy Scaling & Anti-Linear Linked List

**Directive Reference**: `p91`  
**Status**: ✅ **APPROVED & LOCKED BY USER**  
**Location**: `docs/planning/generation-8/PILLAR_1_DYNAMIC_HIERARCHY_SCALING.md`

---

## 1. Problem Statement: The Linear Linked-List Trap & LLM Serial Laziness

In prior generations, the system suffered from two related failure modes:

1. **The Linear Linked-List Trap**: A 1-file atomic task traversed 4 layers of LLM agents ($\text{Mind} \to \text{Orchestrator} \to \text{Coordinator} \to \text{Implementer} \to \text{Validator}$), wasting 10,000+ tokens and 3–5 minutes on ceremony.
2. **LLM Serial Laziness**: When given a multi-task wave with 5 ready parallel lanes, an LLM Orchestrator left to its own discretion would often serialize the execution (dispatching 1 implementer at a time) because serial execution is cognitively "easier" for an LLM than managing a parallel swarm.

---

## 2. Core Architecture: Elastic Dynamic Scaling

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             ELASTIC HIERARCHY DUAL-PATH ARCHITECTURE                             │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ PATH A: FAST-PATH COMPACTION ] (Single-Task 1-Lane Quick Pass)                                │
│  Condition: Mathematically computed in code when Queue has EXACTLY 1 task ($N = 1$).             │
│                                                                                                  │
│    Mind (Tier 0: Product Owner)                                                                  │
│      │                                                                                           │
│      ▼                                                                                           │
│    Orchestrator (Tier 1: Owns Capsule, Critic & Git Commit)                                      │
│      ├── Implementer (Tier 3: writes code + runs `task:check` tool directly)                     │
│      └── Cognitive Validator (Tier 3: in-lease Socratic review)                                  │
│                                                                                                  │
│  Turnaround: Sub-2 minutes with 0 Coordinator middleman overhead.                                │
│                                                                                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ PATH B: UNBOUNDED MULTI-ORCHESTRATOR & MULTI-COORDINATOR EXPANSION ] (Multi-Task: $N \ge 2$)    │
│  Condition: Multi-task backlog or complex cross-subsystem feature ($P = \lceil W/S \rceil \ge 2$).│
│                                                                                                  │
│    Mind (Tier 0: Chief Architect & Product Owner)                                                │
│      ├── Orchestrator A (Domain: Core Engine & Mind Subsystem)                                   │
│      │    ├── Coordinator 1 (Wave 1: Parallel Lanes 1–5 across disjoint files)                   │
│      │    └── Coordinator 2 (Wave 2: Parallel Lanes 6–10)                                        │
│      │                                                                                           │
│      └── Orchestrator B (Domain: CLI Surface, Registry & Schedulers)                             │
│           └── Coordinator 3 (Wave 1: Parallel Lanes 1–4 across disjoint files)                   │
│                                                                                                  │
│  Concurrency: 10–20+ parallel implementation lanes executing simultaneously.                     │
│  Independent Staging: Disjoint lanes validate and stage without cross-blocking.                  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Approved & Locked Decisions

### ✅ Decision 1.1 — Fast-Path Compaction for Single-Task Runs ($N = 1$)

- When the active queue has exactly 1 task, the Orchestrator acts as the direct supervisor to the Implementer + Validator pair, skipping Coordinator spawning and eliminating 1.5 minutes of latency.

### ✅ Decision 1.2 — Unbounded Multi-Orchestrator Scaling

- Mind dynamically spawns $N$ concurrent Tier 1 Orchestrators partitioned by functional domain (e.g. Engine, CLI, UI/Visualizer) without artificial single-orchestrator ceilings.

### ✅ Decision 1.3 — Multi-Coordinator Wave Partitioning ($\le 5$ Lanes per Coordinator)

- To prevent supervisor context window overflow on large waves:
  - **$\le 5$ parallel lanes**: Managed by **1 Coordinator**.
  - **6–15 parallel lanes**: Partitioned across **2–3 specialized Coordinators** (e.g. `coord-core`, `coord-cli`, `coord-tests`).
  - **Multi-Stack Features**: Partitioned by technology environment (e.g. `coord-typescript`, `coord-python`, `coord-ui`).

### ✅ Decision 1.4 — Independent Disjoint Lane Validation & Staging

- Parallel lanes executing across disjoint write scopes complete validation and stage independently without blocking on unrelated lanes.

### ✅ Decision 1.5 — Anti-Linear Linked-List Invariant

- Formally bans 1-by-1 serial chaining across 4 tiers when tasks can be compacted or parallelized.

### ✅ Decision 1.6 — Hard-Coded Anti-Serialization Mechanical Interlock

- **Zero LLM Discretion on Concurrency**: Wave concurrency is computed mathematically by the harness compiler (`plan:compile`).
- If Wave 1 has $N \ge 2$ ready disjoint lanes, the harness code **mechanically blocks single-subagent dispatches** with:
  `[FALSE_SERIALIZATION_BLUNDER] Wave contains N ready disjoint lanes. You MUST invoke all N subagents in parallel via Subagents: [...].`
- The harness pre-formats the exact JSON dispatch array for `invoke_subagent`, eliminating LLM serial laziness completely.
