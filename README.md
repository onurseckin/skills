# Personal Agent Skills Repository

Welcome to **`@onurseckin/skills`**, a centralized collection of high-performance, autonomous AI agent skills designed for seamless execution across modern AI developer environments including **Google Antigravity**, **Claude Code**, **OpenAI Codex**, and **ChatGPT Coding Agents**.

This repository is structured as a modular, multi-skill monorepo adhering to the universal Agent Skills specification (`SKILL.md` frontmatter + scoped reference docs + zero-dependency runtimes).

---

## 📦 Skills Directory

### 1. [`orchestrating-long-tasks`](./orchestrating-long-tasks/SKILL.md)

**Durable, multi-phase, graph-scheduled task orchestration with adversarial independent validation.**

- **Immutable Prompt Preservation:** Byte-for-byte SHA-256 capture before planning to eliminate scope drift and hallucinated acceptance criteria.
- **Topological Conflict-Free Scheduling:** Dependency graph scheduling with strict write-scope and resource isolation.
- **Adversarial Multi-Agent Validation:** Implementers cannot self-validate; independent validators generate command-backed proofs under trusted host observation.
- **Durable Crash Recovery:** Ephemeral capsules under `.capsules/<run-id>/` allow resuming seamlessly across interruptions, restarts, or context resets.
- **Zero Runtime Dependencies:** Pure Bun standard library and native OS bindings (`bun:sqlite`, `node:fs`, `node:crypto`, `node:child_process`). Requires no `node_modules` or `bun install` at runtime.

---

## 🚀 Installation Guide

### Method A: Install via `npx skills` / `bunx skills` (Recommended)

You can install any skill from this repository globally or locally into your current project using standard skill discovery:

```bash
# Install all skills from this repository
npx skills add onurseckin/skills

# Install a specific skill (e.g. orchestrating-long-tasks)
npx skills add onurseckin/skills --skill orchestrating-long-tasks

# Or using Bun
bunx skills add onurseckin/skills --skill orchestrating-long-tasks
```

#### Managing Installed Skills:

```bash
# List all installed skills across your environment
npx skills list

# Check for updates from GitHub
npx skills check

# Update installed skills to the latest version
npx skills update

# Remove an installed skill
npx skills remove orchestrating-long-tasks
```

---

### Method B: Native Harness Multi-Client Installer

For the `orchestrating-long-tasks` skill, you can also use the native zero-dependency installer to link the canonical skill across all supported AI assistants simultaneously:

```bash
# Install and link to Claude Code, Antigravity, Codex, and ChatGPT
bun orchestrating-long-tasks/scripts/harness.ts install \
  --source $(pwd)/orchestrating-long-tasks \
  --home ~ \
  --clients codex,chatgpt,claude,antigravity

# Verify installation health and symlink integrity
bun orchestrating-long-tasks/scripts/harness.ts installation-status \
  --source $(pwd)/orchestrating-long-tasks \
  --home ~
```

---

## 🛠️ Adding New Skills to this Repository

Adding a new skill is straightforward. Each skill lives in its own top-level directory:

```text
skills/
├── README.md
├── package.json
├── tsconfig.json
├── <new-skill-name>/
│   ├── SKILL.md             # Standard skill definition with YAML frontmatter
│   ├── agents/
│   │   └── openai.yaml      # Client-specific agent descriptors
│   ├── references/          # Detailed documentation and playbooks
│   │   └── *.md
│   └── scripts/             # (Optional) Executable tooling, helpers, and tests
│       ├── src/
│       └── tests/
```

### Standard `SKILL.md` Format:

```markdown
---
name: your-skill-name
description: Clear, concise description of when and how the agent should trigger this skill.
---

# Your Skill Title

Detailed instructions, workflows, triggers, and operational steps...
```

---

## 💻 Development & Maintenance Mode

When developing or updating skills locally:

### 1. Install Dev Dependencies

Developer tooling (`typescript`, `oxfmt`, `@types/bun`, `@types/node`) is used for local typechecks and testing:

```bash
bun install
```

### 2. Run Test Suites

All skills maintain comprehensive test suites:

```bash
# Run all unit, integration, and architecture tests
bun test

# Or run tests for a specific skill
cd orchestrating-long-tasks/scripts && bun test
```

### 3. Typecheck & Formatting

Enforce zero-error type safety and consistent code style:

```bash
# Run strict TypeScript compiler verification
bun run typecheck

# Format codebase
bun run format
```

### 4. Local Testing & Verification

Before pushing changes, test installing locally from your local working copy:

```bash
# Test local installation
npx skills add ./orchestrating-long-tasks
```

---

## 📜 Quality Invariants

All skills in this repository adhere to the following core engineering standards:

1. **Zero Runtime Dependencies:** Runtime scripts must run directly via `bun` or `node` built-ins without requiring runtime `npm install`.
2. **Context Modularity:** Keep production files within context-friendly limits ($\le 200$ lines for production sources, $\le 250$ lines for tests).
3. **No Hardcoded Tokens or AI APIs:** Tooling must remain host-agnostic and avoid hardcoded vendor API keys or network model calls.
4. **Strict Type Safety:** Zero TypeScript `any` types; all boundaries must use strict types with type guards.

---

## 📄 License

MIT © [Onur Seçkin Şenoğlu](https://github.com/onurseckin)
