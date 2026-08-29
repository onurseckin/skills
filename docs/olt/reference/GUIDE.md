# OLT Reference Hub Authoring & Operator Guide

---

[Previous: Reference Hub Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](../architecture/index.md) | [Next: Quickstart](quickstart.md)

---

## 1. Executive Charter & Reference Pedagogy

The **OLT Reference Hub (`docs/olt/reference/`)** provides copy-pasteable operator manuals, diagnostic recipes, and onboarding walkthroughs for human engineers and autonomous watchdogs in the OLT (Orchestrating Long Tasks) ecosystem.

In accordance with Daniele Procida's **Diátaxis Documentation Framework**, the Reference Hub encompasses:

1. **Tutorials (Learning-Oriented)**: Step-by-step onboarding walkthroughs (e.g. `quickstart.md`).
2. **How-To Guides (Problem-Oriented)**: Concrete diagnostic and auto-healing recipes (e.g. `health-and-status.md`).
3. **Information Catalogs (Reference-Oriented)**: Fast command dictionaries and error code lookups.

```text
+--------------------------------------------------------------------------------------------------+
│                                 REFERENCE HUB PEDAGOGY MATRIX                                    │
+--------------------------------------------------------------------------------------------------+
│                                                                                                  │
│   CORE OBJECTIVE: Enable immediate, unambiguous operator action and automated CLI execution.     │
│                                                                                                  │
│   MANDATORY ELEMENTS ACROSS EVERY REFERENCE GUIDE (150-500 Lines Envelope):                      │
│   1. Purpose & Preconditions (Exact runtime prerequisites & exit code expectations)             │
│   2. High-Density Workflow Diagrams (ASCII & Mermaid Pipelines)                                  │
│   3. Copy-Pasteable Shell Command Examples (Flags, arguments, stdin payloads)                    │
│   4. Expected JSON Output Envelopes & Error Code Mappings                                        │
│   5. Universal Clean 4-Way Navigation Mesh (Zero Emojis)                                         │
│                                                                                                  │
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Essential Operator Reference Catalog

```text
+------------------------------------+----------------+--------------------------------------------+
| Reference Guide                    | Diátaxis Type  | Primary Operational Focus                  |
+------------------------------------+----------------+--------------------------------------------+
| quickstart.md                      | Tutorial       | First-time onboarding & single-task run    |
+------------------------------------+----------------+--------------------------------------------+
| health-and-status.md               | How-To Guide   | 10-domain diagnostic sweep & doctor:heal   |
+------------------------------------+----------------+--------------------------------------------+
| index.md                           | Navigation     | Master reference directory and quick links |
+------------------------------------+----------------+--------------------------------------------+
```

---

## 3. Strict Reference Standards

1. **Deterministic Command Receipts**: All command examples must demonstrate actual output shapes with exit code 0 or explicit error codes.
2. **Zero Emojis**: Emojis are strictly banned from navigation bars, section headers, tables, and prose.
3. **Link Integrity**: 100% of relative links must resolve to existing on-disk targets.

---

[Previous: Reference Hub Index](index.md) | [Chapter Index](index.md) | [All Chapters Index](../architecture/index.md) | [Next: Quickstart](quickstart.md)

---
