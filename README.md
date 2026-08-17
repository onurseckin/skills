# Autonomous Agent Skills Monorepo

Welcome to **`@onurseckin/skills`**, a production-grade collection of autonomous AI agent skills engineered for seamless execution across modern AI developer environments including **Google Antigravity**, **Claude Code**, **OpenAI Codex**, and **ChatGPT Coding Agents**.

This repository is structured as a modular, multi-skill monorepo adhering to the universal Agent Skills specification (`SKILL.md` frontmatter + scoped reference docs + zero-dependency runtimes).

---

## 📦 Skills Directory

### 1. [`orchestrating-long-tasks`](./orchestrating-long-tasks/SKILL.md)

**Durable, multi-phase, graph-scheduled task orchestration with adversarial independent validation.**

- **Immutable Prompt Preservation:** Byte-for-byte SHA-256 capture before planning to eliminate scope drift and hallucinated acceptance criteria.
- **Topological Conflict-Free Scheduling:** Dependency graph compilation with strict write-scope and resource isolation.
- **Adversarial Multi-Agent Validation:** Implementers cannot self-validate; independent validators generate command-backed proofs under trusted host observation (`run:exec`).
- **Dual-Channel Validator Protocol:** Synthesizes computed DOM metrics (`visual-report.json`) with authentic Playwright layout screenshots (`.png`) across mobile, tablet, and desktop viewports.
- **Cascading Scope-Aware Replanning:** Automatic fan-back and repair wave generation (`plan:replan`) upon completeness critic pushbacks.
- **Durable Crash Recovery:** Ephemeral capsules under `.capsules/<run-id>/` allow resuming seamlessly across interruptions, restarts, or context resets.
- **Zero Runtime Dependencies:** Pure Bun standard library and native OS bindings (`bun:sqlite`, `node:fs`, `node:crypto`, `node:child_process`). Requires no `node_modules` or external network calls at runtime.

---

## 🏗️ Multi-Agent Orchestration Architecture

The system enforces a strict **3-Tier Hierarchy** and the **"$2N + 1$" Sizing Invariant**:

```
┌─────────────────────────────────────────────────────────────┐
│             Tier 1: Main Interactive Chat Session           │
│   (Dedicated to human conversation; 0 worker tool chatter)  │
└──────────────────────────────┬──────────────────────────────┘
                               │ Spawns 1 Coordinator
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Tier 2: Background Run Coordinator              │
│   (Owns capsule lifecycle, planning, waves, and validation) │
└──────────────┬───────────────────────────────┬──────────────┘
               │                               │ Spawns in background (2N+1 Triad)
               ▼                               ▼
        ┌─────────────┐                 ┌─────────────┐
        │   Tier 3:   │                 │   Tier 3:   │
        │ Implementer │                 │  Validator  │
        │  (Task 1)   │                 │  (Task 1)   │
        └─────────────┘                 └─────────────┘
```

1. **Tier 1 (Main Interactive Thread)**: Dedicated exclusively to user interaction, requirement intake, and milestone delivery.
2. **Tier 2 (Background Run Coordinator)**: Persistent manager of capsule lifecycle, prompt capture, graph compilation, concurrency waves, and run completion.
3. **Tier 3 (Implementer & Validator Pairs)**: Dispatched concurrently via `invoke_subagent`. For every implementer modifying code in a leased `write_scope`, an independent paired validator audits the work and runs mandatory gates.
4. **Triad Floor Invariant ($\ge 3$ Agents)**: Even for a single task ($N = 1$), 3 agents are deployed (1 Coordinator + 1 Implementer + 1 Validator). For $N$ parallel tasks, $2N + 1$ agents are deployed.

---

## 🚀 Installation & Client Linking

### Method A: Install via `npx skills` / `bunx skills` (Recommended)

Install any skill globally or locally into your current project:

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

# Update installed skills to latest version
npx skills update

# Remove an installed skill
npx skills remove orchestrating-long-tasks
```

---

### Method B: Native Harness Multi-Client Installer

For `orchestrating-long-tasks`, use the native zero-dependency installer to link the canonical skill across all supported AI assistants simultaneously:

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

## ⚡ Quickstart: Running a Multi-Agent Task

```bash
PINNED=orchestrating-long-tasks/scripts/harness.ts
RUN=.capsules/2026-08-17-feature-implementation

