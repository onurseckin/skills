# Host adapters — how each application dispatches and coordinates agents

The harness never calls a language model. Every agent is spawned by the host application you are running
inside, using that application's own mechanism, under your own subscription. This file is what an
orchestrator or coordinator reads to know which mechanism it has and what that host can actually do.

**A vendor tool name is a value, never a rule.** The rules below are stated against the abstract contract;
the tool names live in the adapter table.

## 1. Tiered Agent Architecture

All supported host environments must enforce the **Tiered Isolation Model**. The main thread hands off
to exactly one agent — an orchestrator — and stops; the orchestrator hands off to exactly one
coordinator per round; only the coordinator ever touches task-level work:

```
┌─────────────────────────────────────────────────────────────┐
│             Tier 0: Main Interactive Chat Session            │
│   (Dedicated to human conversation; 0 worker tool chatter)   │
└──────────────────────────────┬───────────────────────────────┘
                               │ Spawns 1 Orchestrator
                               ▼
┌─────────────────────────────────────────────────────────────┐
│           Tier 1: Background Loop Orchestrator                │
│ (Owns the round scheduler; chains capsules; final synthesis)  │
└──────────────────────────────┬───────────────────────────────┘
                               │ Spawns 1 Coordinator per round
                               ▼
┌─────────────────────────────────────────────────────────────┐
│             Tier 2: Background Run Coordinator               │
│   (Owns capsule lifecycle, planning, waves, and validation)  │
└──────────────┬───────────────┬───────────────┬───────────────┘
               │               │               │ Spawns in background
               ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │   Tier 3:   │ │   Tier 3:   │ │   Tier 3:   │
        │  Worker A   │ │  Worker B   │ │  Validator  │
        └─────────────┘ └─────────────┘ └─────────────┘
```

0. **Tier 0 (Main Interactive Thread)**:
   - Remains 100% responsive for user chat.
   - On standard task runs (`orchestrate`), spawns **exactly one** background orchestrator agent, then stops — it never reads the
     repository, stages a plan, or dispatches a coordinator or worker itself. See `orchestrate`'s
     brief in `SKILL.md`: dispatching that one orchestrator is the whole of Tier 0's job.
   - On `/olt mind` (autonomous product owner mode), spawns **both** Tier 0 Mind (`agents/mind.yaml`) and companion Tier 1 Mind Auditor (`agents/mind-auditor.yaml`) in a single 1-shot batch dispatch (`invoke_subagent` with `Subagents: [...]`), injecting verbatim manifests. Because Mind cannot self-spawn Mind Auditor under `ALLOWED_TIER_SPAWNS`, both must be deployed together in 1-shot batch by Tier 0.
   - Never directly executes implementer tool loops or polls state.
1. **Tier 1 (Background Loop Orchestrator)**:
   - Owns the round scheduler: chains capsule state across rounds, synthesizes a round's unresolved
     findings into the next round's prompt, and declares clean convergence or escalates at the round
     budget.
   - Spawns **exactly one** Tier 2 coordinator per round, and never a Tier 3 agent directly.
   - Composes the one finished report from every round's summary; a coordinator's or critic's
     findings are synthesized into the next round, never bubbled to Tier 0 as an unresolved report.
   - Unified manifest: `agents/orchestrator.yaml`.
2. **Tier 2 (Background Run Coordinator)**:
   - Owns `.olt/capsules/<run_id>/` execution lifecycle for one round.
   - Equipped with subagent tools (`enable_subagent_tools: true` or native team lead capabilities).
   - Coordinates execution waves and routes findings to workers; reports its round's milestones to
     the Tier 1 orchestrator that dispatched it.
3. **Tier 3 (Worker & Validator Subagents)**:
   - Ephemeral task executors assigned to a single disjoint `write_scope`.
   - Report exclusively to the Background Run Coordinator in the background tree.

---

## 2. Milestone-Only Notification Protocol

Milestones climb the ladder one tier at a time; nothing skips a tier. The Background Run Coordinator
notifies the **Tier 1 orchestrator** that dispatched it, never the user directly:

| Milestone Event                  | Notification Sent to Orchestrator? | Content Delivered                                                   |
| :------------------------------- | :--------------------------------- | :------------------------------------------------------------------ |
| **Plan Compiled**                | ✅ Yes                             | Brief summary of total tasks, execution waves, and write scopes.    |
| **Wave Completed**               | ✅ Yes                             | Confirmation of completed wave tasks and entry into validation.     |
| **Escalation / Decision Needed** | ✅ Yes                             | Finding details if a task exhausts configured repair rounds.        |
| **Step / Tool-Call Noise**       | ❌ No (Suppressed)                 | Internal test runs, file edits, and heartbeats stay in background.  |
| **Run Complete**                 | ✅ Yes                             | Final completeness sign-off, diff summary, and verification report. |

