# Skill Collection Authoring and Governance Guidelines

[Previous: Repository Root](README.md) | [Skill Manifest](../olt/SKILL.md) | [Canonical Guidelines SSoT](../olt/docs/guidelines.md) | [Next: OLT Book Hub](book/README.md)

---

## 1. Executive Overview and Canonical Source of Truth

> [!IMPORTANT]
> The single canonical Source of Truth (SSoT) for authoring, packaging, orchestrating, testing, and governing AI agent skills across the `@onurseckin/skills` monorepo is located at:
>
> 👉 **[`olt/docs/guidelines.md`](../olt/docs/guidelines.md)**

This document provides a high-level executive summary and architectural orientation for human engineers and autonomous agents interacting with the skill collection.

```
+--------------------------------------------------------------------------------------------------+
|                            SKILL COLLECTION GOVERNANCE HIERARCHY                                 |
+--------------------------------------------------------------------------------------------------+
|                                                                                                  |
|   +------------------------------------------------------------------------------------------+   |
|   | CANONICAL SSOT: olt/docs/guidelines.md                                                   |   |
|   | Full architectural specification, invariant definitions, mathematical formulations       |   |
|   +--------------------------------------------+---------------------------------------------+   |
|                                                |                                                 |
|                   +----------------------------+----------------------------+                    |
|                   v                                                         v                    |
|   +--------------------------------+                       +---------------------------------+   |
|   | docs/SKILL_COLLECTION_GUIDELINES.md |                  | docs/olt/GUIDELINES.md          |   |
|   | Executive Collection Overview  |                       | OLT Subsystem Charter           |   |
|   +--------------------------------+                       +---------------------------------+   |
|                                                                                                  |
+--------------------------------------------------------------------------------------------------+
```

---

## 2. Core Repository Architectural Pillars

The `@onurseckin/skills` repository enforces five core engineering pillars:

### 2.1 Open Agent Skills Standard (`agentskills.io`)

Skills implement a three-tier progressive disclosure model:

- **Discovery (< 500 tokens):** Parsing YAML frontmatter in `SKILL.md`.
- **Activation (< 4,000 tokens):** Loading core instructions upon task triggering.
- **Execution (< 150,000 tokens):** On-demand reference querying and concise CLI receipts.

### 2.2 Diataxis Documentation Framework

Documentation is strictly organized into four cognitive quadrants:

- **Tutorials (Learning-Oriented):** Guided walk-throughs (`docs/book/01-quickstart-and-getting-started.md`).
- **Explanations (Understanding-Oriented):** Core philosophy and mathematics (`docs/book/02-core-philosophy-and-brent-parallelism.md`).
- **How-To Guides (Problem-Oriented):** Operational recovery playbooks (`docs/book/08-verification-and-socratic-gating.md`).
- **Reference (Information-Oriented):** CLI dictionaries and schema catalogs (`docs/book/09-full-cli-command-reference.md`).

### 2.3 Four-Tier Multi-Agent Hierarchy

- **Tier 0 (Autonomous Mind):** Background Product Owner loop (`observe` -> `triage` -> `admit`), zero file mutations.
- **Tier 1 (Interactive Orchestrator):** Initiative root supervisor, Merkle capsule genesis, zero direct file edits.
- **Tier 2 (Run Coordinator):** Kahn DAG topological scheduling, Brent Concurrency allocation ($P = \lceil W/S \rceil$), lease arbitration.
- **Tier 3 (Workforce):** Leased implementers bound to strict write scopes, paired with independent adversarial validators under the Two-Key Principle.

### 2.4 Strict Quality Invariants (Hard Zeros)

- **Exact 0 TypeScript `any`:** 100% strict type safety across all production and test files.
- **Zero Compiler / Linter Suppressions:** No `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`.
- **Context File Limits:** Production source $\le 200$ physical lines, test suites $\le 250$ physical lines.
- **Zero Runtime Dependencies:** Harness and skills run purely on native `bun` and standard `node:` built-in modules.
- **Zero Cross-Skill Leakage:** Modular, self-contained skills with zero circular or cross-skill runtime imports.
- **Ephemeral Capsule Isolation:** All active execution state confined to `.olt/capsules/<run-id>/`.

### 2.5 Universal Multi-Client Discovery

Every skill provides declarative descriptors under `<skill>/agents/` supporting:

- Google Antigravity (`agents/antigravity.yaml`)
- Claude Code (`agents/claude.yaml`)
- OpenAI Codex (`agents/codex.yaml`)
- Cursor (`agents/cursor.yaml`)
- Universal Subprocess Fallback (`agents/generic.yaml`)

---

## 3. Canonical Skill Directory Structure

```
<skill-name>/
├── SKILL.md                  # Canonical skill entry point with YAML frontmatter
├── AGENTS.md                 # Agent persona catalog and multi-client dispatch matrix
├── .skillignore              # Packaging exclusions (test artifacts, scratch files)
├── agents/                   # Unified agent manifests and platform descriptors (*.yaml)
│   ├── antigravity.yaml      # Google Antigravity platform descriptor
│   ├── claude.yaml           # Claude Code platform descriptor
│   ├── codex.yaml            # OpenAI Codex platform descriptor
│   ├── cursor.yaml           # Cursor platform descriptor
│   ├── generic.yaml          # Universal subprocess fallback descriptor
│   ├── orchestrator.yaml     # Tier 1 supervisor manifest
│   ├── coordinator.yaml      # Tier 2 coordinator manifest
│   ├── validator.yaml        # Tier 3 verification auditor manifest
│   └── implementer.yaml      # Tier 3 execution agent manifest
├── checklists/               # Operational domain checklists (*.md)
├── references/               # Deep technical reference manuals & protocol specifications (*.md)
├── roles/                    # Multi-agent role contracts (*.md)
├── docs/                     # Canonical documentation
│   └── guidelines.md         # Canonical SSoT Guidelines Document
└── scripts/                  # Executable harness tooling (zero external dependencies)
```

---

## 4. Pre-Commit Verification Pipeline

All contributions must pass the continuous verification pipeline:

```bash
# 1. Run unit test suite
bun test tests/unit

# 2. Run TypeScript strict typecheck
bun run typecheck

# 3. Run linter
bun run lint

# 4. Check formatting
bun run format:check

# 5. Synchronize multi-client platform configurations
bun scripts/sync/index.ts
```

For the comprehensive, unabridged specification, consult the canonical document at [`olt/docs/guidelines.md`](../olt/docs/guidelines.md).

---

[Previous: Repository Root](README.md) | [Skill Manifest](../olt/SKILL.md) | [Canonical Guidelines SSoT](../olt/docs/guidelines.md) | [Next: OLT Book Hub](book/README.md)
