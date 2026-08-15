# Orchestrating Long Tasks: Architecture Improvements & Planning

**Created**: 2026-08-14  
**Status**: In Review & Alignment  
**Location**: `docs/planning/orchestrating-long-tasks-enhancements/01-architecture-improvements-plan.md`

---

## 1. Executive Summary & Goals

The `orchestrating-long-tasks` skill provides durable, graph-scheduled, independently validated multi-agent execution. Based on real-world usage and recent stress-testing (e.g. migrating test suites and achieving 100% unit test coverage), three significant architectural opportunities have been identified:

1. **Storage Hygiene**: Run capsules currently create and overuse a generic `tmp/` folder, blurring the line between ephemeral scratch and formal, verifiable evidence/findings.
2. **Parallelism Discovery & Enforcement**: Planning defaults to sequential workflows even when tasks operate on completely disjoint file scopes and independent subsystems. The system needs automated scope independence analysis and validation feedback.
3. **Thread & Agent Hierarchy Isolation**: The interactive main chat thread frequently gets bogged down by subagent progress messages and tool execution loops. A strict two-tier coordinator pattern is needed to keep the user conversation clean, responsive, and uninterrupted.

---

## 2. Feature Deep-Dives

```
                               ┌─────────────────────────────┐
                               │  Interactive User & Host    │
                               │        (Main Thread)        │
                               └──────────────┬──────────────┘
                                              │ Spawns 1 Coordinator
                                              ▼
                               ┌─────────────────────────────┐
                               │   Background Run Director   │
                               │        (Coordinator)        │
                               └──────┬───────┬───────┬──────┘
                   Spawns & Receives  │       │       │  Directly in Background
                                      ▼       ▼       ▼
                                ┌─────────┐ ┌─────────┐ ┌─────────┐
                                │ Worker  │ │ Worker  │ │Validator│
                                │ (Lane 1)│ │ (Lane 2)│ │ (Lane 3)│
                                └─────────┘ └─────────┘ └─────────┘
```

---

### Feature 1: Clean Capsule Taxonomy (Deprecate `tmp/` & Enforce Structured Storage)

#### Current State & Problems
- `initRun` in `orchestrating-long-tasks/scripts/src/store/capsule.ts` initializes `["packets", "evidence", "findings", "commands", "tmp"]`.
- Because `.capsules/<run_id>/tmp/` exists, agents and CLI helpers dump arbitrary scratch files, draft reports, unformatted logs, and temporary markdown files into `tmp/`.
- A capsule is already a dedicated, isolated directory for a specific run. Having an internal `tmp/` creates an unstructured junk drawer that bypasses verifiable schemas.

#### Proposed Target Architecture
1. **Remove `tmp/` directory initialization**:
   The capsule layout will strictly contain:
   ```text
   .capsules/<run_id>/
   ├── prompt.md         # Immutable prompt bytes (SHA-256 bound)
   ├── manifest.json     # Run manifest, timestamps, versions, assurance
   ├── requirements.json # Atomic requirements, acceptance criteria, prompt mapping
   ├── graph.json        # Directed acyclic graph of tasks, gates, artifacts, scopes
   ├── state.json        # Authoritative state and event stream index
   ├── packets/          # Immutable role-bound context bundles (implementer, validator, critic)
   ├── evidence/         # Verifiable test logs, diff snapshots, command proofs
   ├── findings/         # Formal reviewer rejections, audit findings, security flags
   ├── reports/          # Implementer submission reports & validator review decisions
   └── commands/         # Raw execution logs and stdout/stderr streams
   ```
