# 100% Prompt Line Coverage Invariant

[OLT Documentation Hub](../../README.md) > [Architecture Index](../index.md) > [Chapter 04](./index.md) > 04-02 100% Line Coverage

---

[⏮️ Previous: 04-01 Prompt Ingestion & SHA-256 Binding](04-01-prompt-ingestion-and-sha256-binding.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 04-03 Authority-Gated Obligations](04-03-authority-gated-obligations.md)
---

## 1. The Line Disposition Algorithm

A primary cause of implementation failure is the silent omission of user requirements. OLT mandates that **every single line of the user prompt must be explicitly accounted for**.

Let the prompt $P$ consist of ordered lines $L = [l_1, l_2, \dots, l_m]$. The **Line Disposition Function** $D(l_i)$ maps each line to exactly one disposition category:

$$D(l_i) \in \{\text{Requirement}(R_j), \text{Noise}, \text{Context}, \text{Constraint}\}$$

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                      PROMPT LINE DISPOSITION MATRIX                         │
├──────┬──────────────────────────────────────────┬───────────────────────────┤
│ Line │ Raw Prompt Text Content                  │ Disposition Mapping       │
├──────┼──────────────────────────────────────────┼───────────────────────────┤
│ L01  │ "Add JWT authentication to the API."     │ Requirement: REQ-AUTH-01  │
│ L02  │ "Make sure tokens expire in 15 minutes." │ Constraint: REQ-AUTH-02   │
│ L03  │ "Thanks for doing this!"                 │ Noise: Classified Ignored │
│ L04  │ "We are using Postgres 16 in prod."      │ Context: ENV-DB-POSTGRES  │
└──────┴──────────────────────────────────────────┴───────────────────────────┘
```

---

## 2. Completeness Proof & Blunder Prevention

```mermaid
flowchart TD
    Prompt[Prompt: L1..Lm] --> Parser[Preplanning Parser]
    Parser --> MapReq[Map Lines to Requirements]
    Parser --> MapNoise[Map Lines to Noise / Context]
    MapReq --> SetUnion[Compute Union of Accounted Lines]
    MapNoise --> SetUnion
    SetUnion --> Compare{Union(Lines) == {1..m}?}
    Compare -->|Missing Lines Detected| Reject[EXIT 3: LP-1 PROMPT_LINE_OMISSION]
    Compare -->|100% Exact Match| Approve[Proceed to plan:compile]
```

The preplanning compiler verifies:

$$\bigcup_{k} \text{Lines}(R_k) \cup \text{Lines}(\text{Noise}) \cup \text{Lines}(\text{Context}) = \{1, 2, \dots, m\}$$

If any line index is missing from the union, [`requirements-compiler.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/requirements/enhanced-plan.ts) aborts compilation with error code `LP-1` (`PROMPT_LINE_OMISSION`), listing the exact line numbers that were ignored.

---

[⏮️ Previous: 04-01 Prompt Ingestion & SHA-256 Binding](04-01-prompt-ingestion-and-sha256-binding.md) | [📂 Chapter Index](index.md) | [📚 All Chapters Index](../index.md) | [⏭️ Next: 04-03 Authority-Gated Obligations](04-03-authority-gated-obligations.md)
---
