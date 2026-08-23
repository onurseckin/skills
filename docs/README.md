# Repository Documentation Index

Welcome to the central documentation hub for the **`@onurseckin/skills`** multi-skill repository.

---

## 🏛️ Repository Architecture & Documentation Scope

This documentation tree is strictly structured according to the **Diátaxis Documentation Framework** (Tutorials, How-to Guides, Reference, Explanation) and monorepo governance invariants:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       REPOSITORY DOCUMENTATION TREE                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  docs/                                                                      │
│  ├── README.md                          --> Monorepo Master Index           │
│  ├── SKILL_COLLECTION_GUIDELINES.md     --> Monorepo Authoring & Governance │
│  └── olt/                               --> OLT Skill Architectural Manual  │
│      ├── README.md                      --> OLT Master Diátaxis Index       │
│      ├── 01-foundations/                --> Storage & Capsule Architecture  │
│      ├── 02-requirements/               --> 100% Line Disposition Engine    │
│      ├── 03-graph-scheduler/            --> DAG Theory & Concurrency Scaling│
│      ├── 04-multi-agent/                --> Two-Tier Workforce Hierarchy    │
│      ├── 05-task-execution/             --> Leases, Scopes & Heartbeats     │
│      ├── 06-validation-repair/          --> Adversarial Probes & Findings   │
│      ├── 07-gates-and-completion/       --> Critic Certification Protocol   │
│      ├── 08-durability-recovery/        --> Hash Chains & POSIX Locking     │
│      ├── 09-branching-and-honesty/      --> Runtime Branching & Honesty     │
│      └── 10-tutorial-and-cli/           --> Hands-on Tutorial & CLI Manual  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 Core Documentation Suites

### 1. Monorepo Standards & Governance

- [**Skill Collection Guidelines**](./SKILL_COLLECTION_GUIDELINES.md): Standardized policies for authoring, packaging, testing, and governing AI agent skills across this repository. This root documentation is strictly reserved for repository-wide multi-skill collection guidelines.

### 2. Orchestrating Long Tasks (`olt`) Architectural Manual

- [**OLT Master Architectural Manual & Diátaxis Index**](./olt/README.md): The definitive guide to deterministic multi-agent orchestration, containing 10 chapters and 30 deep-dive architectural documents.

---

## 📚 Diátaxis Quick Navigation

```text
┌──────────────────────────────┬──────────────────────────────┐
│          TUTORIALS           │        HOW-TO GUIDES         │
│                              │                              │
│ • End-to-End Walkthrough     │ • Plan Revision & Replanning │
│   (docs/olt/10-tutorial-and- │   (docs/olt/03-graph-        │
│    cli/01-end-to-end-        │    scheduler/03-plan-        │
│    tutorial.md)              │    revision-and-freezing.md) │
│                              │ • Crash & Lease Recovery     │
│                              │   (docs/olt/10-tutorial-and- │
│                              │    cli/03-troubleshooting-   │
│                              │    and-faq.md)               │
├──────────────────────────────┼──────────────────────────────┤
│          REFERENCE           │         EXPLANATION          │
│                              │                              │
│ • CLI Command Reference      │ • Why Long Tasks Fail        │
│   (docs/olt/10-tutorial-and- │   (docs/olt/01-foundations/  │
│    cli/02-cli-command-       │    01-why-long-tasks-fail.md)│
│    reference.md)             │ • Brent Work/Span Scaling    │
│ • Graph Node & Edge Schema   │   (docs/olt/03-graph-        │
│   (docs/olt/03-graph-        │    scheduler/02-topological- │
│    scheduler/01-dependency-  │    conflict-free-batching.md)│
│    graph-theory.md)          │ • Adversarial Validation     │
│ • Blunder Dictionary         │   (docs/olt/06-validation-   │
│   (docs/olt/10-tutorial-and- │    repair/01-adversarial-    │
│    cli/03-troubleshooting-   │    validation-philosophy.md) │
│    and-faq.md)               │                              │
└──────────────────────────────┴──────────────────────────────┘
```

---

[Proceed to the OLT Master Documentation ➔](./olt/README.md)