2. **Storage Rules**:
   - **Command Proof & Test Runs**: Persisted directly to `evidence/<command_id>.json` / `evidence/<command_id>.log`.
   - **Validation & Critic Objections**: Persisted directly to `findings/<finding_id>.json`.
   - **Implementation & Review Reports**: Persisted directly to `reports/<task_id>-submission.json` / `reports/<task_id>-review.json`.
   - **Ephemeral Scratch**: Transient files created by toolchains or shell scripts must use OS-level temporary locations (`/tmp` or the agent's scratch dir) and be cleaned up immediately, never committed to `.capsules/`.

---

### Feature 2: Automated Parallelism Discovery, Scope Independence & Validation

#### Current State & Problems
- The planner often generates linear task sequences (`task-1 -> task-2 -> task-3`) even when requirements touch completely disjoint subsystems (e.g. `src/installer` vs `src/cli` vs `src/store`).
- No pre-planning analysis checks if write scopes overlap.
- The `validate` CLI command validates schema syntax and cycles, but does not identify or warn about unnecessary task serialization.

#### Proposed Target Architecture
1. **Scope Independence & Decomposition Engine**:
   - During requirement compilation, analyze target file paths, directories, and subsystem boundaries.
   - Cluster independent requirements into orthogonal tasks with non-overlapping `write_scope` definitions.
   - Default `dependencies: []` for all disjoint tasks so the scheduler can immediately dispatch them concurrently.
2. **Parallelism Validation & Feedback**:
   - Add a rule to `bun harness.ts validate`:
     - If two tasks have independent requirements and non-overlapping `write_scope` entries, but Task B lists Task A as a dependency without causal artifact flow, emit a validation issue/warning:
       `"Parallelism Opportunity: task-2 and task-3 have non-overlapping write scopes; unnecessary sequential dependency detected."`
3. **Concurrency Scheduling**:
   - Harmonize task priorities for independent clusters so `bun harness.ts schedule --max-parallel <N>` fills all available host agent slots.

---

### Feature 3: Two-Tier Agent Architecture & Main Thread Isolation

#### Current State & Problems
- When a long task is initiated from the main chat session, the main thread often dispatches worker agents directly.
- In native agent messaging frameworks, subagents send completion and error messages to their immediate parent.
- When the main thread is the parent, all worker chatter, partial logs, and tool steps flood the interactive conversation, freezing the user's chat experience.

#### Proposed Target Architecture
1. **Tier 1: Main Interactive Assistant (Chat Thread)**:
   - Remains 100% focused on conversational interaction with the user.
   - Spawns **exactly one** child: the `Background Run Coordinator`.
   - Never runs implementer/validator tool loops or background polls directly.
2. **Tier 2: Background Run Coordinator**:
   - Runs in its own isolated subagent thread.
   - Holds the lifecycle of the harness run capsule.
   - Equipped with subagent tools (`enable_subagent_tools: true`).
   - Spawns and supervises all Tier 3 workers (planners, implementers, validators, critics).
3. **Tier 3: Worker & Validator Subagents**:
   - Child agents of the Background Run Coordinator.
   - All subagent `send_message` completions and progress updates route directly to the Background Run Coordinator in the background tree.
4. **Milestone Reporting Contract**:
   - The Background Run Coordinator only messages the Main Assistant at major lifecycle boundaries:
     - Run initialization & plan validation.
     - Phase completion (e.g. "All 4 parallel test suites completed; entering validation").
     - Final completeness critic sign-off or escalation.

---

## 3. Decision Log & Alignment Matrix

| Topic | Options | Trade-offs | Proposed Recommendation | Status |
| :--- | :--- | :--- | :--- | :--- |
| **Capsule `tmp/` Removal** | **A.** Delete `tmp/`, enforce `evidence/`, `findings/`, `reports/`.<br>**B.** Keep `tmp/` as unrestricted scratch. | **A** guarantees 100% structured auditability.<br>**B** allows lazy scratch dumping and messy capsules. | **Option A**: Remove `tmp/` and enforce strict schema directories. | **Pending User Review** |
| **Parallelism Validation Enforcement** | **A.** Soft Warning (advisory in `validate` output).<br>**B.** Strict Error (rejects `plan-apply` unless justified).<br>**C.** Configurable flag (`--strict-parallel`). | **A** is flexible.<br>**B** prevents agents from accidentally serializing parallel work.<br>**C** adds CLI complexity. | **Option A / C**: Emit warning by default with clear remediation guidance. | **Pending User Review** |
| **Agent Coordination Tier** | **A.** Two-Tier (Main -> Coordinator -> Workers).<br>**B.** Single-Tier (Main manages all workers). | **A** guarantees pristine, interactive chat with zero subagent spam.<br>**B** clutters chat and blocks user conversation. | **Option A**: Two-Tier Coordinator architecture. | **Pending User Review** |

---

## 4. Next Steps
1. Discuss and lock decisions for each of the 3 topics above.
2. Formulate implementation specifications for:
   - Code updates in `orchestrating-long-tasks/scripts/src/store/capsule.ts` and CLI commands.
   - Skill instruction updates in `orchestrating-long-tasks/SKILL.md` and reference guides.
   - Parallelism analyzer addition to `orchestrating-long-tasks/scripts/src/graph/`.
   - Host adapter multi-tier subagent spawning patterns.
