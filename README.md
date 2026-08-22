# Autonomous Agent Skills Monorepo

Welcome to **`@onurseckin/skills`**, a production-grade collection of autonomous AI agent skills engineered for seamless execution across modern AI developer environments including **Google Antigravity**, **Claude Code**, **OpenAI Codex**, and **ChatGPT Coding Agents**.

This repository is structured as a modular, multi-skill monorepo adhering to the universal Agent Skills specification (`SKILL.md` frontmatter + scoped reference docs + zero-dependency runtimes).

---

## 📦 Skills Directory

### 1. [`orchestrating-long-tasks`](./orchestrating-long-tasks/SKILL.md)

**Durable, multi-phase, graph-scheduled task orchestration with adversarial independent validation.**

- **Immutable Prompt Preservation:** Byte-for-byte SHA-256 capture before planning to eliminate scope drift and hallucinated acceptance criteria.
- **Topological Conflict-Free Scheduling:** One scheduling authority, a recorded topology, and glob-aware write-scope isolation. `queue:wave` is a read-only readiness query — everything claimable right now, ranked by critical depth; `queue:pop` / `task:claim` do the actual claiming, one task at a time, continuously, never as a batch to wait on.
- **Adversarial Multi-Agent Validation:** Implementers cannot self-validate, and a repair round needs a _fresh_ validator. Every pass is held behind a mandatory adversarial **probe** — a demand for proof, not a fabricated rejection — and every open finding must be answered with a recorded command id.
- **Execution-Time Branch & Collect:** A working agent can subdivide the work it already holds (`branch:open` … `branch:collect`) without touching the frozen plan; the parent's lease clock freezes and the file list that comes back is a real Git observation.
- **Agent Grant Ledger:** Every dispatched subagent is registered with its role, parent and host-reported telemetry, so a run can answer who was deployed, under whom, and on what model.
- **Labelled Evidence Throughout:** Every reported value carries an `evidence_class` — `harness_observed`, `agent_reported`, `host_reported`, `derived` or `unknown`. Nothing substitutes a plausible value for a missing one.
- **Dual-Channel Validator Protocol:** Computed DOM metrics (`visual-report.json`) alongside Playwright layout screenshots across mobile, tablet, and desktop viewports.
- **Cascading Scope-Aware Replanning:** `plan:replan` partitions findings into a disjoint repair wave so repairs run in parallel too.
- **Durable Crash Recovery:** Capsules under `.capsules/<run-id>/` resume across interruptions; `recover` reclaims dead leases explicitly and `task:release` hands one back voluntarily.
- **Zero Runtime Dependencies:** Pure Bun standard library and native OS bindings (`node:fs`, `node:crypto`, `node:child_process`). No `node_modules` and no network calls at runtime.

📚 **[Read the skill specification →](./orchestrating-long-tasks/SKILL.md)** · 🧭 **[Generated CLI manifest →](./orchestrating-long-tasks/references/cli-capabilities.md)** · 📖 **[Protocol reference →](./orchestrating-long-tasks/references/protocol.md)**

---

## 🏗️ Multi-Agent Orchestration Architecture

The system enforces a strict **3-Tier Hierarchy** and a **Validation Pairing Invariant**: every
implementer's work is independently validated, dispatched continuously up to the configured occupancy
ceiling rather than assembled into fixed-size batches:

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
               │                               │ Spawns in background, implementer paired with validator
               ▼                               ▼
        ┌─────────────┐                 ┌─────────────┐
        │   Tier 3:   │                 │   Tier 3:   │
        │ Implementer │                 │  Validator  │
        │  (Task 1)   │                 │  (Task 1)   │
        └──────┬──────┘                 └─────────────┘
               │ branch:open (execution-time only; never a plan task)
               ▼
     ┌───────────────────────────────┐
     │ sub-implementer / sub-validator│
     │ sub-investigator               │
     └───────────────────────────────┘
