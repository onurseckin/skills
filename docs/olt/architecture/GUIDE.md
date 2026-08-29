# OLT Architecture Book Authoring & Engineering Charter

---

[Previous: Architecture Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](index.md) | [Next: Chapter 01 Foundations](01-foundations/index.md)

---

## 1. Executive Charter & Architecture Pedagogy

The **OLT Architecture Book (`docs/olt/architecture/`)** constitutes the theoretical, algorithmic, and mathematical bedrock of the OLT (Orchestrating Long Tasks) documentation ecosystem.

In accordance with Daniele Procida's **Diátaxis Documentation Framework** and the **Open Agent Skills Standard (`agentskills.io`)**, the Architecture Book is strictly **Understanding-Oriented (Explanation)**. It does not provide basic step-by-step how-to recipes (which belong in `docs/olt/reference/`), but instead deconstructs the foundational invariants, state machine proofs, concurrency mathematics, graph scheduling algorithms, and cryptographic durability protocols that make autonomous multi-agent engineering mathematically predictable and fail-closed.

```text
+--------------------------------------------------------------------------------------------------+
│                             ARCHITECTURE BOOK PEDAGOGY MATRIX                                    │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   CORE OBJECTIVE: Explain WHY the system is engineered this way and PROVE its invariants.         │
│                                                                                                  │
│   MANDATORY ELEMENTS ACROSS EVERY CHAPTER TOPIC (250-800 Lines Envelope):                         │
│   1. Executive Summary & Epistemic Motivation                                                    │
│   2. High-Density Box-Drawing ASCII System / Topology Diagram                                    │
│   3. Formal Mathematical Specification (LaTeX Formulations, Recurrences, Bounds)                 │
│   4. Algorithmic Flowcharts & State Transitions (Mermaid Charts)                                 │
│   5. Concrete TypeScript Engine Interface Contracts & Schemas                                    │
│   6. Empirical Failure Modes, Cognitive Blunders & Mechanical Mitigations Table                  │
│   7. Non-Negotiable Architectural Invariants & Verification Receipts                             │
│   8. Universal Clean 4-Way Navigation Mesh (Zero Emojis)                                         │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Document Sizing Envelope & Information Density

```text
+-------------------+-------------------+----------------------------------------------------------+
| Classification    | Line Range        | Policy & Architectural Enforcement                       |
+-------------------+-------------------+----------------------------------------------------------+
| Shallow Stub      | < 100 lines       | STRICTLY FORBIDDEN. Merge into cohesive thematic topics. |
| Target Envelope   | 250 - 800 lines   | OPTIMAL SIZING. Deep theoretical prose & rich diagrams.  |
| Upper Catalog     | 800 - 1,200 lines | ACCEPTABLE for exhaustive CLI / schema dictionaries.     |
| Monolith Dump     | > 1,200 lines     | STRICTLY FORBIDDEN. Decompose into modular subtopics.    |
+-------------------+-------------------+----------------------------------------------------------+
```

---

## 3. Strict Style & Formatting Invariants

1. **Zero Emojis**: Emojis are strictly banned from navigation bars, section headers, tables, and prose across all architecture chapters.
2. **Clean 4-Way Navigation Mesh**: Exactly ONE clean navigation bar at the top (under H1) and ONE at the bottom.
3. **Symbolic Code Links**: All file and symbol references must provide clickable markdown links (e.g. [`topological-scheduler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/graph/topological-scheduler.ts)).
4. **Reflog Durability**: Execute `git add -A` upon completing every chapter milestone.

---

[Previous: Architecture Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](index.md) | [Next: Chapter 01 Foundations](01-foundations/index.md)

---