The orchestrator does not relay each of those to the user. It absorbs every round's milestones —
including a coordinator's or critic's findings — and forwards to the **Tier 0 main thread** only its
own, whole-loop milestones: a round advanced (with the synthesized reason why), an escalation the
round budget could not resolve, or the loop's one finished report. A per-round detail that reaches the
orchestrator either becomes fuel for the next round or is folded into that final report; it is never
handed to Tier 0 as a raw, unresolved finding for the main thread to act on itself.

---

## 3. Host Adapters

### 3.1 The abstract contract

Whatever the host, an orchestrator or coordinator needs five things. If a host cannot provide one, that
is a capability gap to be declared, not worked around silently.

| Need           | What it means                                                |
| :------------- | :----------------------------------------------------------- |
| **Dispatch**   | Start an agent with a role, a scope, and a packet            |
| **Identity**   | Learn the agent's id, so `agent:register` can bind the grant |
| **Completion** | Know when it finished and what it returned                   |
| **Isolation**  | Keep concurrent agents from colliding on the same files      |
| **Recovery**   | Resume or replace an agent that died mid-task                |

---

### 3.2 Adapter table

| Host                        | Dispatch                                   | Definitions                                                               | Messaging                                                                                                               | Depth                                                                                    | Concurrency                                 |
| :-------------------------- | :----------------------------------------- | :------------------------------------------------------------------------ | :---------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :------------------------------------------ |
| **Claude Code**             | `Agent` tool                               | `.claude/agents/*.md` (YAML frontmatter)                                  | `SendMessage` (v2.1.206+); experimental Agent Teams use file mailboxes at `~/.claude/teams/<team>/inboxes/<agent>.json` | 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`)                                               | 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`) |
| **Antigravity** (CLI + IDE) | `invoke_subagent`                          | custom agents with `subagent: true`; `define_subagent` for transient ones | `send_message` direct channel                                                                                           | 3                                                                                        | 8                                           |
| **Codex**                   | `collaboration` group, tool `spawn_agent`  | TOML in `~/.codex/agents/` or `.codex/agents/`                            | `send_message`, `followup_task`, `wait_agent`, `interrupt_agent`, `list_agents`                                         | hierarchical task paths from `/root`                                                     | session-provided concurrency limit          |
| **Cursor** (CLI + IDE)      | `Task` tool (SDK policy name `"task"`)     | —                                                                         | none documented                                                                                                         | main agent and its DIRECT subagents may spawn; a subagent's subagent may not (since 2.5) | no documented limit                         |
| **ChatGPT** (Web / API)     | function calling / `execute_subagent_task` | system / developer instructions                                           | single / multi-turn delegation                                                                                          | 2                                                                                        | 4                                           |

---

### 3.3 Native primitives worth using instead of rebuilding

Prefer a host primitive over a hand-built equivalent. Both of these already exist and the harness should
defer to them where available.

**Workspace isolation.** Antigravity's `invoke_subagent` accepts `Workspace`:
`"inherit"` (default) | `"branch"` (a new isolated workspace) | `"share"` (a new workspace over the same
repository directory, "similar to a git worktree"). Where this exists, use it for disjoint write scopes
rather than provisioning worktrees by hand.

**Resume after a crash.** Antigravity's `ReusedSubagentId` resumes work from a cancelled subagent.
Codex has no resume primitive in this host surface: send a focused `followup_task` to an existing idle
agent when it remains available; otherwise recover its harness lease and replace it with `spawn_agent`.

**Context control.** Codex's `spawn_agent` takes `fork_turns`, which decides how much parent context
propagates. A full-history fork inherits the parent's model and reasoning effort and cannot override them;
a partial fork can. Everywhere else, a subagent starts fresh and the packet is the only channel — which is
why the packet carries the round's recorded facts.

**Per-agent model and effort.** Codex's `spawn_agent` accepts `model` and `reasoning_effort` directly.
Claude Code sets them in agent frontmatter (`model:`, `effort:`), resolved as
`CLAUDE_CODE_SUBAGENT_MODEL` > per-invocation parameter > frontmatter > the session's model.
No host selects a model by task difficulty; if nothing declares one, the agent inherits.