# 1. Initialize Capsule with immutable prompt capture
printf "%s" "Implement user authentication and profile dashboard" | \
  bun $PINNED plan:init --repo . --run 2026-08-17-feature-implementation --prompt-stdin

# 2. Stage Modular Tasks
bun $PINNED plan:add --run $RUN --id auth-api --label "Auth API & JWT" --scope "src/auth,src/middleware" --gate "bun test tests/auth.test.ts"
bun $PINNED plan:add --run $RUN --id user-ui --label "User Profile UI" --scope "src/components/profile" --gate "bun test tests/profile.test.ts" --deps auth-api

# 3. Compile DAG Plan
bun $PINNED plan:compile --run $RUN --actor coordinator

# 4. Claim Task & Execute Implementation
bun $PINNED task:claim --run $RUN --task auth-api --agent worker-auth
# (Worker edits code within src/auth and src/middleware)
bun $PINNED task:submit --run $RUN --task auth-api --agent worker-auth --token <WORKER_TOKEN> --summary "Implemented JWT auth"

# 5. Independent Validator Verification
bun $PINNED task:validate-start --run $RUN --task auth-api --validator val-auth
bun $PINNED run:exec --run $RUN --task auth-api --gate gate-1 --actor val-auth -- bun test tests/auth.test.ts
bun $PINNED task:review --run $RUN --task auth-api --validator val-auth --token <VAL_TOKEN> --status pass --summary "All auth tests pass"

# 6. Completeness Critic & Run Seal
bun $PINNED critic:start --run $RUN --critic critic-1
bun $PINNED critic:review --run $RUN --critic critic-1 --token <CRITIC_TOKEN> --decision approve --summary "Whole-diff verified against prompt"
bun $PINNED run:complete --run $RUN --actor coordinator
```

---

## 📊 Visualizing Execution Graphs in GVUI

Runs executed by `orchestrating-long-tasks` produce complete execution graph datasets, subagent telemetry, gate verifications, and visual audit evidence inside `.capsules/<run-id>/`. You can visualize any run interactively in [**GVUI (Graph Visualization UI)**](https://github.com/onurseckin/gvui):

### 1. Export the Capsule Summary Suite

From the workspace where your task ran, export the graph datasets:

```bash
bun orchestrating-long-tasks/scripts/harness.ts summary:export --run .capsules/<run-id>
```

This compiles `.capsules/<run-id>/summary/`:

- `graph.json` — Interactive DAG nodes, edges, subagents, and execution states.
- `metrics.json` — Token footprints, wall-clock timing, gate pass rates.
- `timeline.json` — Event-sourced state transitions and heartbeat logs.
- `summary.md` — Executive Markdown brief.

### 2. Import into GVUI via CLI

In your local `gvui` repository, import the capsule report:

```bash
# From the gvui repository root:
bun run gvui:import --capsule /path/to/.capsules/<run-id>
# Or directly:
bun scripts/import-capsule.ts --capsule /path/to/.capsules/<run-id>
```

### 3. Explore the Execution Graph

Start the GVUI dev server and open the preview URL:

```bash
bun run dev:host  # http://localhost:4444
```

Open **`http://localhost:4444/?graph=<slug>`** to inspect interactive DAG topologies, subagent telemetry, dual-channel visual validation screenshots, and gate evidence.

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

## 💻 Development & Quality Invariants

When developing or updating skills locally:

1. **Install Dev Dependencies**: `bun install`
2. **Run Test Suites**: `bun test` (or `bun run test:unit`, `bun run test:integration`)
3. **Strict Type Safety**: `bun run typecheck` (zero TypeScript `any`, zero `@ts-ignore`)
4. **Code Formatting**: `bun run format` (using `oxfmt`)
5. **Zero Runtime Dependencies**: All runtime scripts must run directly via `bun` standard libraries and Node built-ins without requiring runtime `node_modules`.

---

## 📄 License

MIT © [Onur Seçkin Şenoğlu](https://github.com/onurseckin)
