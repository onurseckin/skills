# Pillar 2: Streamlined Persona Ecosystem & Deterministic CLI Gates

**Directive Reference**: `p91`  
**Status**: ✅ **APPROVED & LOCKED BY USER**  
**Location**: `docs/planning/generation-8/PILLAR_2_STREAMLINED_PERSONA_ECOSYSTEM.md`

---

## 1. Problem Statement: Persona Proliferation & LLM Determinism Bloat

In earlier versions, too many specialized agent roles were created for deterministic tasks:

- `mechanic-validator` was an LLM subagent whose only job was running `tsc` or `oxlint` and reading JSON output—burning thousands of tokens, adding minutes of latency, and occasionally attempting illegal code edits.
- `repairer` was a separate agent spawned when a validator rejected a task, causing unnecessary lease teardown and context loss.
- `planner` and `plan-validator` were spawned as separate subagents even for simple 3-task plans.

---

## 2. Core Architecture: The Streamlined Persona Ecosystem

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            STREAMLINED 2-AGENT + 1-TOOL PIPELINE                                 │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ 1. Implementer Agent ] (The Only Code/Test Writer)                                            │
│    • Confined strictly to its leased `write_scope`.                                              │
│    • Writes implementation code and file-scoped unit tests (`*.test.ts`).                        │
│    • Runs the deterministic CLI tool: `bun harness.ts task:check --task <id>`                    │
│    • Receives instant sub-second pass/fail receipt (`mechanic-report.json`).                     │
│    • Handles 1-hop in-lease repairs directly if validator raises objections (0 repairer agent). │
│                                                                                                  │
│  [ 2. Mechanic Gate Tool ] (Deterministic Script — 0 LLM Tokens, 0 Delay)                        │
│    • NON-AGENT CLI Tool / Harness Gate (`harness.ts task:check`).                               │
│    • For Non-UI Tasks: Runs `tsc --noEmit`, `oxlint`, and AST 0-any audits.                      │
│    • For UI Tasks: Takes screenshots, checks rasterization bytes, and extracts DOM tree hashes.  │
│    • Emits structured JSON evidence receipt automatically in 0.2s.                               │
│                                                                                                  │
│  [ 3. Cognitive Validator Agent ] (Pure Socratic Brain — 0 Commands, 0 Edits)                   │
│    • Reads the implementer's diff + `mechanic-report.json` receipt.                             │
│    • Performs 100% Socratic reasoning: logic correctness, edge cases, requirement alignment.     │
│    • Delivers in-lease critique (`task:probe` / `task:reject --in-lease`) or signs off (`pass`). │
│                                                                                                  │
│  [ 4. Completeness Critic Agent ] (Whole-Run Final Gatekeeper)                                   │
│    • Final whole-diff and requirement certification before git commit/push.                      │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Approved & Locked Decisions

### ✅ Decision 2.1 — Retire `mechanic-validator` as an Agent Role

- Permanently converted into a deterministic CLI tool/gate: `bun harness.ts task:check --task <id>`.
- Runs `tsc --noEmit`, `oxlint`, and AST zero-any enforcement in sub-seconds with 0 LLM token cost.

### ✅ Decision 2.2 — Retire `repairer` as a Separate Agent

- Merged into Implementer via **1-Hop In-Lease Micro-Cycles** (`task:reject --in-lease`). The implementer fixes issues in-lease without releasing the task or spawning extra agents.

### ✅ Decision 2.3 — Integrate Planning Directly into Orchestrator

- Orchestrator replaces standalone planner subagents by executing the **10-Step Deep-Thinking Planning Checklist** directly before dispatching waves.

### ✅ Decision 2.4 — The 5 Golden Pillars

- The core system consists of 5 fundamental roles: `mind` (Tier 0), `orchestrator` (Tier 1), `coordinator` (Tier 2), `implementer` (Tier 3), and `validator` (Cognitive Tier 3), supported by `completeness-critic` and `meta-auditor`.

---

## 4. The 10-Step Orchestrator Deep-Thinking Planning Checklist

To ensure **zero blunders, zero false serialization, and 100% requirement coverage**, every Orchestrator must execute this 10-step checklist before compiling and dispatching any wave:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         ORCHESTRATOR 10-STEP DEEP-THINKING PLANNING CHECKLIST                    │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ STEP 1: Exhaustive Requirement & Acceptance Extraction ]                                      │
│  • Decompose the incoming prompt into explicit, atomic functional deliverables.                  │
│  • Verify no implicit requirement (e.g. CLI flags, doc updates, sync scripts) is missed.         │
│                                                                                                  │
│  [ STEP 2: Disjoint Write Scope Partitioning & Non-Overlap Proof ]                               │
│  • Identify the exact target files for each task.                                                │
│  • Enforce: `Scope(Task A) ∩ Scope(Task B) = ∅` for all tasks intended for the same wave.       │
│                                                                                                  │
│  [ STEP 3: Exact-Anchor Compilation (Line Coordinates & Symbol Signatures) ]                     │
│  • Use AST extraction to identify exact target line ranges (`#L120-L160`) and function names.    │
│  • Package exact drop-in replacement chunks into task briefings to eliminate discovery reads.   │
│                                                                                                  │
│  [ STEP 4: Deterministic Mechanical Gate Assignment ]                                            │
│  • Assign `task:check` gate commands (`tsc --noEmit`, `oxlint`, AST 0-any audits) per task.     │
│  • For UI tasks, assign Dual-Channel rasterization and DOM metric extraction gates.              │
│                                                                                                  │
│  [ STEP 5: Dynamic Concurrency & Wave Partitioning ]                                             │
│  • Calculate Brent Work/Span ($P = \lceil W / S \rceil$).                                        │
│  • If wave lanes > 5, partition across multiple specialized Coordinators (e.g. core, cli, tests).│
│                                                                                                  │
│  [ STEP 6: Adversarial Gate Proofs (AGP Falsification Checks) ]                                  │
│  • Verify that every task gate is genuinely falsifiable (a broken change WILL fail the gate).    │
│  • Prohibit mock receipts, synthetic passes, or unconditional `exit 0` assertions.               │
│                                                                                                  │
│  [ STEP 7: 1-Hop In-Lease Pairing Configuration ]                                                │
│  • Pair every Implementer with a dedicated Cognitive Validator.                                  │
│  • Configure `--in-lease` fast micro-cycle routing for instant Socratic critique and repairs.   │
│                                                                                                  │
│  [ STEP 8: Bounded Read Scope & Anti-Wandering ACL Generation ]                                  │
│  • Declare explicit `read_scope` arrays in task metadata (`runtime/agent-<id>.json`).           │
│  • Bound file read access strictly to target files and direct import dependencies.               │
│                                                                                                  │
│  [ STEP 9: Whole-Diff Completeness Criteria Definition ]                                         │
│  • Pre-define the exact whole-run integration assertions for the Completeness Critic.            │
│  • Ensure full test suite execution (`bun test`) is staged for final critic review.              │
│                                                                                                  │
│  [ STEP 10: Anti-Serialization Pre-Flight Interlock Verification ]                              │
│  • Verify that all ready disjoint lanes are formatted into the 1-shot `Subagents: [...]` array. │
│  • Run `bun harness.ts plan:compile` and ensure 0 `FALSE_SERIALIZATION_BLUNDER` errors exist.    │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```
