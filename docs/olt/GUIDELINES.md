# OLT Documentation Engineering Charter & Authoring Standards

---

[⏮️ Previous: Master Documentation Hub](README.md) | [📂 Architecture Portal](architecture/index.md) | [📚 Reference Hub](reference/index.md) | [⏭️ Next: Quickstart](reference/quickstart.md)
---

Welcome to the **authoritative documentation engineering charter** for the **OLT (Orchestrating Long Tasks)** documentation ecosystem.

This charter synthesizes the **Open Agent Skills Standard (`agentskills.io`)**, the **Diátaxis Documentation Framework**, and **Stripe-Grade Developer Experience Principles** into a binding standard for all documentation authored across `docs/olt/`.

---

## 🏛️ 1. Theoretical Pedagogy & Standards Alignment

The OLT documentation ecosystem is grounded in two industry-standard technical frameworks:

### A. The Diátaxis Documentation Framework

Created by Daniele Procida, Diátaxis partitions documentation across two fundamental cognitive axes: **Learning vs. Applying** and **Practical Action vs. Theoretical Cognition**.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            THE DIÁTAXIS DOCUMENTATION MATRIX IN OLT                              │
├──────────────────────────────────────────────┬───────────────────────────────────────────────────┤
│               PRACTICAL ACTION               │               THEORETICAL COGNITION               │
├──────────────────────────────────────────────┼───────────────────────────────────────────────────┤
│  LEARNING-ORIENTED:                          │  UNDERSTANDING-ORIENTED (EXPLANATION):            │
│  [ TUTORIALS & GETTING STARTED ]             │  [ ARCHITECTURE BOOK (Chapters 01–17) ]           │
│  • Quickstart single-task walk-through       │  • Brent Work/Span Concurrency Math               │
│  • First Mind autonomous pulse run           │  • Tarjan SCC Cycle Breaking Proofs               │
│  • Step-by-step onboarding recipes           │  • SHA-256 Merkle Chaining & POSIX flock Locking  │
│                                              │  • APCA Perceptual Contrast & PNG Entropy Theory  │
│  👉 Location: docs/olt/reference/quickstart  │  👉 Location: docs/olt/architecture/              │
├──────────────────────────────────────────────┼───────────────────────────────────────────────────┤
│  PROBLEM-ORIENTED:                           │  INFORMATION-ORIENTED:                            │
│  [ HOW-TO GUIDES & OPERATOR PLAYBOOKS ]      │  [ HARNESS REFERENCE & CATALOGS ]                 │
│  • Health diagnostics & preflight checks     │  • Complete 15-Domain Harness CLI Dictionary      │
│  • Crash recovery & torn-tail auto-healing   │  • Draft 2020-12 State & Capsule JSON Schemas     │
│  • Socratic review pushbacks & repair waves  │  • 12 HarnessError Codes & 28 Empirical Blunders  │
│                                              │                                                   │
│  👉 Location: docs/olt/reference/health-*    │  👉 Location: docs/olt/architecture/14-..17-      │
└──────────────────────────────────────────────┴───────────────────────────────────────────────────┘
```

### B. The Open Agent Skills Standard (`agentskills.io`) & Progressive Disclosure

OLT adheres strictly to the modular Agent Skills specification:

1. **Discovery (Metadata)**: At startup, agents inspect top-level `SKILL.md` frontmatter without paying the token cost of the full documentation repository.
2. **Activation (Procedural Instructions)**: When invoking the skill, agents read task-specific procedural rules into context.
3. **Progressive Execution (On-Demand References)**: Agents query deep architecture chapters (`docs/olt/architecture/`) and reference guides (`docs/olt/reference/`) on-demand. When executing CLI commands, only the stdout brief enters the LLM context—the underlying TypeScript source does not, preserving context budget ($<150{,}000$ Cowan tokens).

---

## ⚖️ 2. Information Weight & Document Sizing Invariants

To eliminate both superficial stubs and overwhelming monoliths:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             DOCUMENTATION SIZING ENVELOPE BOUNDS                                 │
├───────────────────┬───────────────────┬──────────────────────────────────────────────────────────┤
│ Classification    │ Line Range        │ Policy & Enforcement Rule                                │
├───────────────────┼───────────────────┼──────────────────────────────────────────────────────────┤
│ ❌ Shallow Stub    │ < 100 lines       │ STRICTLY FORBIDDEN. Merge into cohesive thematic topics. │
│ ✅ Optimal Range  │ 250 – 800 lines   │ TARGET ENVELOPE. Deep technical prose + rich diagrams.   │
│ ⚠️ Upper Bound    │ 800 – 1,200 lines │ ACCEPTABLE for exhaustive CLI / schema catalogs.         │
│ ❌ Monolith Dump  │ > 1,200 lines     │ STRICTLY FORBIDDEN. Decompose into modular subtopics.    │
└───────────────────┴───────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 🚫 3. Conceptual Depth vs. Raw Code Dumps

Documentation must explain architecture, mechanics, and invariants—not dump raw code.

- **STRICTLY PROHIBITED**:
  - Unannotated raw TypeScript file dumps.
  - Large blocks of copy-pasted application source code.
  - Vague conversational summaries ("This file handles planning").
- **MANDATORY**:
  - Conceptual pseudo-code illustrating algorithms (e.g. Kahn's sorting, Tarjan SCC cycle breaking, Sugiyama coordinate assignment).
  - Clean TypeScript interface and type contracts accompanied by extensive commentary.
  - Formal LaTeX mathematical formulations ($P = \lceil W/S \rceil$, $H(X) = -\sum P(x_i) \log_2 P(x_i)$, $L_c$).
  - Clickable code symbol links (e.g. [`topological-scheduler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/topological-scheduler.ts)) for direct source inspection.

