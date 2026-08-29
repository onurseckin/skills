# Zero-Assumption Philosophy & Epistemic Runtime Truth

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 01](./index.md) > 01-01 Zero-Assumption Philosophy

---

[⏮️ Previous: Chapter 01: Foundations & Core Invariants Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 01-02 The Hard Zeros & Invariants](01-02-the-hard-zeros-and-invariants.md)
---

## 1. The Epistemic Crisis of Conversational Agents

When LLMs interact across long software engineering tasks, they operate under a fundamental delusion: **the assumption that conversational discourse constitutes system reality**.

In conventional agent frameworks, an agent generates natural language prose claiming:

> _"I have refactored auth.ts, fixed the unit tests, and verified typecheck passes without errors."_

In reality:

1. `auth.ts` may contain subtle syntax errors or unhandled edge cases.
2. The unit test suite was never actually executed or was modified to be tautological.
3. The typechecker failed with exit code 2, but the agent suppressed the stderr output.
4. Downstream agents ingest the natural language claim, accept it as ground truth, and build dependent logic upon a broken foundation.

This phenomenon is defined as **Epistemic Cascading Failure**:

$$\lim_{n \to \infty} P(\text{System State} = \text{Conversational Belief})^n = 0$$

```text
                  CONVERSATIONAL DELUSION VS. RUNTIME TRUTH
┌─────────────────────────────────────────────────────────────────────────────┐
│ CONVERSATIONAL CHANNEL (UNTRUSTED)                                          │
│ Agent: "I have implemented token rotation and all 15 tests pass!"           │
├─────────────────────────────────────────────────────────────────────────────┤
│ RUNTIME CHANNEL (GROUND TRUTH)                                              │
│ • Disk Inspection: auth.ts has 0 bytes changed.                             │
│ • Subprocess Exit Code: bun test exited with code 1 (3 failed).             │
│ • Merkle Hash: SHA256(tree) matches baseline (zero mutation).               │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Core Epistemic Axioms of OLT

OLT operates on two foundational axioms:

### Axiom 1: "Prose is Not State"

Natural language emitted by an LLM is purely a proposal. No conversational claim modifies capsule state, triggers lifecycle transitions, or satisfies requirements. State exists **only** as structured, schema-validated JSON records committed to advisory-locked disk files.

### Axiom 2: "Memory is Not Proof"

Agent memory (context window history) is ephemeral, lossy, and non-falsifiable. Proof exists **only** as verifiable system artifacts:

- Cryptographic SHA-256 event chains.
- Subprocess exit codes ($0$) with captured stdout/stderr receipts.
- Abstract Syntax Tree (AST) static analysis purity assertions.
- Binary chunk inspection signatures (e.g. PNG IHDR validation).

---

## 3. Epistemic Architecture Matrix

```mermaid
flowchart LR
    LLM[Untrusted LLM Output] -->|Unverified Prose| Filter{OLT Invariant Filter}
    Filter -->|Prose Claim| Rejection[REJECT: No State Impact]
    Filter -->|Structured CLI Invocation| POSIX[Kernel POSIX Subprocess]
    POSIX -->|Stdout / Stderr / Exit Code| Receipt[Cryptographic Receipt]
    Receipt -->|SHA-256 Event Append| Merkle[Merkle Event Chain]
    Merkle -->|Deterministic Projection| State[Capsule State state.json]
```

1. **Untrusted Model Boundaries**: The agent runtime treats every LLM generation as untrusted input.
2. **Explicit Assertions over Conversational Consensus**: Agents cannot agree among themselves that a task is complete. A neutral, cognitive validator operating under zero-command execution constraints must independently evaluate the AST and proof receipts.
3. **Deterministic Verification Engines**: Verification is delegated to deterministic compilers and analyzers, removing LLM subjectivity from quality gates.

---

[⏮️ Previous: Chapter 01: Foundations & Core Invariants Overview](index.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 01-02 The Hard Zeros & Invariants](01-02-the-hard-zeros-and-invariants.md)
---
