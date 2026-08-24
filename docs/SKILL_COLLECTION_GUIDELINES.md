# Skill Collection Guidelines

This document establishes the repository-level authoring, packaging, quality gate, and governance standards for all skills contained within the **`@onurseckin/skills`** monorepo.

---

## 1. Skill Monorepo Directory Anatomy

Every skill in this repository must live in its own top-level directory and adhere to the canonical skill folder structure:

```text
<skill-name>/
├── SKILL.md                  # Canonical skill entry point with YAML frontmatter
├── agents/                   # Unified agent manifests & assistant descriptors (identity + permissions + runbook)
│   └── *.yaml
├── checklists/               # Operational domain checklists (e.g. code-quality, security)
│   └── *.md
├── references/               # Deep reference manuals, protocol specs, configuration guides
│   └── *.md
├── roles/                    # Multi-agent role contracts & grant definitions
│   └── *.md
└── scripts/                  # (Optional) Zero-dependency executable scripts and harness code
    ├── src/
    └── harness.ts
```

---

## 2. Skill Authoring Standards

### 2.1 `SKILL.md` Specification

Every skill must declare a root `SKILL.md` file featuring standard YAML frontmatter:

```markdown
---
name: skill-name
description: A clear, high-signal description of the skill, outlining specific activation triggers, operational boundaries, and workflow expectations.
---

# Skill Name

Clear overview, activation criteria, step-by-step instructions, and usage examples.
```

- **Relative Documentation Links:** All internal links within `SKILL.md` must use relative paths targeting files within the skill's own directory (e.g., `./references/protocol.md`, `./agents/mind.yaml`).
- **No Cross-Skill Leakage:** A skill must never hardcode runtime dependencies or relative imports pointing to another skill's internal runtime.

---

## 3. Packaging & Distribution Standards

1. **Compatibility with `npx skills` / `bunx skills`:**
   - Skills must be installable via standard discovery commands:
     `npx skills add onurseckin/skills --skill <skill-name>`
2. **Multi-Client Support:**
   - Skills must support modern AI developer tools (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT) without requiring platform-specific forks.
3. **Zero Runtime Dependencies:**
   - Any runtime code included in `scripts/` must execute using native runtimes (`bun` or `node` built-ins). No external `node_modules` or runtime `npm install` requirements are permitted.

---

## 4. Quality Gates & Enforcement Invariants

All contributions and skill updates must pass the repository quality gates:

1. **Strict Type Safety:**
   - Exactly **0 TypeScript `any`** types allowed.
   - All external data boundaries must utilize runtime schema validation or TypeScript type guards.
2. **Zero Compiler/Linter Suppressions:**
   - Exactly **0 suppressions** (`@ts-ignore`, `@ts-expect-error`, `@eslint-disable`) allowed across the codebase.
3. **Context-Friendly File Sizes:**
   - Production source files should be compact and modular ($\le 200$ lines for production sources, $\le 250$ lines for test suites).
4. **Falsifiable Automated Testing:**
   - Every feature, CLI command, and role invariant must have unit and integration test coverage (`bun test`).
   - Gates must fail when changes are missing or reverted, proving gate falsifiability.
5. **No Static Planning Files in Git:**
   - Execution state belongs strictly in ephemeral capsules under `.olt/capsules/<run-id>/`, never committed as static planning docs in `docs/planning/`.

---

## 5. Cross-Skill Governance

- **Repository Root `docs/` Separation:** Root `docs/` is reserved solely for collection-wide guidelines. Individual skill documentation belongs inside `<skill-name>/references/` or `<skill-name>/mind/`.
- **Atomic Commits:** Multi-skill modifications must maintain distinct, atomic commit boundaries.
- **Continuous Invariant Verification:** Run `bun test tests/unit` and `bun run typecheck` to verify repository integrity before merging changes.
