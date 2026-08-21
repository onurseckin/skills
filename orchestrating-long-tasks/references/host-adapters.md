# Host adapters — how each application dispatches and coordinates agents

The harness never calls a language model. Every agent is spawned by the host application you are running
inside, using that application's own mechanism, under your own subscription. This file is what a
coordinator reads to know which mechanism it has and what that host can actually do.

**A vendor tool name is a value, never a rule.** The rules below are stated against the abstract contract;
the tool names live in the adapter table.

## 1. Two-Tier Agent Architecture

All supported host environments must enforce the **Two-Tier Isolation Model**:

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
└──────────────┬───────────────┬───────────────┬──────────────┘
               │               │               │ Spawns in background
               ▼               ▼               ▼
        ┌─────────────┐ ┌─────────────┐ ┌─────────────┐
        │   Tier 3:   │ │   Tier 3:   │ │   Tier 3:   │
        │  Worker A   │ │  Worker B   │ │  Validator  │
        └─────────────┘ └─────────────┘ └─────────────┘
```

1. **Tier 1 (Main Interactive Thread)**:
   - Remains 100% responsive for user chat.
   - Spawns **exactly one** background coordinator agent.
   - Never directly executes implementer tool loops or polls state.
2. **Tier 2 (Background Run Coordinator)**:
   - Owns `.capsules/<run_id>/` execution lifecycle.
   - Equipped with subagent tools (`enable_subagent_tools: true` or native team lead capabilities).
   - Coordinates execution waves and routes findings to workers.
3. **Tier 3 (Worker & Validator Subagents)**:
   - Ephemeral task executors assigned to a single disjoint `write_scope`.
   - Report exclusively to the Background Run Coordinator in the background tree.

---

## 2. Milestone-Only Notification Protocol

To keep the user's interactive thread pristine, the Background Run Coordinator communicates with the Tier 1 parent **only at major lifecycle milestones**:

| Milestone Event                  | Notification Sent to User? | Content Delivered                                                   |
| :------------------------------- | :------------------------- | :------------------------------------------------------------------ |
| **Plan Compiled**                | ✅ Yes                     | Brief summary of total tasks, execution waves, and write scopes.    |
| **Wave Completed**               | ✅ Yes                     | Confirmation of completed wave tasks and entry into validation.     |
| **Escalation / Decision Needed** | ✅ Yes                     | Finding details if a task exhausts configured repair rounds.        |
| **Step / Tool-Call Noise**       | ❌ No (Suppressed)         | Internal test runs, file edits, and heartbeats stay in background.  |
| **Run Complete**                 | ✅ Yes                     | Final completeness sign-off, diff summary, and verification report. |

---

## 3. Host Adapters

### 3.1 The abstract contract

Whatever the host, a coordinator needs five things. If a host cannot provide one, that is a capability
gap to be declared, not worked around silently.

| Need           | What it means                                                |
| :------------- | :----------------------------------------------------------- |
| **Dispatch**   | Start an agent with a role, a scope, and a packet            |
| **Identity**   | Learn the agent's id, so `agent:register` can bind the grant |
| **Completion** | Know when it finished and what it returned                   |
| **Isolation**  | Keep concurrent agents from colliding on the same files      |
| **Recovery**   | Resume or replace an agent that died mid-task                |

---

### 3.2 Adapter table

| Host                        | Dispatch                                                   | Definitions                                                               | Messaging                                                                                                                    | Depth                                                                                    | Concurrency                                                           |
| :-------------------------- | :--------------------------------------------------------- | :------------------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------- | :--------------------------------------------------------------------------------------- | :-------------------------------------------------------------------- |
| **Claude Code**             | `Agent` tool                                               | `.claude/agents/*.md` (YAML frontmatter)                                  | `SendMessage` (v2.1.206+); experimental Agent Teams use file mailboxes at `~/.claude/teams/<team>/inboxes/<agent>.json`      | 3 (`CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH`)                                               | 20 (`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS`)                           |
| **Antigravity** (CLI + IDE) | `invoke_subagent`                                          | custom agents with `subagent: true`; `define_subagent` for transient ones | none documented                                                                                                              | not documented                                                                           | not documented                                                        |
| **Codex**                   | `collaboration` group `multi_agent_v1`, tool `spawn_agent` | TOML in `~/.codex/agents/` or `.codex/agents/`                            | `send_message`, `followup_task`, `send_input`, `wait_agent`, `interrupt_agent`, `list_agents`, `resume_agent`, `close_agent` | hierarchical task paths from `/root`                                                     | `agents.max_concurrent_threads_per_session` in `~/.codex/config.toml` |
| **Cursor** (CLI + IDE)      | `Task` tool (SDK policy name `"task"`)                     | —                                                                         | none documented                                                                                                              | main agent and its DIRECT subagents may spawn; a subagent's subagent may not (since 2.5) | no documented limit                                                   |

---

### 3.3 Native primitives worth using instead of rebuilding

Prefer a host primitive over a hand-built equivalent. Both of these already exist and the harness should
defer to them where available.

**Workspace isolation.** Antigravity's `invoke_subagent` accepts `Workspace`:
`"inherit"` (default) | `"branch"` (a new isolated workspace) | `"share"` (a new workspace over the same
repository directory, "similar to a git worktree"). Where this exists, use it for disjoint write scopes
rather than provisioning worktrees by hand.

**Resume after a crash.** Antigravity's `ReusedSubagentId` resumes work from a cancelled subagent; Codex
has `resume_agent`. Where either exists, a supervisor should resume before it replaces.

**Context control.** Codex's `spawn_agent` takes `fork_turns` / `fork_context`, which decide how much
parent context propagates. A full-history fork inherits the parent's model and reasoning effort and
cannot override them; a partial fork can. Everywhere else, a subagent starts fresh and the packet is the
only channel — which is why the packet carries the round's recorded facts.

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

## 4. Silent Worker Recovery & Heartbeats

1. **Heartbeat Protocol**:
   - Active workers on long-running tasks send periodic heartbeats via `bun harness.ts task:heartbeat --run <RUN> --task <id> --agent <worker-id> --token <token>`.
2. **Crash & Hang Detection**:
   - If an agent crashes or stops reporting past `lease_seconds`, the Coordinator runs:
     ```bash
     bun harness.ts recover --run <RUN> --actor coordinator
     ```
   - The runtime safely revokes the expired token, transitions the task back to `ready`, and re-dispatches it without human intervention.
