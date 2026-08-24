# Skills Repository Documentation Index

[![Diátaxis Framework](https://img.shields.io/badge/docs-Diátaxis_Framework-blue.svg)](#-diátaxis-documentation-navigation-matrix)
[![TypeScript Strict](https://img.shields.io/badge/typescript-strict_0_any-blue.svg)](../tsconfig.json)
[![Zero Dependencies](https://img.shields.io/badge/dependencies-0_runtime-green.svg)](../package.json)
[![Bun Native](https://img.shields.io/badge/runtime-Bun_Native-orange.svg)](../bunfig.toml)
[![Multi-Client Ready](https://img.shields.io/badge/multi--client-Antigravity_%7C_Claude_%7C_Codex_%7C_ChatGPT-purple.svg)](../AGENTS.md)

Welcome to the central documentation index for the **`@onurseckin/skills`** multi-skill ecosystem.

This root `docs/` directory is **strictly reserved** for **repository-wide multi-skill collection guidelines**, high-level architectural navigation, cross-cutting educational manuals, and the completed engineering plan archive.

---

## 🏛️ Repository Architecture & File System Map

The repository maintains strict boundary separation across root entrypoints, repository guidelines, canonical skill specifications, deep reference manuals, and ephemeral execution state:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    REPOSITORY ARCHITECTURE & FILE TREE                                  │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                         │
│  skills/ (Repository Root)                                                                              │
│  ├── README.md                                --> Monorepo Overview, Quickstart & Client Installation   │
│  ├── AGENTS.md                                --> Multi-Agent Governance & Universal Role System SSoT   │
│  ├── package.json                             --> Zero-dependency Bun manifest & scripts                │
│  ├── bunfig.toml                              --> Native Bun runtime configuration                      │
│  ├── tsconfig.json                            --> TypeScript Strict mode configuration (0 any)          │
│  │                                                                                                      │
│  ├── docs/                                    --> Central Documentation Hub                             │
│  │   ├── README.md                            --> Master Documentation Index (You Are Here)             │
│  │   ├── SKILL_COLLECTION_GUIDELINES.md       --> Monorepo Authoring, Invariants & Quality Standards    │
│  │   ├── olt/                                 --> 10-Chapter OLT Educational Manual (Diátaxis)          │
│  │   │   ├── README.md                        --> OLT Educational Manual Master Index                   │
│  │   │   ├── 01-foundations/ ... 10-tutorial/ --> 30 in-depth architectural deep-dives                  │
│  │   └── archive/                                                                                       │
│  │       └── completed-plans/                 --> Archive of 30+ completed architectural execution plans│
│  │                                                                                                      │
│  ├── olt/                                     --> Canonical "Orchestrating Long Tasks" Skill            │
│  │   ├── SKILL.md                             --> Universal Skill Specification & Activation Triggers   │
│  │   ├── AGENTS.md                            --> Skill-specific Agent Capability Contracts             │
│  │   ├── agents/                              --> Agent Persona Descriptors (*.yaml)                    │
│  │   ├── checklists/                          --> Operational Review Checklists (*.md)                  │
│  │   ├── references/                          --> Technical Specifications, Protocols & CLI Manifests   │
│  │   └── scripts/                             --> Zero-dependency Executable Runtime Harness (Bun/TS)   │
│  │                                                                                                      │
│  └── .olt/                                    --> Governance & Ephemeral Runtime State (Git-tracked/Ign)│
│      ├── policy.json                          --> Repository Autonomy Policy & Authorization Rules      │
│      ├── backlog.jsonl                        --> Active Repository Backlog & Task Queue                │
│      ├── defects.jsonl                        --> Production Defect Ledger & RCA Records                │
│      ├── memory.json                          --> Cross-session Operational Long-Term Memory            │
│      ├── telemetry.jsonl                      --> Multi-Agent Model & Token Telemetry                   │
│      └── capsules/<run-id>/                   --> Ephemeral Execution Run Capsules & Audit Records      │
│                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏗️ Multi-Agent Orchestration Architecture

The system enforces a **4-Tier Workforce Hierarchy** and a mandatory **Validation Pairing Invariant** to guarantee deterministic execution, eliminate context decay, and enforce supervisory purity:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    4-TIER MULTI-AGENT HIERARCHY                                         │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                         │
│  [ Tier 0: Autonomous Mind ]  (Infinite Cadence Background Loop)                                        │
│  • Autonomous Backlog Triage & Ingestion        • Defect Lifecycle & Root Cause Allocation              │
│  • Repository Charter & Invariant Preservation  • Proactive Run Spawning & Self-Healing Governance      │
│                                │                                                                        │
│                                ▼ spawns                                                                 │
│  [ Tier 1: Interactive Session / Orchestrator ]  (Supervisor Purity)                                    │
│  • Dedicated exclusively to user interaction    • Requirements intake & prompt capture (prompt.md)      │
│  • Zero worker tool chatter or direct coding    • Spawns and supervises Run Coordinator                 │
│                                │                                                                        │
│                                ▼ spawns                                                                 │
│  [ Tier 2: Run Coordinator ]  (Capsule & DAG Lifecycle Authority)                                      │
│  • Capsule lifecycle & flock lock management    • Topological DAG batching & dependency resolution      │
│  • Wave scheduling & write-scope isolation      • Continuous task dispatch up to max_parallel           │
│                                │                                                                        │
│                                ▼ spawns concurrently (Paired Workforce)                                 │
│  ┌──────────────────────────────────────────────┬────────────────────────────────────────────────────┐  │
│  │          Tier 3: Paired Implementer          │             Tier 3: Paired Validator               │  │
│  │  • Leased disjoint write scope (`task:claim`)│  • Independent adversary (never same session)      │  │
│  │  • Direct code modification & test authoring │  • Mandatory probe execution & evidence collection │  │
│  │  • Zero any, 0 lint/compiler suppressions    • Formal gate certification (`finding:record`)       │  │
│  └──────────────────────┬───────────────────────┴────────────────────────────────────────────────────┘  │
│                         │ branch:open (dynamic runtime sub-tasks)                                       │
│                         ▼                                                                               │
│  ┌───────────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │              Execution-Time Subagents (sub-implementer / sub-validator / sub-investigator)        │  │
│  │  • Ephemeral division of currently held lease • Parent lease clock frozen during sub-execution    │  │
│  └───────────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                         │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 Diátaxis Documentation Navigation Matrix

Our documentation follows the **Diátaxis Documentation Framework**, systematically organizing all guides across learning goals, problem-solving, reference details, and theoretical foundations:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                   DIÁTAXIS NAVIGATION MATRIX                                            │
├──────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│               PRACTICAL GOALS                │                   THEORETICAL CONCEPTS                   │
├──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│  LEARNING-ORIENTED:                          │  UNDERSTANDING-ORIENTED:                                 │
│  [ TUTORIALS ]                               │  [ EXPLANATION ]                                         │
│                                              │                                                          │
│  • End-to-End Run Playbook                   │  • Why Long Tasks Fail                                   │
│    Step-by-step capsule lifecycle guide      │    Context decay, write collisions, sycophancy           │
│    ➔ [Run Playbook](../olt/references/run-playbook.md)│ ➔ [Protocol Specification](../olt/references/protocol.md)│
│                                              │    ➔ [Foundations: Failures](./olt/01-foundations/01-why-long-tasks-fail.md)│
│  • Hands-on 10-Stage Tutorial                │                                                          │
│    Complete walkthrough of a live task run   │  • DAG Scheduling & Concurrency Theory                   │
│    ➔ [Hands-on Tutorial](./olt/10-tutorial-and-cli/01-end-to-end-tutorial.md)│ Brent's theorem P = ⌈W / S⌉ & wave scaling       │
│    ➔ [Lifecycle Walkthrough](./olt/01-foundations/03-lifecycle-walkthrough.md)│ ➔ [Topology Exemplar](../olt/references/topology-exemplar.md)│
│                                              │    ➔ [Graph Scheduler](./olt/03-graph-scheduler/02-topological-conflict-free-batching.md)│
│                                              │                                                          │
│                                              │  • Adversarial Validation Philosophy                     │
│                                              │    Separation of concerns & independent proof            │
│                                              │    ➔ [Adversarial Validation](./olt/06-validation-repair/01-adversarial-validation-philosophy.md)│
│                                              │                                                          │
│                                              │  • 4-Tier Hierarchy & Supervisory Purity                 │
│                                              │    Architectural defense against context pollution       │
│                                              │    ➔ [Workforce Hierarchy](./olt/04-multi-agent/01-host-agnostic-architecture.md)│
│                                              │    ➔ [Universal AGENTS.md](../AGENTS.md)                 │
├──────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│  PROBLEM-ORIENTED:                           │  INFORMATION-ORIENTED:                                   │
│  [ HOW-TO GUIDES ]                           │  [ REFERENCE ]                                           │
│                                              │                                                          │
│  • Plan Revision & Freezing                  │  • CLI Capabilities Manifest                             │
│    Updating DAGs, re-baselining & freezing   │    Exhaustive listing of all harness commands            │
│    ➔ [Plan Revision Guide](./olt/03-graph-scheduler/03-plan-revision-and-freezing.md)│ ➔ [CLI Capabilities](../olt/references/cli-capabilities.md)│
│                                              │    ➔ [CLI Manual](../olt/references/cli.md)              │
│  • Crash & Lease Recovery                    │                                                          │
│    Reclaiming expired leases & repairing state│ • Protocol Specification & Schemas                      │
│    ➔ [Host Recovery](../olt/references/host-environment.md)│ Wire format, event types & hash chain validation   │
│    ➔ [Durability & Recovery](./olt/08-durability-recovery/03-stale-worker-and-torn-tail-recovery.md)│ ➔ [Protocol Specification](../olt/references/protocol.md)│
│                                              │    ➔ [Schema Examples](../olt/references/schema-examples.md)│
│  • Multi-Client Setup & Adapters             │                                                          │
│    Configuring Antigravity, Claude, Codex    │  • Agent Manifests & Role Contracts                      │
│    ➔ [Host Configuration](../olt/references/configuration.md)│ Binding authority & role permission matrix       │
│    ➔ [Host Adapters](../olt/references/host-adapters.md)│ ➔ [Agent Manifests](../olt/agents/)                   │
│                                              │    ➔ [Universal Roles](../AGENTS.md)                     │
│  • Visual Debugging & DOM Capture            │                                                          │
│    Dual-channel DOM report & screenshot audit│  • State Model & Lifecycle Enums                         │
│    ➔ [Host Environment](../olt/references/host-environment.md)│ Formal task state machine & transition rules     │
│    ➔ [Structured Finding Schema](./olt/06-validation-repair/02-structured-finding-schema.md)│ ➔ [State Model Specification](../olt/references/state-model.md)│
│                                              │                                                          │
│                                              │  • Parity Matrix & Client Compatibility                  │
│                                              │    Client feature parity and host bindings               │
│                                              │    ➔ [Parity Matrix](../olt/references/parity-matrix.md)│
│                                              │                                                          │
│                                              │  • Failure Modes & Blunder Catalog                       │
│                                              │    Comprehensive encyclopedia of agent error classes     │
│                                              │    ➔ [Failure Modes Catalog](../olt/references/failure-modes.md)│
│                                              │    ➔ [Blunder Dictionary](./olt/10-tutorial-and-cli/03-troubleshooting-and-faq.md)│
└──────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 📚 Categorized Documentation Index

### 1. Monorepo Standards & Governance

- [**Skill Collection Guidelines**](./SKILL_COLLECTION_GUIDELINES.md): The binding authoring, packaging, testing, and quality standards for all skills in `@onurseckin/skills`.
- [**Repository README**](../README.md): Top-level repository overview, packaging instructions, and client installation guides.
- [**Universal Multi-Agent Specification (AGENTS.md)**](../AGENTS.md): Repository-wide multi-agent role definitions, capability grants, and supervisory constraints.

### 2. Canonical Skill Specification (`olt`)

- [**OLT Skill Specification (SKILL.md)**](../olt/SKILL.md): The canonical agent skill entry point containing trigger keywords, operational invariants, and workflow lifecycle.
- [**OLT Agent Descriptors**](../olt/agents/): YAML-based agent personas and assistant configurations (`mind.yaml`, `orchestrator.yaml`, `coordinator.yaml`, `implementer.yaml`, `validator.yaml`, `repairer.yaml`, `completeness-critic.yaml`, and platform-specific descriptors).
- [**Operational Checklists**](../olt/checklists/): Structured quality checklists used during implementation and adversarial reviews.

### 3. Technical Reference Manuals & Protocol Specs

- [**CLI Capabilities Reference**](../olt/references/cli-capabilities.md): Complete reference of all commands, arguments, and execution semantics.
- [**Harness Protocol Specification**](../olt/references/protocol.md): Low-level protocol definition for events, hash chaining, and state synchronization.
- [**State Model & Transitions**](../olt/references/state-model.md): Detailed specifications for task statuses, lease timeouts, and heartbeat intervals.
- [**Host Environment & Tools**](../olt/references/host-environment.md): Host runtime integration, visual validation, and environment isolation.
- [**Host Adapters Reference**](../olt/references/host-adapters.md): Integration adapters for Google Antigravity, Claude Code, OpenAI Codex, and ChatGPT.
- [**Configuration Specification**](../olt/references/configuration.md): Runtime configuration settings, environment variables, and policy files.
- [**Failure Modes & Antipatterns**](../olt/references/failure-modes.md): Comprehensive analysis of common failure modes in long-running agent workflows.
- [**Client Parity Matrix**](../olt/references/parity-matrix.md): Detailed breakdown of feature support across supported host environments.
- [**Data Schema Examples**](../olt/references/schema-examples.md): Canonical JSON schemas for packets, findings, events, and reports.
- [**Topology Exemplar**](../olt/references/topology-exemplar.md): Concrete examples of valid DAG topologies and wave schedules.
- [**Quick CLI Cheatsheet**](../olt/references/cli.md): Fast reference for everyday colon commands.

### 4. 10-Chapter OLT Educational Manual

- [**OLT Educational Manual Master Index**](./olt/README.md): Comprehensive 10-chapter architectural textbook.
  - [Chapter 01: Mental Model & Architectural Foundations](./olt/01-foundations/01-why-long-tasks-fail.md)
  - [Chapter 02: Prompt Compilation & Requirements Engine](./olt/02-requirements/01-prompt-capture-and-integrity.md)
  - [Chapter 03: Graph Scheduler & Concurrency Engine](./olt/03-graph-scheduler/01-dependency-graph-theory.md)
  - [Chapter 04: Multi-Agent Workforce & Role Contracts](./olt/04-multi-agent/01-host-agnostic-architecture.md)
  - [Chapter 05: Task Execution & Lease Lifecycle](./olt/05-task-execution/01-leasing-and-heartbeats.md)
  - [Chapter 06: Validation, Repair & Finding Engine](./olt/06-validation-repair/01-adversarial-validation-philosophy.md)
  - [Chapter 07: Quality Gates & Completion Protocol](./olt/07-gates-and-completion/01-mandatory-gate-systems.md)
  - [Chapter 08: Durability, Storage & Crash Recovery](./olt/08-durability-recovery/01-tamper-proof-hash-chains.md)
  - [Chapter 09: Dynamic Execution Branching & Honesty](./olt/09-branching-and-honesty/01-execution-time-branching.md)
  - [Chapter 10: Hands-on Tutorial & Operational Manual](./olt/10-tutorial-and-cli/01-end-to-end-tutorial.md)

### 5. Architectural Archive

- [**Completed Architectural Plans Archive**](./archive/completed-plans/): Historical catalog of 30+ completed design and implementation plans documenting the continuous evolution of this codebase.

---

## ⚡ Quality Gates & Contributing

All skill documentation and implementations must satisfy strict repository quality gates:

1. **Zero Untyped References**: Exactly `0` TypeScript `any` types permitted across all runtime and test code.
2. **Zero Linter/Compiler Suppressions**: Exactly `0` `@ts-ignore`, `@ts-expect-error`, or `@eslint-disable` annotations allowed.
3. **Deterministic Falsifiability**: Every capability and role invariant is validated via automated unit and integration tests (`bun test`).
4. **Link & Anchor Integrity**: All relative links within documentation files must resolve to valid on-disk targets without broken or circular references.
5. **No Static Planning Files in Git**: Runtime execution plans and capsule logs reside exclusively under `.olt/capsules/<run-id>/`.

To verify repository invariants locally:

```bash
# Execute unit & documentation structure tests
bun test tests/unit/docs/

# Verify full codebase TypeScript strictness
bun run typecheck
```
