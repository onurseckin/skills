# Skill Collection Authoring & Governance Guidelines

[![TypeScript 100% Strict](https://img.shields.io/badge/TypeScript-100%25%20Strict-blue.svg)](https://www.typescriptlang.org/)
[![Zero Suppressions](https://img.shields.io/badge/Suppressions-0%20Allowed-brightgreen.svg)](#62-zero-compiler--linter-suppressions)
[![Documentation Diátaxis](https://img.shields.io/badge/Docs-Diátaxis%20Standard-orange.svg)](#2-diátaxis-documentation-architecture-standard)
[![Runtime Bun / Node](https://img.shields.io/badge/Runtime-Bun%20%7C%20Node%20Native-purple.svg)](#54-zero-runtime-dependencies-invariant)
[![License MIT](https://img.shields.io/badge/License-MIT-green.svg)](../LICENSE)

This document establishes the repository-wide canonical standard for creating, packaging, testing, and governing AI agent skills within the **`@onurseckin/skills`** monorepo. It defines mandatory architectural structures, Diátaxis documentation conventions, agent persona manifest schemas, multi-client distribution patterns, and automated quality gates.

---

## 1. Core Purpose & Repository Scope

The **`@onurseckin/skills`** monorepo serves as a centralized, high-assurance collection of autonomous agent capabilities, workflow patterns, and orchestration engines. Every skill published in this collection must:

1. **Be Self-Contained:** Operate independently without hardcoded cross-skill runtime dependencies.
2. **Be Client-Agnostic:** Support universal discovery across all major AI assistant platforms (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT Coding Agents, Cursor).
3. **Be Formally Verified:** Enforce strict type safety, zero linter suppressions, context-bounded file sizes, and 100% falsifiable automated tests.
4. **Adhere to Clear Documentation Hierarchies:** Follow the Diátaxis documentation framework to ensure immediate clarity for both human contributors and autonomous AI agents.

---

## 2. Diátaxis Documentation Architecture Standard

All documentation in this repository is strictly organized according to the **Diátaxis Documentation Framework**, systematically dividing information into four distinct quadrants based on user need and cognitive orientation:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                       DIÁTAXIS DOCUMENTATION QUADRANTS                      │
├──────────────────────────────────────┬──────────────────────────────────────┤
│               PRACTICAL              │             THEORETICAL              │
├──────────────────────────────────────┼──────────────────────────────────────┤
│  TUTORIALS (Learning-Oriented)       │  EXPLANATION (Understanding-Oriented)│
│  • Step-by-step onboarding journeys  │  • Architectural rationale & theory  │
│  • Executable end-to-end flows       │  • Trade-offs and design philosophy  │
│  • Beginner and new-agent primers    │  • Failure modes & recovery concepts │
├──────────────────────────────────────┼──────────────────────────────────────┤
│  HOW-TO GUIDES (Problem-Oriented)    │  REFERENCE (Information-Oriented)    │
│  • Targeted operational recipes      │  • CLI commands, flags, and schemas  │
│  • Troubleshooting & repair steps    │  • Role contracts & manifest specs   │
│  • Branching & state recovery guides │  • Formal invariants & error catalogs│
└──────────────────────────────────────┴──────────────────────────────────────┘
```

### 2.1 Repository Root vs. Skill Documentation Separation

To prevent context pollution and maintain clean boundaries, documentation is separated into two strict tiers:

- **Repository Root (`docs/`):** Strictly reserved for collection-wide guidelines, repository architecture indices, and human educational suites (e.g., `docs/README.md`, `docs/SKILL_COLLECTION_GUIDELINES.md`, `docs/olt/`).
- **Skill-Internal Documentation (`<skill-name>/`):** Every individual skill contains its own dedicated documentation artifacts:
  - `SKILL.md` — Canonical entry point and trigger index.
  - `references/*.md` — Deep technical reference manuals, protocol specifications, and host adapters.
  - `checklists/*.md` — Operational quality and domain checklists.
  - `roles/*.md` — Multi-agent role contracts and operational boundaries.

> [!IMPORTANT]
> A skill must never place skill-specific operational docs directly into root `docs/` unless authorized as part of a formal educational module suite under `docs/<skill-name>/`. Skill directories must never contain an internal `docs/` folder (e.g., `<skill-name>/docs/` is forbidden; use `<skill-name>/references/` instead).

### 2.2 Relative Link Integrity Standard

All internal markdown documentation links must adhere to strict relative link integrity:

- Use relative paths within the skill boundary (e.g., `<skill>/references/protocol.md` or `<skill>/agents/orchestrator.yaml`).
- Never use absolute filesystem paths (e.g., `/Users/...` or `C:\...`).
- Verify that every markdown link resolves to a valid, existing file during continuous integration testing.

---

## 3. Canonical Skill Directory Anatomy

Every skill in the monorepo lives in its own top-level directory and must adhere to the canonical structure below:

```text
<skill-name>/
├── SKILL.md                  # Canonical skill entry point with YAML frontmatter
├── AGENTS.md                 # Agent persona catalog & multi-client dispatch matrix
├── .skillignore              # Packaging exclusions (test artifacts, scratch files)
├── agents/                   # Unified agent manifests & platform descriptors (*.yaml)
│   ├── antigravity.yaml      # Platform dispatch descriptor for Google Antigravity
│   ├── claude.yaml           # Platform dispatch descriptor for Claude Code
│   ├── codex.yaml            # Platform dispatch descriptor for OpenAI Codex
│   ├── cursor.yaml           # Platform dispatch descriptor for Cursor
│   ├── generic.yaml          # Universal subprocess fallback descriptor
│   ├── orchestrator.yaml     # Tier 0 supervisor manifest
│   ├── validator.yaml        # Tier 2 verification auditor manifest
│   └── implementer.yaml      # Tier 3 execution agent manifest
├── checklists/               # Operational domain checklists (*.md)
│   ├── code-quality.md       # Pre-commit & code quality checklist
│   ├── security.md           # Security & secret leakage checklist
│   └── release.md            # Skill release & versioning checklist
├── references/               # Deep reference manuals & protocol specifications (*.md)
│   ├── protocol.md           # Core IPC/state protocol specification
│   ├── host-adapters.md      # Multi-host tool abstraction specifications
│   └── error-catalog.md      # Error taxonomy & remediation handbook
├── roles/                    # Multi-agent role contracts (*.md)
│   ├── orchestrator.md       # Supervisor role bounds & obligations
│   ├── validator.md          # Independent verification contract
│   └── implementer.md        # Work-scope isolation & implementation contract
└── scripts/                  # Executable harness tooling (zero external dependencies)
    ├── src/                  # Subsystem source modules (<= 200 lines each)
    └── harness.ts            # CLI harness entry point
```

### 3.1 Component Directory Invariants

| Directory / File  | Content Mandate                                                      | Placement Invariant           |
| :---------------- | :------------------------------------------------------------------- | :---------------------------- |
| `SKILL.md`        | Skill entry point, YAML frontmatter, activation criteria, quickstart | Top-level of `<skill-name>/`  |
| `AGENTS.md`       | Agent persona catalog, tier hierarchy, platform compatibility        | Top-level of `<skill-name>/`  |
| `agents/*.yaml`   | Machine-readable agent manifests and host provider descriptors       | Strictly inside `agents/`     |
| `checklists/*.md` | Domain checklists (quality, security, verification)                  | Strictly inside `checklists/` |
| `references/*.md` | Technical reference manuals, protocol schemas, host adapters         | Strictly inside `references/` |
| `roles/*.md`      | Multi-agent behavioral contracts and permission boundaries           | Strictly inside `roles/`      |
| `scripts/`        | Executable TypeScript harness, CLI commands, native helpers          | Strictly inside `scripts/`    |

### 3.2 Zero Cross-Skill Runtime Leakage Invariant

A skill must remain fully self-contained and deployable in isolation:

- **No Cross-Skill Imports:** Code in `<skill-a>/scripts/` must never import modules or files from `<skill-b>/scripts/`.
- **No Shared Mutable State:** Skills must never share runtime capsule directories or mutable state files.
- **Independent Testability:** Every skill must have self-contained automated tests under `tests/unit/` and `tests/integration/`.

---

## 4. Comprehensive Skill Authoring Specifications

### 4.1 `SKILL.md` Frontmatter & Structural Schema

Every skill must provide a `SKILL.md` file featuring standard YAML frontmatter and structured documentation sections:

```markdown
---
name: skill-name
description: A high-signal, unambiguous description of the skill, specifying precise activation triggers, operating boundaries, and expected workflows.
---

# Skill Name

Executive overview of the skill, stating its mission, operational domain, and high-level architecture.

## Activation Triggers & Boundaries

- **When to Use:** Concrete conditions, file patterns, or user intents that trigger this skill.
- **When NOT to Use:** Scenarios where another skill or standard tooling should be preferred.
- **Safety Boundaries:** Operational limits, permissions, and containment invariants.

## Multi-Agent Architecture & Tiers

Summary of the agent personas, tiers, and role contracts utilized by this skill.

## Step-by-Step Operating Workflow

Structured, phased execution lifecycle (e.g., Plan -> Execute -> Validate -> Certify).

## Quality Gates & Verification Invariants

Listing of automated gates, test commands, and invariant requirements.

## References & Deep Documentation

- [Agent Manifests](../olt/agents/orchestrator.yaml)
- [Role Contracts](../AGENTS.md)
- [Protocol Specification](../olt/references/protocol.md)
- [Operational Checklists](../olt/checklists/code-quality.md)
```

### 4.2 Agent Manifest Schema (`agents/*.yaml`)

Agent manifests provide declarative, machine-readable specifications of agent personas, operational tiers, tool permissions, and behavioral invariants:

```yaml
name: "implementer"
role: "implementer"
tier: 3
provider:
  - "antigravity"
  - "claude"
  - "codex"
  - "cursor"
  - "generic"
tools:
  enable_write_tools: true
  enable_subagent_tools: false
  enable_mcp_tools: true
permissions:
  may:
    - "Claim ready or retry-ready tasks holding exactly one lease token"
    - "Create, edit, and delete files strictly within assigned write scope"
    - "Execute focused file-scoped tests (bun test <file>)"
    - "Run incremental typechecks and syntax audits"
  must_not:
    - "Modify or touch any file outside assigned write scope"
    - "Validate, review, or self-certify own implementation work"
    - "Prompt user for implementation instructions during autonomous runs"
    - "Write loose scratch files in repository root (scratch strictly in scratch/)"
    - "Introduce TypeScript any types or compiler/linter suppressions"
  commands:
    - "task:brief"
    - "task:claim"
    - "task:check"
    - "task:heartbeat"
    - "task:submit"
    - "task:release"
    - "whoami"
invariants:
  - "DISJOINT_WRITE_SCOPE_ISOLATION"
  - "ZERO_ANY_TYPESCRIPT"
  - "ZERO_COMPILER_SUPPRESSIONS"
  - "FILE_SCOPED_TESTING_ONLY"
  - "NO_ROOT_SCRATCH_FILES"
protocol:
  role_contract: "roles/implementer.md"
  cli: "bun harness.ts"
  zero_json: true
instructions: |
  You are an Implementer agent operating at Tier 3 in the multi-agent hierarchy.
  Your charter is strictly confined to executing your assigned task within your leased write scope.
  Always verify all quality gates prior to submitting your task.
```

### 4.3 Multi-Client Provider Descriptors

To enable autonomous subagent dispatch across diverse AI platforms, each supported host environment is declared in a provider manifest (`agents/<provider>.yaml`):

```yaml
provider: "antigravity"
display_name: "Google Antigravity IDE / CLI"
aliases:
  - "agy"
  - "gemini"
dispatch:
  mechanism: "subagent_tool"
  tool_name: "send_message"
messaging:
  mechanism: "reactive_wakeup"
supported_tiers:
  - 0
  - 1
  - 2
  - 3
capabilities:
  hierarchical_subagents: true
  concurrency_ceiling: 16
  token_reporting: true
  native_resume: true
```

---

## 5. Packaging, Multi-Client Discovery & Distribution Standards

### 5.1 Universal Discovery & Installation

Skills must be globally discoverable and installable via standard agent package managers:

```bash
# Add skill from repository
npx skills add onurseckin/skills --skill olt

# Alternatively using bunx
bunx skills add onurseckin/skills --skill olt

# Update installed skill to latest release
npx skills update olt -g -y
```

### 5.2 Multi-Client Ecosystem Matrix

Skills are deployed to the canonical agent directory (`~/.agents/skills/<skill-name>`) and symlinked across all detected client platforms:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                   MULTI-CLIENT ECOSYSTEM SYMLINK TOPOLOGY                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│                     ~/.agents/skills/<skill-name>/                          │
│                                   │ (Canonical Storage)                     │
│        ┌──────────────────────────┼──────────────────────────┐              │
│        ▼                          ▼                          ▼              │
│  Google Antigravity          Claude Code               OpenAI Codex         │
│  ~/.gemini/antigravity-cli/  ~/.claude/skills/         ~/.codex/skills/     │
│  ~/.gemini/antigravity-ide/  ~/.claude/vendor/         ~/.openai/skills/    │
│  ~/.gemini/config/skills/                                                   │
│  ~/.gemini/skills/                                    Cursor                │
│                                                       ~/.cursor/skills/     │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.3 Automated Symlink & Environment Synchronization

The repository provides an automated synchronizer to link canonical skills, generate global binaries, and configure shell environments:

```bash
# Execute local monorepo synchronization across all assistant platforms
bun scripts/sync/index.ts

# Or via backward-compatible entrypoint
bun scripts/sync-global.ts
```

### 5.4 Zero Runtime Dependencies Invariant

To ensure instantaneous activation and zero-install execution across diverse host environments:

> [!WARNING]
> All runtime code in `<skill-name>/scripts/` and `<skill-name>/scripts/src/` must execute using native runtimes (`bun` or standard `node:` built-ins like `node:fs`, `node:crypto`, `node:child_process`, `node:path`, `node:os`). External runtime dependencies requiring `npm install` in client environments are strictly forbidden.

---

## 6. Strict Quality Gates & Enforcement Invariants

Every skill, script, and documentation file must satisfy the automated quality gates before merge or deployment:

### 6.1 Exact 0 TypeScript `any` Types

- **100% Strict Type Safety:** The use of `any` (or `as any`) is completely prohibited across the codebase.
- **Boundary Validation:** External data boundaries (e.g., JSON payloads, CLI arguments, YAML manifests) must use runtime validation libraries (`zod`, `js-yaml`) or explicit TypeScript type guards.

### 6.2 Zero Compiler / Linter Suppressions

- **Zero Escape Hatches:** Suppressions such as `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck`, `eslint-disable`, and `oxlint-disable` are strictly forbidden in both production code and test suites.
- All type issues must be solved structurally with correct typing.

### 6.3 Context-Friendly File Sizes

To ensure optimal reasoning capacity when loaded into AI context windows:

- **Production Source Files:** $\le 200$ physical lines of code per file.
- **Test Suite Files:** $\le 250$ physical lines of code per file.
- Modularize large files into focused single-responsibility modules in subdirectories.

### 6.4 Falsifiable Automated Testing & Counterfactual Proofs

- **Comprehensive Coverage:** Every command, parser, validator, and state machine must have unit and integration test coverage (`bun test`).
- **Counterfactual Falsifiability:** Quality gates must fail if a required check is omitted, proving that the test suite actually guards against regressions.

### 6.5 Ephemeral Runtime & Repository Hygiene

- **Runtime Capsule Isolation:** All active execution state, task logs, and intermediate artifacts must live inside ephemeral capsules under `.olt/capsules/<run-id>/` (or `.capsules/<run-id>/`).
- **Scratch Directory Isolation:** Transient scratch files must be confined to `scratch/` or `.olt/scratch/`.
- **Zero `/tmp` Directory Leakage:** Production runtime scripts must never write directly to global `/tmp` or `.tmp/`.
- **Zero Static Planning Documents in Git:** Dynamic task plans belong exclusively in ephemeral capsule state; never commit static plan files to `docs/planning/` or repository root.

### 6.6 Plan Archival Lifecycle

When an orchestration run or planning cycle is completed:

- Active execution capsules are archived to `.olt/archive/` or `docs/archive/completed-plans/<plan-slug>/`.
- Archival records preserve the final state, manifest, and review findings for historical provenance without polluting active directories.

---

## 7. Contribution, Validation & Review Lifecycle

Contributors and autonomous agents authoring or modifying skills follow an 8-step lifecycle:

```text
┌─────────────────────────────────────────────────────────────────────────────┐
│                     SKILL AUTHORING & REVIEW LIFECYCLE                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  1. Plan & Scope Definition      --> Define mission, boundary & capsule     │
│  2. Directory Scaffolding        --> Create canonical folder structure      │
│  3. Manifest & Role Authoring    --> Define agents/*.yaml & roles/*.md      │
│  4. Harness Implementation       --> Write zero-dependency scripts/         │
│  5. Test Suite Construction      --> Write falsifiable unit & e2e tests     │
│  6. Quality Gate Verification    --> Execute bun test & typecheck           │
│  7. Conventional Commits         --> Commit with feat/fix/docs semantics    │
│  8. Global Sync & Certification  --> Run bun scripts/sync-global.ts         │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 7.1 Pre-Commit & Verification Commands

Before submitting a change, run the repository verification pipeline:

```bash
# 1. Run unit test suite
bun scripts/testing/test-runner.ts tests/unit

# 2. Run TypeScript strict typecheck
bun run typecheck

# 3. Run linter
bun run lint

# 4. Check formatting
bun run format:check

# 5. Verify global synchronization
bun scripts/sync-global.ts
```

### 7.2 Conventional Commit Standards

Commits must follow the Conventional Commits specification:

- `feat(<skill>): Add new agent role or CLI capability`
- `fix(<skill>): Resolve scope leak or parser edge-case`
- `docs(<skill>): Update Diátaxis documentation or references`
- `test(<skill>): Add falsifiable counterfactual test suite`
- `refactor(<skill>): Modularize subsystem to satisfy file-size limit`

---

## 8. Governance Summary & Invariant Checklist

| Invariant               | Requirement                                 | Automated Verification                            |
| :---------------------- | :------------------------------------------ | :------------------------------------------------ |
| **Type Safety**         | 0 `any` types across all TS files           | `bun run typecheck`                               |
| **Zero Suppressions**   | 0 `@ts-ignore`, `@eslint-disable`           | `bun test tests/unit`                             |
| **Context File Limits** | Prod $\le 200$ lines, Tests $\le 250$ lines | `tests/unit/architecture/file-size.test.ts`       |
| **Documentation**       | Strict Diátaxis quadrant compliance         | `tests/unit/docs/`                                |
| **Root Hygiene**        | No stray files in root or `docs/planning/`  | `tests/unit/authority/root-hygiene-guard.test.ts` |
| **Zero Dependencies**   | Runtime scripts use native `bun`/`node`     | `tests/unit/architecture/vendor-scanner.test.ts`  |
| **Isolation**           | Zero cross-skill runtime imports            | Monorepo architecture audit                       |