```

Nine canonical roles exist, each with a binding capability contract in
[`orchestrating-long-tasks/roles/`](./orchestrating-long-tasks/roles): `coordinator`, `planner`,
`implementer`, `validator`, `repairer`, `completeness-critic`, `sub-implementer`, `sub-validator`,
`sub-investigator`. `task:claim --role` binds the agent to one for the whole lease.

1. **Tier 1 (Main Interactive Thread)**: Dedicated exclusively to user interaction, requirement intake, and milestone delivery.
2. **Tier 2 (Background Run Coordinator)**: Persistent manager of capsule lifecycle, prompt capture, graph compilation, concurrency waves, and run completion.
3. **Tier 3 (Implementer & Validator Pairs)**: Dispatched concurrently through the host's own native subagent mechanism — the harness never hardcodes a vendor's dispatch tool. For every implementer modifying code in a leased `write_scope`, an independent paired validator audits the work and runs mandatory gates.
4. **Validation Pairing Invariant, No Fixed Batch Size**: an implementer's work is always independently validated — that pairing never lapses, even for a single task. Beyond that there is no fixed implementer:validator ratio or wave arithmetic to compute: the scheduler keeps every eligible task dispatched up to the configured `max_parallel` occupancy ceiling, continuously, as slots free rather than in fixed-size batches.
5. **Every Agent Is Registered**: Spawning happens host-side, so the run learns an agent exists only when `agent:register` records it. Model, tier, thinking level and token counts are recorded when the host reports them, and stay `unknown` when it does not.

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

## ⚡ Quickstart: One Task, End to End

Every line below was executed in order and works as written. `jv` reads one field out of a
`--format json` result, which is how a real coordinator captures the bearer tokens the harness prints
exactly once.

```bash
H=orchestrating-long-tasks/scripts/harness.ts
RUN=.capsules/quickstart
jv() { bun -e 'const p=Bun.argv[1];const j=JSON.parse(await Bun.stdin.text());console.log(String(p.split(".").reduce((a,k)=>a?.[k],j)))' "$1"; }

# 0. The capsule must be gitignored before it may be created
printf '.capsules/\n' >> .gitignore

# 0b. The gate has to name a file that exists: run:exec refuses a gate path it cannot lstat
mkdir -p tests && cat > tests/slug.test.ts <<'EOF'
import { expect, test } from "bun:test";
import { slugify } from "../src/slug.ts";

test("lowercases and hyphenates", () => {
  expect(slugify("Hello World")).toBe("hello-world");
});

test("collapses punctuation instead of leaving empty segments", () => {
  expect(slugify("Ship it, now!")).toBe("ship-it-now");
});
EOF

# 1. Freeze the prompt
printf '%s\n' 'Add a slugify helper in src/slug.ts that lowercases text and collapses punctuation into single hyphens.' > prompt.txt
bun $H plan:init --repo . --run quickstart --prompt-file prompt.txt --capture-mode file

# 2. Declare the task, bound to the prompt line it implements
bun $H plan:add --run $RUN --actor planner --id task-slug --label "Slugify helper" \
  --scope src/slug.ts --gate "bun test tests/slug.test.ts" --requirement-lines 1

# 3. Compile. --completion-gate is mandatory and has no default.
bun $H plan:compile --run $RUN --actor planner --completion-gate "bun test tests"

# 4. See what's claimable right now (read-only; queue:pop / task:claim do the actual claiming)
bun $H queue:wave --run $RUN

# 5. Register every agent before it works
bun $H agent:register --run $RUN --agent coordinator-1 --role coordinator --host claude-code
bun $H agent:register --run $RUN --agent impl-1 --role implementer --host claude-code \
  --parent-agent coordinator-1 --parent-task task-slug
bun $H agent:register --run $RUN --agent val-1 --role validator --host claude-code \
  --parent-agent coordinator-1 --parent-task task-slug