---

### 3.4 Constraints that change how a run must be driven

**Codex gates delegation behind an explicit instruction.** By default it will not spawn subagents unless
the user, an `AGENTS.md`, or a skill asks for delegation. This skill is one of the sanctioned triggers,
so say so plainly when running there.

**Codex forbids delegating the reading of skill instructions.** The main agent must read its own
instruction and reference files; only task work may be delegated. A coordinator there routes work, not
reading.

**Codex's multi-agent support is feature-flagged.** Check rather than assume: `codex features list`
reports whether `multi_agent` is enabled; it is toggled with `--enable`/`--disable` or
`[features] multi_agent = true` in `~/.codex/config.toml`.

**Antigravity ships a caution about its own agent types**, warning that `research` and `self` subagents
may hang unless the user asked for them specifically. Treat a hung dispatch there as expected rather than
exceptional, and rely on lease expiry to detect it.

**Cursor cannot nest twice.** Branch-and-collect works one level down and no further.

---

### 3.5 Declaring capability, and degrading honestly

Before dispatching, record what this host actually supports — nesting depth, concurrency, native workspace
isolation, native resume, per-agent model selection, agent-to-agent messaging — through `agent:register`,
so the run's own evidence says which mode it ran in.

When a capability is missing, the rule is the same as everywhere else in this harness: **do not fabricate
it, and do not fail quietly.**

- No subagent mechanism at all → run single-agent, and **state in the run summary that validation was not
  independent**. A run without an independent validator is a materially weaker run, and the reader must
  learn that from the report rather than from a surprise later.
- No nesting → `branch:*` is unavailable on that host; say so instead of emitting calls that cannot work.
- No messaging → the capsule is the only channel between agents, which it already is by design.

Never emit a command the host cannot execute. A confusing failure is worse than an honest limitation.

---

### 3.6 Mechanical-First, Cognitive-Fallback Architecture

To guarantee deterministic multi-agent execution across heterogeneous hosts, Harness enforces a **Mechanical-First, Cognitive-Fallback** architecture:

1. **Mechanical Invocation (Preferred)**:
   - For every host provider, Harness leverages native direct tool/API dispatch first.
   - **Antigravity CLI/IDE**: Dispatches subagents directly via `invoke_subagent` with explicit `workspace` isolation (`"inherit"` | `"branch"` | `"share"`) and optional `reused_subagent_id` for resume.
   - **Claude Code**: Dispatches subagents directly via `Agent` tool with parameters for `name`, `prompt`, `model`, `effort`, and depth controls.
   - **Cursor CLI/IDE**: Dispatches subagents directly via `Task` tool (`policy: "task"`).
   - **Codex**: Dispatches subagents directly via `spawn_agent` in the `collaboration` group, supplying
     `task_name` and `message`, with optional `fork_turns`, `model`, and `reasoning_effort`. Codex exposes
     no batch-spawn, resume, close, or input primitive; start disjoint agents without waiting between
     dispatches and use only the documented lifecycle and messaging tools above.
   - **ChatGPT / OpenAI**: Dispatches subagents directly via structured tool/function calling payload (`chatgpt_subagent_call` / `execute_subagent_task`).

2. **Cognitive Fallback (Automatic Resilient Fallback)**:
   - If a host environment lacks native subagent tool execution or encounters tool call refusal, the CLI generates an authoritative, structured prompt.
   - This prompt forces the LLM to adopt the strict role persona, execute the subagent instructions directly, maintain strict disjoint write-scope confinement, and execute the mandatory atomic CLI registration sequence.

---

### 3.7 Mandatory CLI Action Registration Protocol

To guarantee a 100% complete, tamper-proof agent execution history in Harness memory, **all agent actions across all host environments MUST execute atomic CLI lifecycle registrations**:

1. **Step 1: Agent Registration (`agent:register`)**:
   - Before executing any task work, every subagent must be registered in the harness ledger:
   ```bash
   bun harness.ts agent:register --run <RUN> --agent <AGENT_ID> --role <ROLE> --host <HOST> [--parent-agent <PARENT>]
   ```
2. **Step 2: Task Claim & Token Acquisition (`task:claim`)**:
   - The worker must claim the task lease to secure its cryptographic bearer token and bind git baseline:
   ```bash
   bun harness.ts task:claim --run <RUN> --task <TASK_ID> --agent <AGENT_ID> --role <ROLE>
   ```
