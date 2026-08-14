# Agent Skills Collection

A curated collection of autonomous AI agent skills designed for seamless execution across **Google Antigravity**, **Claude Code**, **OpenAI Codex**, and **ChatGPT Coding Agents**.

---

## Skills in this Repository

### 1. [`orchestrating-long-tasks`](./orchestrating-long-tasks/SKILL.md)

**Turn large, complex, multi-phase prompts into durable, graph-scheduled, independently validated executions.**

- **Immutable Prompt Preservation:** Byte-for-byte SHA-256 capture before planning.
- **Topological Conflict-Free Scheduling:** Dependency graph scheduling with strict write-scope isolation.
- **Adversarial Multi-Agent Validation:** Implementers cannot self-validate; independent validators generate command-backed proofs.
- **Deterministic Crash Recovery:** Ephemeral capsules under `.harness/<run-id>/` allow resuming after interruptions, context loss, or client changes.
- **Zero Runtime Dependencies:** Built using pure Bun standard library + native OS bindings (no `node_modules` or `bun install` needed at runtime).

---

## Installation

### Method A: Install via `npx skills` (Standard)

To install skills directly into your global agent environment:

```bash
# Install all skills from this repository
npx skills add onurseckin/skills

# Or install a specific skill
npx skills add onurseckin/skills --skill orchestrating-long-tasks
```

### Method B: Native Harness Installer

If you have cloned this repository locally, you can use the built-in installer to set up canonical skills and multi-client symlinks:

```bash
bun orchestrating-long-tasks/scripts/harness.ts install \
  --source $(pwd)/orchestrating-long-tasks \
  --home ~ \
  --clients codex,chatgpt,claude,antigravity
```

To verify installation status:

```bash
bun orchestrating-long-tasks/scripts/harness.ts installation-status \
  --source $(pwd)/orchestrating-long-tasks \
  --home ~
```

---

## Directory Layout

```text
skills/
├── README.md
├── package.json
├── tsconfig.json
├── .gitignore
├── .github/workflows/ci.yml
└── orchestrating-long-tasks/
    ├── SKILL.md
    ├── agents/
    │   └── openai.yaml
    ├── references/
    │   ├── cli.md
    │   ├── failure-modes.md
    │   ├── host-adapters.md
    │   ├── parity-matrix.md
    │   ├── protocol.md
    │   ├── schema-examples.md
    │   └── state-model.md
    └── scripts/
        ├── harness.ts
        ├── src/
        ├── assets/
        └── tests/
```

---

## Development

Run tests and typechecks across all skills:

```bash
# Run all unit and regression tests
bun test

# Typecheck TypeScript codebase
bun run typecheck

# Format files
bun run format
```

---

## License

MIT © [Onur Seçkin Şenoğlu](https://github.com/onurseckin)