# 6. Claim under an explicit role and capture the one-time token
TOKEN=$(bun $H task:claim --format json --run $RUN --task task-slug --agent impl-1 --role implementer | jv result.token)

# ... the implementer works, inside its write scope and nowhere else ...
mkdir -p src && cat > src/slug.ts <<'EOF'
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
EOF

# 7. Prove it, then submit. --summary is mandatory.
bun $H run:exec --run $RUN --task task-slug --gate gate-slug --actor impl-1 -- bun test tests/slug.test.ts
bun $H task:submit --run $RUN --task task-slug --agent impl-1 --token "$TOKEN" \
  --summary "slugify lowercases, collapses punctuation runs to one hyphen, and trims the edges."

# 8. Independent validation: probe first, then pass
VAL=$(bun $H task:validate-start --format json --run $RUN --task task-slug --validator val-1 | jv result.token)
DEMAND=$(bun $H task:probe --format json --run $RUN --task task-slug --validator val-1 --token "$VAL" \
  --demand "Prove the punctuation case is covered by a test that actually runs." \
  --revalidation "bun test tests/slug.test.ts" | jv result.finding_ids.0)
PROOF=$(bun $H run:exec --format json --run $RUN --task task-slug --gate gate-slug --actor val-1 \
  -- bun test tests/slug.test.ts | jv result.command_id)
bun $H task:review --run $RUN --task task-slug --validator val-1 --token "$VAL" --status pass \
  --summary "Gate rerun independently; the demand is answered by that run." \
  --checks "$PROOF" --resolve "$DEMAND=$PROOF"

# 9. Run gate, then a critic that runs its OWN unbound commands
bun $H run:exec --run $RUN --gate gate-run-completion --actor coordinator-1 -- bun test tests
bun $H agent:register --run $RUN --agent critic-1 --role completeness-critic --host claude-code \
  --parent-agent coordinator-1
CRITIC=$(bun $H critic:start --format json --run $RUN --critic critic-1 | jv result.token)
CPROOF=$(bun $H run:exec --format json --run $RUN --actor critic-1 -- bun test tests | jv result.command_id)
# Write the proofs OUTSIDE the repository: any byte that changes after critic:start invalidates the authorization
PROOFS="${TMPDIR:-/tmp}/proofs.json"
printf '[{"requirement_id":"req-slug","status":"satisfied","evidence":[{"kind":"command","reference":"%s","observation":"the critic ran the suite itself and it exited 0"}]}]\n' "$CPROOF" > "$PROOFS"
bun $H critic:review --run $RUN --critic critic-1 --token "$CRITIC" --decision approve \
  --proofs-file "$PROOFS" --summary "The prompt line is implemented and bound to a recorded gate run."

# 10. Close every grant BEFORE sealing: a completed run is terminal
for a in impl-1 val-1 critic-1 coordinator-1; do bun $H agent:release --run $RUN --agent "$a" --reason "run sealed"; done
bun $H run:complete --run $RUN --actor coordinator-1 --auth-token "$CRITIC"