3. **Step 3: Periodic Heartbeat (`task:heartbeat`)**:
   - Long-running workers must refresh active lease deadlines:
   ```bash
   bun harness.ts task:heartbeat --run <RUN> --task <TASK_ID> --agent <AGENT_ID> --token <TOKEN>
   ```
4. **Step 4: Task Submission & Verification Evidence (`task:submit`)**:
   - Upon completing implementation and verifying scoped unit gates, worker records submission evidence:
   ```bash
   bun harness.ts task:submit --run <RUN> --task <TASK_ID> --agent <AGENT_ID> --token <TOKEN> --summary "<SUMMARY>"
   ```

---

## 4. Silent Worker Recovery & Heartbeats

1. **Heartbeat Protocol**:
   - Active workers on long-running tasks send periodic heartbeats via `bun harness.ts task:heartbeat --run <RUN> --task <id> --agent <worker-id> --token <token>`.
2. **Crash & Hang Detection**:
   - If an agent crashes or stops reporting past `lease_seconds`, the Coordinator runs:
     ```bash
     bun harness.ts recover --run <RUN> --actor coordinator
     ```
   - The runtime safely revokes the expired token, transitions the task back to `ready`, and re-dispatches it without human intervention.
3. **A silent coordinator, one tier up**: if a round's whole Tier 2 coordinator stops reporting, the
   Tier 1 orchestrator runs the same `recover`/`doctor` pair against that round's capsule and
   re-dispatches a fresh coordinator against it. It never absorbs the round's remaining work into its
   own thread while it waits.

---

## 5. Anti-Patterns & Operational Guardrails

Every host adapter implementation must enforce the following guardrails:

### 5.1 Main-Thread Execution Fallback & Parallel Batching

- **Anti-Pattern**: Coordinator or Orchestrator attempting to edit code, write fixes, or run task tests directly in the main interactive chat thread.
- **Guardrail**: Main thread acts solely as a wake-up dispatcher. Tier 2 Coordinators must dispatch Tier 3 Implementers and Validators via host-native subagent tools (`invoke_subagent` in Antigravity, `Agent` in Claude Code, `spawn_agent` in Codex). When ready tasks exist, dispatch the full wave in a single tool call array (`Subagents: [...]`) rather than serializing dispatches across turns.

### 5.2 4-Tier Multi-Viewport Resolution Matrix

- **Anti-Pattern**: Visual UI reviews testing only mobile viewports or omitting desktop-wide displays.
- **Guardrail**: Visual surfaces must be evaluated against all four classified viewports:
  - `Desktop-Wide`: 1920x1080 (16:9 widescreen layout, large data tables, multi-column navigation)
  - `Desktop`: 1440x900 (standard desktop layout, sidebars, expanded dialogs)
  - `Tablet`: 768x1024 (adaptive navigation, portrait/landscape split)
  - `Mobile`: 390x844 (stacked single-column layout, bottom sheets, >= 44x44px touch targets)
    Single-viewport reviews or omitting Desktop-Wide 1920x1080 are grounds for mandatory validation rejection.

### 5.3 Quantitative Proof Mandates & Anti-Boilerplate Verification

- **Anti-Pattern**: Validators approving tasks with superficial prose praise ("Code looks good") without live commands or DOM measurements.
- **Guardrail**: Task reviews must carry authoritative command exit codes (0), stdout snapshots, APCA lightness contrast (`Lc >= 60` body, `Lc >= 45` large text), exact bounding client rects, and screenshot files (>= 1024 bytes). Under `--require-semantic-depth`, boilerplate or unmeasured reviews are rejected.

### 5.4 Resilient Schedulers, Watchdog Protocols & Floor Loops

- **Anti-Pattern**: Schedulers terminating when hitting an idle tick or requiring human intervention between execution phases.
- **Guardrail**: Maintain continuous non-stop autonomous loops:
  - Register background cron schedules (`schedule` tool with `CronExpression="*/5 * * * *"`, systemd timers).
  - Use shell floor loop drivers (`pulse.sh`) with error isolation (`|| true`) to ensure crashed pulses do not terminate the loop.
  - Automatically chain subsequent phases upon completion without halting for user confirmation.

### 5.5 Repository Root Capsule Resolution Protocol

- **Anti-Pattern**: Writing `.capsules` into subdirectories (e.g. `scripts/.capsules`) when invoked from a nested directory.
- **Guardrail**: All harness storage MUST resolve to `<repo-root>/.olt/capsules/` at the active local Git repository root.

