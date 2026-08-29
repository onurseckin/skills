# OLT Documentation Ecosystem Portal

---

[Previous: Repository Root](../../README.md) | [Chapter Index](architecture/index.md) | [All Chapters Index](architecture/index.md) | [Next: Architecture Index](architecture/index.md)

---

## 1. Welcome to the OLT Documentation Ecosystem

The **OLT (Orchestrating Long Tasks)** documentation ecosystem is the authoritative technical reference for the OLT autonomous multi-agent engineering engine.

Built upon the **Diátaxis Documentation Framework** and the **Open Agent Skills Standard (`agentskills.io`)**, the OLT documentation ecosystem partitions technical knowledge across two primary hubs:

1. **The Architecture Book (`docs/olt/architecture/`)**: 17 deep chapters exploring theoretical foundations, mathematical proofs, scheduling algorithms, and internal engine mechanics.
2. **The Reference Hub (`docs/olt/reference/`)**: Concise, copy-pasteable operator guides, quickstarts, diagnostic playbooks, and CLI dictionaries.

```text
+--------------------------------------------------------------------------------------------------+
│                                 THE OLT DOCUMENTATION ECOSYSTEM                                  │
+--------------------------------------------------+-----------------------------------------------+
│    ARCHITECTURE BOOK (Chapters 01-17)            │    REFERENCE MANUALS (Operator Guides)        │
│    Deep theoretical foundations, algorithms,     │    Concise, copy-pasteable operator guides    │
│    mathematical models, and visual topologies.   │    for running workflows & system checks.     │
+--------------------------------------------------+-----------------------------------------------+
│  * 01. Foundations & Core Invariants             │  * quickstart.md (Single-Task & Mind Mode)    │
│  * 02. Four-Tier Workforce Hierarchy             │  * health-and-status.md (Doctor & Diagnostics)│
│  * 03. Mind Product Owner & Infinite Cadence     │  * index.md (Reference Navigation Portal)     │
│  * 04. Continuous Preplanning Factory            │                                               │
│  * 05. Concurrency Scaling & Straggler SLA       │                                               │
│  * 06. Topological DAG Scheduler                 │                                               │
│  * 07. Distributed Task Leasing & Execution      │                                               │
│  * 08. Adversarial Validation & Monotonic Repair │                                               │
│  * 09. Falsifiable Evidence & Completion Gates   │                                               │
│  * 10. Durability, Recovery & Merkle Chains      │                                               │
│  * 11. Worktree Branching & Honesty Gates        │                                               │
│  * 12. Flock Mailboxes & Live TUI Telemetry      │                                               │
│  * 13. Policy, RBAC & Fail-Closed Engine         │                                               │
│  * 14. Harness CLI & Command Engine              │                                               │
│  * 15. State Schemas & Event Ledger              │                                               │
│  * 16. Error Catalog & Empirical Blunders        │                                               │
│  * 17. Verification Engines & Gate Provers       │                                               │
+--------------------------------------------------+-----------------------------------------------+
```

---

## 2. Key Documentation Standards & Invariants

All documents authored across `docs/olt/` adhere strictly to the authoring rules codified in [GUIDELINES.md](GUIDELINES.md):

- **Sizing Envelope**: Target line count between 250 and 800 lines (zero shallow stubs $< 100$ lines, zero monolith dumps $> 1{,}200$ lines).
- **Clean 4-Way Navigation**: Exactly ONE clean navigation bar at the top and bottom of each document with ZERO emojis.
- **Conceptual Depth**: In-depth architectural prose, LaTeX mathematical formulations, and box-drawing ASCII diagrams over raw code dumps.
- **Link Integrity**: 100% of relative markdown links point to existing on-disk files.

---

## 3. Quick Navigation Links

- [Authoring Standards & Charter (GUIDELINES.md)](GUIDELINES.md)
- [Architecture Book Master Index (architecture/index.md)](architecture/index.md)
- [Reference Hub Master Index (reference/index.md)](reference/index.md)
- [Quickstart & Onboarding Guide (reference/quickstart.md)](reference/quickstart.md)
- [Health & Diagnostics Reference (reference/health-and-status.md)](reference/health-and-status.md)

---

[Previous: Repository Root](../../README.md) | [Chapter Index](architecture/index.md) | [All Chapters Index](architecture/index.md) | [Next: Architecture Index](architecture/index.md)

---