# 11. Read the result
bun $H run:status --run $RUN
bun $H agent:list --run $RUN --task task-slug
bun $H summary:export --run $RUN
bun $H doctor --run $RUN
```

Five things in that sequence are easy to get wrong and are refused outright:

- `--format json` must come **before** any `--`, or it is passed to the child process.
- `task:review --status pass` needs a `--resolve` for **every** open finding — probe demands and
  defects alike — and is blocked while a mandatory gate's recorded run exited nonzero.
- The critic's evidence must be commands **it** ran with no `--task`; a validator's run is not critic
  evidence, and a requirement with no proof is recorded `unproven` and blocks completion.
- Nothing in the repository may change between `critic:start` and `critic:review`, not even a scratch
  file — the authorization is bound to the bytes it inspected. Write the proofs payload outside the
  repository.
- `run:complete --auth-token` is mandatory — it is the same token `critic:start` handed back,
  checked against that assignment's own record rather than the critic's live grant, so releasing the
  critic first does not invalidate it. Omitting it is refused outright, not defaulted.

The [run playbook](./orchestrating-long-tasks/references/run-playbook.md)
runs the same flow with a branch, a real rejection and a repair round.

---

## 📊 Visualizing Execution Graphs in GVUI

Runs executed by `orchestrating-long-tasks` produce complete execution graph datasets, agent-grant telemetry, gate verifications, and visual audit evidence inside `.capsules/<run-id>/`. Every value in that export carries its `evidence_class`, and a value nobody reported renders as `unknown` rather than as a plausible default. You can visualize any run interactively in [**GVUI (Graph Visualization UI)**](https://github.com/onurseckin/gvui):

### 1. Export the Capsule Summary Suite

From the workspace where your task ran, export the graph datasets:

```bash
bun orchestrating-long-tasks/scripts/harness.ts summary:export --run .capsules/<run-id>
```

This compiles `.capsules/<run-id>/summary/`:

- `graph.json` — Nodes, edges and sections. Validators are their own nodes, a branch becomes a section carrying the reason it was opened, and each node owns its evidence in `node.assets` plus its `scripts`, `tools` and `stateTransitions`.
- `metrics.json` — Gate pass rates, wall-clock timing, and token footprints where the host reported them.
- `timeline.json` — Event-sourced state transitions, with each review carrying its verdict, round, finding class and finding count.
- `summary.md` — The complete run report: prompt, enhanced plan, requirements, waves, an ASCII task graph, every agent, branch, command, tool, probe, pushback, gate, the critic's verdict and the full timeline.

Real output from a two-task run with one branch:

```text
### Summary Suite Exported: `slugger`
- **Capsule Summary Root**: `.capsules/slugger/summary`
- **Artifacts Generated**:
  - `graph.json` (GVUI GraphDataset, 12 nodes, 19 edges)
  - `timeline.json` (61 chronological events)
  - `metrics.json` (2/2 satisfied tasks)
  - `summary.md` (complete run report)
```

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
├── docs/                    # Repository-wide skill collection guidelines
│   ├── README.md
│   └── SKILL_COLLECTION_GUIDELINES.md
├── <new-skill-name>/
│   ├── SKILL.md             # Standard skill definition with YAML frontmatter
│   ├── agents/
│   │   └── openai.yaml      # Client-specific agent descriptors
│   ├── references/          # Detailed documentation and playbooks
│   │   └── *.md
│   ├── roles/               # (Optional) Capability contracts, one per agent role
│   │   └── <role>.md
│   └── scripts/             # (Optional) Executable tooling, helpers, and tests
│       ├── src/
│       └── tests/
```

For comprehensive multi-skill monorepo standards and quality gates, refer to [**`docs/SKILL_COLLECTION_GUIDELINES.md`**](./docs/SKILL_COLLECTION_GUIDELINES.md).

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
2. **Run Test Suites**: `bun run test:unit` (or `bun run test:integration`, `bun run test:all`)
3. **Strict Type Safety**: `bun run typecheck` (zero TypeScript `any`, zero `@ts-ignore`)
4. **Code Formatting**: `bun run format` (using `oxfmt`)
5. **Zero Runtime Dependencies**: All runtime scripts must run directly via `bun` standard libraries and Node built-ins without requiring runtime `node_modules`.
6. **The CLI Manifest Is Generated**: `references/cli-capabilities.md` and `.json` are rendered from `src/cli/registry/` by `scripts/generate-cli-manifest.ts`, and a unit test asserts the checked-in files still match the registry. Change the registry, regenerate, never hand-edit.
7. **Role Contracts Are Checked**: every `commands:` entry in `orchestrating-long-tasks/roles/*.md` must name a command that exists in the manifest, and the frontmatter is parsed and hashed at runtime — a malformed contract is an `INTEGRITY` error.

---

## 📄 License

MIT © [Onur Seçkin Şenoğlu](https://github.com/onurseckin)