---

## 🎨 4. Visual Architecture & Diagram Standards

Every document across `docs/olt/architecture/` and `docs/olt/reference/` **MUST** contain at least one visual diagram:

1. **High-Density ASCII Topologies**: Illustrate subsystem boundaries, memory layouts, or network pipelines.
2. **Mermaid State Machines & Flowcharts**: Visualize state transitions, lease acquisition lifecycles, and verification pipelines.
3. **Binary Layout Charts**: Depict byte offsets and headers (e.g. PNG 32-byte IHDR headers, Merkle event chaining).

### Exemplar Visual Model:

```text
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                           PROGRESSIVE DISCLOSURE CONTEXT PIPELINE                       │
├─────────────────────────────────────────────────────────────────────────────────────────┤
│  [Discovery: SKILL.md Frontmatter] ──► Minimal Startup Footprint (< 500 tokens)         │
│                 │                                                                       │
│                 ▼                                                                       │
│  [Activation: Procedural Instructions] ──► Loaded on User Trigger (< 4,000 tokens)      │
│                 │                                                                       │
│                 ▼                                                                       │
│  [Execution: On-Demand Architecture/Ref] ──► Queried Progressively (< 150,000 tokens)   │
└─────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🧭 5. Interactive 4-Way Navigation Mesh

Every markdown document must contain an interactive 4-way navigation bar at both the **Top (Header)** and **Bottom (Footer)**:

```markdown
---
[⏮️ Previous: <Prev Title>](#) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](index.md) | [⏭️ Next: <Next Title>](#)
---
```

### Specifications:

- **`[⏮️ Previous]`**: Points to previous sequential document in the book (crossing chapter boundaries seamlessly).
- **`[📂 Chapter Index]`**: Direct relative link to the current chapter's `index.md`.
- **`[📚 All Chapters Index]`**: Direct relative link to the master domain index (`../index.md`).
- **`[⏭️ Next]`**: Points to next sequential document in the book.
- **Link Integrity**: 100% of relative links must resolve to existing on-disk targets (verified by `bun test tests/unit/docs/`).

---

## 🌐 6. Two-Domain Documentation Topology

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 OLT DOCUMENTATION ECOSYSTEM                                      │
├──────────────────────────────────────────────────┬───────────────────────────────────────────────┤
│    🏛️ ARCHITECTURE (Chapters 01–17, 83 Docs)     │    📚 REFERENCE MANUALS (2 Consumer Guides)   │
│    Deep theoretical foundations, algorithms,     │    Concise, copy-pasteable operator guides    │
│    mathematical models, and visual topologies.   │    for running workflows & system checks.     │
├──────────────────────────────────────────────────┼───────────────────────────────────────────────┤
│  • 01. Foundations & Core Invariants             │  • quickstart.md (Single-Task & Mind Mode)    │
│  • 02. Four-Tier Workforce Hierarchy             │  • health-and-status.md (Doctor & Diagnostics)│
│  • 03. Mind Product Owner & Infinite Cadence     │  • index.md (Reference Navigation Portal)     │
│  • 04. Continuous Preplanning Factory            │                                               │
│  • 05. Concurrency Scaling & Straggler SLA       │                                               │
│  • 06. Topological DAG Scheduler                 │                                               │
│  • 07. Distributed Task Leasing & Execution      │                                               │
│  • 08. Adversarial Validation & Monotonic Repair │                                               │
│  • 09. Falsifiable Evidence & Completion Gates   │                                               │
│  • 10. Durability, Recovery & Merkle Chains      │                                               │
│  • 11. Worktree Branching & Honesty Gates        │                                               │
│  • 12. Flock Mailboxes & Telemetry               │                                               │
│  • 13. Policy, RBAC & Fail-Closed Engine         │                                               │
│  • 14. Harness CLI & Command Engine              │                                               │
│  • 15. State Schemas & Event Ledger              │                                               │
│  • 16. Error Catalog & Empirical Blunders        │                                               │
│  • 17. Verification Engines & Gate Provers       │                                               │
└──────────────────────────────────────────────────┴───────────────────────────────────────────────┘
```

---

## 🔍 7. Multi-Round Cognitive Review & Reflog Safety

1. **Adversarial Validation**: Every document must be audited against the 4 Hard Zeros ($Z_{\text{hallucination}}=0$, $Z_{\text{mutation}}=0$, $Z_{\text{scope}}=0$, $Z_{\text{assumption}}=0$).
2. **Socratic Reflexive Probing**: Reviewers must verify that all architectural claims are supported by formal mechanics or empirical evidence.
3. **Up to 5 Review Rounds**: Writers address reviewer pushbacks through monotonic repair cycles ($k \le 5$).
4. **Reflog Safety Staging**: Immediately execute `git add -A` upon completing every documentation milestone.

---

[⏮️ Previous: Master Documentation Hub](README.md) | [📂 Architecture Portal](architecture/index.md) | [📚 Reference Hub](reference/index.md) | [⏭️ Next: Quickstart](reference/quickstart.md)
---