### 5.6 Mandatory 5-Minute Supervisory Scheduler & Live ASCII DAG Optimization

- **Anti-Pattern**: Schedulers running unmonitored without active wake intervals, or serializing parallelizable tasks due to lack of topological introspection. Coordinators editing codebase files directly instead of orchestrating.
- **Guardrail**:
  - Enforce mandatory 5-minute supervisory scheduler registration (`schedule` cron `*/5 * * * *` or timer `DurationSeconds=300`) across all multi-phase runs.
  - Use `dag` (alias: graph:ascii) to inspect live ASCII execution trees, track subagent lease occupancy, and surface algorithmic parallelization opportunities (e.g. disjoint write scopes artificially serialized).
  - Coordinators must strictly orchestrate and NEVER write, edit, or test code directly.

### 5.7 Multi-Coordinator Scaling & Algorithmic DAG Parallelization

- **Anti-Pattern**: Single coordinator bottlenecking wide multi-subsystem codebases, or artificial serial dependency chains when write scopes are disjoint.
- **Guardrail**:
  - Perform algorithmic DAG analysis (`dag`) to calculate Work vs Span ($P = \text{Work} / \text{Span}$) and detect false dependencies between disjoint scopes.
  - When $P < P_{\text{optimal}}$ and 2+ disjoint domains exist (e.g. backend, frontend, database, docs), scale out by deploying dedicated Tier 2 Domain Coordinators (`coordinator-<domain>`) to manage disjoint execution wave lanes independently.
  - Eliminate artificial serialization warnings (`ARTIFICIAL_SERIALIZATION_WARNING`) by decoupling soft dependencies into concurrent wave lanes.

### 5.8 Infinite Mind Cadence, Zero Agent-Driven Termination & Background Finalization Isolation

- **Anti-Pattern**: Subagents killing supervisory schedulers or terminating running pulse processes. Mind loops spilling final tasks (git commits, pushes, skill sync) to the main interactive thread upon pulse completion.
- **Guardrail**:
  - Mind systems and multi-phase orchestrations run as infinite, non-stop loops unless explicitly stopped by the human user.
  - Subagents and coordinators are STRICTLY FORBIDDEN from calling `manage_task kill` on background schedulers or terminating pulse processes.
  - All final repository release tasks (git commit, git push to upstream, and global skill sync via `bun scripts/sync-global.ts`) MUST be executed by the dedicated Tier 1 Background Orchestrator / Tier 0 Mind Runner on its own background thread.
  - The main interactive user thread remains purely open and supervisory.

### 5.9 Aggressive Unfulfilled-Demand Pushback & Mechanical Engine Halting

- **Anti-Pattern**: Advancing execution waves, closing pulses, or validating runs when planned actions, lanes, or tasks in Harness memory remain unfulfilled, stranded, or skipped.
- **Guardrail**:
  - If a registered action, lane, or task is planned in Harness memory (`state.tasks`, `state.topology.waves`, `state.candidates`, `state.graph.gates`) but left unfulfilled, the engine immediately halts with a harsh, blocking pushback (`[AGGRESSIVE UNFULFILLED-DEMAND PUSHBACK]`).
  - The pushback isolates the exact root cause for every stalled item (e.g. unleased task, missing submission evidence, unresolved repair findings, unproven mandatory gate, unfulfilled wave lane).
  - State advancement and phase transition are strictly refused until all unfulfilled demands are fully resolved and verified.

### 5.10 1-Shot Batch Auto-Deployment for Mind and Mind-Auditor (`/olt mind`)

- **Anti-Pattern**: Main interactive thread initializing CLI state on `/olt mind` but omitting subagent dispatch, pausing for manual user confirmation, summarizing prompts instead of injecting verbatim YAML manifests, or failing to deploy `mind-auditor` alongside `mind`.
- **Guardrail**:
  - The entrypoint on `/olt mind` MUST deploy both `mind` and `mind-auditor` in a single 1-shot batch dispatch (`invoke_subagent` with `Subagents: [...]`).
  - Because `mind` (Tier 0) cannot self-spawn `mind-auditor` (Tier 1) under `ALLOWED_TIER_SPAWNS`, Tier 0 Main Thread must dispatch both simultaneously.
  - Verbatim manifests from `agents/mind.yaml` and `agents/mind-auditor.yaml` must be injected into subagent prompts without lossy compression.
  - Register a recurring 3-minute supervisory schedule (`schedule` cron `*/3 * * * *`) and stand down main-thread tool execution.
