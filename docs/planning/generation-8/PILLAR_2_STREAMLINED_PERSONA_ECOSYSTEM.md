# Pillar 2: Streamlined Persona Ecosystem & Deterministic CLI Gates

**Directive Reference**: `p91`  
**Status**: 🛠️ In Review & Adversarial Questioning  
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

## 3. Currently Locked Decisions (Ready for Questioning)

1. **Decision 2.1 — Retire `mechanic-validator` as an Agent Role**:
   - Converted permanently to a deterministic CLI tool/gate (`harness.ts task:check`).
2. **Decision 2.2 — Retire `repairer` as a Separate Agent**:
   - Merged into Implementer via **1-Hop In-Lease Micro-Cycles** (`task:reject --in-lease`).
3. **Decision 2.3 — Integrate Planning into Orchestrator**:
   - Orchestrator uses a built-in **10-Step Self-Check Planning Checklist** to compile and validate DAGs directly without spawning separate planner agents.
4. **Decision 2.4 — The 5 Golden Pillars**:
   - The core system consists of 5 fundamental roles: `mind` (Tier 0), `orchestrator` (Tier 1), `coordinator` (Tier 2), `implementer` (Tier 3), `validator` (Tier 3 Cognitive), supported by `completeness-critic` and `meta-auditor`.
