# 01. Host-Agnostic Architecture & Adapters

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Role Contracts & Task Execution Briefs ➡](./02-immutable-role-packets.md)

---

## 🧭 Executive Overview & Architectural Purpose

In modern software engineering with large language models (LLMs), a fatal architectural mistake is coupling orchestration logic directly to specific vendor APIs (e.g., OpenAI, Anthropic, Google) or hardcoding platform-dependent CLI subshell invocations (such as calling `claude`, `codex`, or `gemini` from within python or bash scripts).

Coupled architectures suffer from four systemic vulnerabilities:

1. **Credential Exposure:** Secret API keys and bearer tokens are baked into filesystem scripts, environment dumps, or temporary artifacts.
2. **Platform Lock-In & Cost Inflexibility:** Workflows cannot seamlessly transition between enterprise cloud environments, local air-gapped models, and specialized coding assistants without extensive rewrites.
3. **Process Shadowing & Context runaway:** When the harness directly spawns AI processes, the host developer environment loses native visibility into subagent lifecycles, memory boundaries, and token consumption metrics.
4. **Context Churn & Token Exhaustion:** Unanchored subagents spend hundreds of thousands of tokens running exploratory commands (`find`, `grep`, `ls`, `git status`) merely to understand where they are and what they are supposed to do.

`olt` solves these failure modes by enforcing a **100% Host-Agnostic, Zero-JSON Colon CLI Architecture**. The harness never makes HTTP calls to AI providers, never invokes LLM SDKs, and never starts unshielded shell processes. Instead, the harness acts as a deterministic state machine and cryptographic verification ledger on disk. Host developer tools (Google Antigravity, Claude Code, OpenAI Codex, ChatGPT, OpenCode, Cursor, Gemini, or custom IDEs) use their native subagent dispatching mechanisms to execute tasks, interacting with the harness exclusively through compact, deterministic CLI commands.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                             HOST-AGNOSTIC MULTI-AGENT TOPOLOGY                                   │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  HOST RUNTIME ENVIRONMENT (Google Antigravity / Claude Code / Codex / ChatGPT / Cursor / OpenCode)│
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ Native Subagent Dispatcher (invoke_subagent, Agent tool, native threads, IDE workers)      │  │
│  └─────────────────────────────────────────┬──────────────────────────────────────────────────┘  │
│                                            │ Invokes CLI Commands                                │
│                                            ▼                                                     │
│  OLT DETERMINISTIC HARNESS RUNTIME (bun harness.ts <command>)                                     │
│  ┌────────────────────────────────────────────────────────────────────────────────────────────┐  │
│  │ • Zero-JSON Colon CLI Interface (plan:compile, queue:pop, task:claim, task:submit, etc.)   │  │
│  │ • POSIX flock & atomic fdatasync transactional ledger (state.json & events.jsonl)          │  │
│  │ • Hybrid RBAC Deny-List Engine & Shielded Shell Gate (bun harness.ts shell)                │  │
│  │ • Dual-Time Monotonic Logical & Physical Telemetry Probes                                  │  │
│  │ • Zero-Exploration Exact-Anchor Briefing Engine (task:brief, agent:brief)                  │  │
│  └────────────────────────────────────────────────────────────────────────────────────────────┘  │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 🏛️ The 4-Tier Hierarchical Agent Model

To guarantee conversational responsiveness for human developers while enabling deep autonomous parallel execution, the harness organizes agents into a strict **4-Tier Hierarchical Supervision Model**. Cross-tier boundary skips (e.g., Tier 0 attempting to dispatch a Tier 3 worker directly) are strictly forbidden and rejected at dispatch.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               THE 4-TIER HIERARCHICAL AGENT MODEL                                │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ Tier 0: Infinite Mind (Product Owner) ]                                                       │
│    ├── Strategic intent decomposition & requirement intake                                       │
│    ├── Enforces Atomic Admission-to-Dispatch chaining (ZERO paused admitted items)              │
│    └── Dispatches strictly: Tier 1 Orchestrator                                                  │
│                        │                                                                         │
│                        ▼                                                                         │
│  [ Tier 1: Interactive Run Orchestrator ]                                                        │
│    ├── Interactive user dialog, progress telemetry, milestone sign-offs                          │
│    ├── Capsule governance & whole-run completion lifecycle                                       │
│    └── Dispatches strictly: Tier 2 Background Run Coordinators                                   │
│                        │                                                                         │
│                        ▼                                                                         │
│  [ Tier 2: Background Run Coordinator & Meta-Auditor ]                                           │
│    ├── Owns capsule state graph: plan:init, plan:add, plan:compile, queue:wave, run:complete     │
│    ├── Manages concurrency ceilings and worker lease lifecycles                                  │
│    ├── Meta-Auditor: Real-time invariant watchdog & dynamic role boundary auditor                │
│    └── Dispatches strictly: Tier 3 Ephemeral Subagents                                           │
│                        │                                                                         │
│                        ▼                                                                         │
│  [ Tier 3: Ephemeral Workers, Validators & Critics ]                                             │
│    ├── Implementer: Leased disjoint write scopes, targeted unit test execution, task:submit     │
│    ├── Cognitive Validator: Hard-locked out of shell execution (0 commands), Socratic diff audit │
│    ├── Completeness Critic: Whole-run prompt verification & requirement satisfaction review      │
│    └── Repairer: Targeted defect resolution for changes_requested findings                       │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Tier Responsibilities and Boundaries

| Tier       | Canonical Role                | Scope of Authority                                                               | Permitted Spawns                                              | Forbidden Actions                                                                 |
| :--------- | :---------------------------- | :------------------------------------------------------------------------------- | :------------------------------------------------------------ | :-------------------------------------------------------------------------------- |
| **Tier 0** | `mind`                        | Strategic roadmap, prompt admission, product ownership.                          | `orchestrator`                                                | Direct file writes, executing tests, spawning Tier 2/3 agents directly.           |
| **Tier 1** | `orchestrator`                | Human-in-the-loop chat, milestone reporting, high-level run execution.           | `coordinator`                                                 | Modifying repository code, running full test suites, direct worker dispatch.      |
| **Tier 2** | `coordinator`, `meta-auditor` | Capsule graph compilation, task queuing, lease recovery, telemetry auditing.     | `implementer`, `validator`, `completeness-critic`, `repairer` | Editing repository files, self-validating tasks, modifying plan during execution. |
| **Tier 3** | `implementer`, `repairer`     | File modifications confined strictly within leased disjoint write scopes.        | None (Leaf worker)                                            | Full-suite test runs (`bun test`), git commits/pushes, validating own work.       |
| **Tier 3** | `validator` (Cognitive)       | Pure logic auditing, diff inspection, invariant verification, Socratic critique. | None (Leaf worker)                                            | **0 commands allowed** (no `run:exec`, no bash, no builds, no test runners).      |
| **Tier 3** | `completeness-critic`         | End-to-end prompt compliance verification, final sign-off audit.                 | None (Leaf worker)                                            | Modifying repository files, executing arbitrary test scripts.                     |

---

## 🔌 Supported Host Environments & Native Adapters

The harness runtime (`bun olt/scripts/harness.ts`) is designed to run identically across every major AI development platform without custom host-specific code in the core engine. Each host environment maps its native agent tools to the harness CLI.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                    HOST ADAPTER INTEGRATIONS                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  Google Antigravity            Claude Code                  OpenAI Codex / ChatGPT               │
│  ┌───────────────────────┐     ┌──────────────────────┐     ┌──────────────────────┐             │
│  │ native subagents      │     │ native Agent tool    │     │ native worker thread │             │
│  │ send_message          │     │ File mailbox channel │     │ multi-turn chat      │             │
│  │ ~/.gemini/antigravity │     │ .claude/skills/olt   │     │ .agents/skills/olt   │             │
│  └───────────┬───────────┘     └──────────┬───────────┘     └──────────┬───────────┘             │
│              │                            │                            │                         │
│              └────────────────────────────┼────────────────────────────┘                         │
│                                           │                                                      │
│  OpenCode / Cursor / Custom IDE           │                                                      │
│  ┌───────────────────────┐                │                                                      │
│  │ Background terminal   │                │                                                      │
│  │ Workspace extension   │────────────────┘                                                      │
│  │ .olt/skills           │                                                                       │
│  └───────────────────────┘                                                                       │
│                                           │ (Deterministic CLI Execution)                        │
│                                           ▼                                                      │
│                        ┌─────────────────────────────────────┐                                   │
│                        │       PINNED HARNESS RUNTIME        │                                   │
│                        │       olt/scripts/harness.ts        │                                   │
│                        └─────────────────────────────────────┘                                   │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Google Antigravity

- **Skill Location:** Global discovery at `~/.gemini/antigravity-cli/skills/olt` or project `.gemini/skills/olt`.
- **Dispatch Mechanism:** Tier 1 Orchestrator / Tier 2 Coordinator dispatches workers via native `invoke_subagent` and streams bidirectional updates with `send_message`.
- **Telemetry Integration:** Host session JSON logs and tool invocation events are automatically ingested into the grant ledger.

### 2. Anthropic Claude Code

- **Skill Location:** Discovered at `.claude/skills/olt` or `~/.claude/skills/olt`.
- **Dispatch Mechanism:** Dispatches subagents using the native `Agent` tool. Inter-agent communication is coordinated via `SendMessage` and the experimental file-mailbox channel.
- **Lease Handling:** The Claude Code lead agent acts as Tier 2 Coordinator, issuing `task:claim --role implementer` and assigning disjoint file scopes to child worker agents.

### 3. OpenAI Codex & ChatGPT Coding Agents

- **Skill Location:** Discovered at `.agents/skills/olt` or project root `.agents/skills`.
- **Dispatch Mechanism:** Uses native subagent collaboration channels and multi-threaded worker dispatch to execute task briefs and return structured evidence.
- **Concurrency Control:** Reads host-published concurrency parameters (such as `max_concurrent_threads_per_session`) to establish reasoning capacity ceilings.

### 4. OpenCode, Cursor, & Custom LLM Hosts

- **Skill Location:** Discovered via `.cursor/rules`, `.opencode/skills`, or repo-level `olt/SKILL.md`.
- **Dispatch Mechanism:** Executes CLI commands directly in isolated subshells or terminal workers.
- **Zero-Dependency Guarantee:** Because the harness runs on Bun/Node with zero external npm dependencies, any host capable of spawning a process can fully drive the system.

---

## ⚡ Token Economy & Zero-Exploration Exact-Anchor Briefings

A primary driver of latency, high API costs, and context runaway in autonomous agent systems is **exploratory context churn**. When an agent is spawned with a vague prompt (e.g. _"Fix the auth bug"_), it predictably executes 10–20 exploratory shell commands (`ls -la`, `grep -rn "auth" .`, `git status`, `cat package.json`) consuming 40,000 to 100,000 tokens before writing a single line of functional code.

`olt` eliminates exploratory churn through **Zero-Exploration Exact-Anchor Briefings** generated via `task:brief` and `agent:brief`.

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         ZERO-EXPLORATION CONTEXT BRIEFING PIPELINE                               │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ NAIVE EXPLORATORY PATTERN (Anti-Pattern) ]                                                    │
│    Agent Spawns ──► `ls -R` ──► `grep auth` ──► `cat file1` ──► `cat file2` ──► 80k tokens wasted│
│                                                                                                  │
│  [ OLT EXACT-ANCHOR BRIEFING PATTERN (Turn 1 Execution) ]                                        │
│    Coordinator calls `task:brief --task task-42 --agent worker-1`                                │
│    ┌────────────────────────────────────────────────────────────────────────────────────────┐    │
│    │ Emits Compact (≤ 30 lines) Exact Markdown Brief directly to stdout:                   │    │
│    │  • Exact Disjoint Write Scope (`src/auth/jwt.ts`, `tests/auth/jwt.test.ts`)            │    │
│    │  • Isolated Worktree Location (`.worktrees/task-42`)                                   │    │
│    │  • Suggested Target Files & Pre-Authorized Recommended Commands                        │    │
│    │  • Mandatory Gate Commands & Acceptance Criteria                                       │    │
│    │  • Step-by-Step CLI Next Actions                                                       │    │
│    └────────────────────────────────────────────────────────────────────────────────────────┘    │
│                                  │                                                               │
│                                  ▼                                                               │
│    Worker Agent Begins Turn 1 Code Edits Immediately with Zero Exploratory Overhead             │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Concrete Briefing Walkthrough

When a coordinator or host prepares to dispatch a worker, it runs:

```bash
bun harness.ts task:brief --run .olt/capsules/<run-id> --task task-auth --agent worker-1 --role implementer
```

The harness generates and prints a structured, token-optimized briefing:

```markdown
### 🌌 Zero-Exploration Briefing: task-auth

- **Label**: Implement JWT Authentication & Token Revocation
- **Assignment**: Role: `implementer` · Agent: `worker-1`
- **Assigned Write Scope**: `src/auth/jwt.ts`, `tests/auth/jwt.test.ts`
- **Isolated Worktree**: `.worktrees/task-auth`
- **Suggested Target Files**: `src/auth/jwt.ts`, `tests/auth/jwt.test.ts`
- **Recommended Commands**:
  - `bun test tests/auth/jwt.test.ts`
- **Gate Commands**:
  - `bun test tests/auth/jwt.test.ts`
  - `bun harness.ts task:check --task task-auth`
- **Acceptance Criteria**:
  - Passes JWT verification and expiration test suite.
  - Requirement `REQ-AUTH-01`: Token revocation blacklist handled in memory.
    ⚡ Next Actions:

1. `bun harness.ts task:claim --run .olt/capsules/<run-id> --task task-auth --agent worker-1 --role implementer`
```

### Context Compaction Invariants

1. **Compact Output (≤ 30 lines):** Briefs are constrained to concise markdown to avoid pushing earlier task requirements out of the LLM's active attention window.
2. **Exact Paths & Line Numbers:** The briefing provides explicit file paths, eliminating guesswork.
3. **Structured JSON Mode:** Automated scripts can supply `--format json` (placed before any `--` argument) to receive machine-readable payloads for custom tooling.

---

## 📡 Dual-Time Monotonic Telemetry & Host Probes

Multi-agent coordination across asynchronous processes cannot rely exclusively on physical system clocks due to distributed clock skew, NTP adjustments, and sub-millisecond race conditions. `olt` records all telemetry events across two independent, orthogonal time domains:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                DUAL-TIME TELEMETRY ARCHITECTURE                                  │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Monotonic Logical Time (sequence: 1, 2, 3, ...):                                             │
│     • Strictly increasing integer counter stored in events.jsonl                                 │
│     • Guarantees total Lamport causal ordering across all concurrent subagent events             │
│     • Completely immune to NTP jumps, clock skew, and multi-host drift                           │
│                                                                                                  │
│  2. Physical Wall-Clock Time (timestamp: "2026-08-23T03:00:00.000Z"):                            │
│     • High-resolution ISO 8601 UTC timestamp per event                                          │
│     • Evaluates lease expiration deadlines, SLA heartbeats, and real execution duration          │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Telemetry Evidence Classes: What Was Reported vs. What Was Measured

Every field on an agent grant record carries an immutable evidence class recording _how the harness came to know it_:

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 TELEMETRY EVIDENCE HIERARCHY                                     │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  [ agent_reported ] (Unverified Claim)                                                           │
│    └── Declared via CLI flags (e.g. `agent:register --model gpt-4o --tokens-out 500`)           │
│    └── Treated as an unverified self-claim until corroborated by host telemetry                  │
│                                                                                                  │
│  [ host_reported / derived / harness_observed ] (Verified Ground Truth)                          │
│    └── Discovered via Host Telemetry Probes (`readAgentTranscriptTelemetry`)                     │
│    └── Read directly from host session transcripts, IDE process streams, and OS exit codes       │
│    └── Earned ONLY by automated observation, NEVER by agent self-reporting                       │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Conflict Detection & `telemetry_conflicts` Resolution

When a probed host observation disagrees with an agent's self-reported claim (for example, an agent claims `model: gpt-4o` with `500` tokens, but host transcript probing discovers `claude-3-7-sonnet` with `4,200` tokens consumed), the harness **never silently overwrites** either record.

Instead, the harness preserves both:

1. The explicit `agent_reported` value remains on the grant field.
2. An immutable entry is appended to the `telemetry_conflicts` ledger on the grant record:

```json
{
  "field": "tokens_out",
  "recorded_value": 500,
  "recorded_evidence_class": "agent_reported",
  "probed_value": 4200,
  "probed_evidence_class": "harness_observed"
}
```

3. **Parent Lineage Conflict Protection:** If an agent claims parentage (`checkParentAgentConflict`) that contradicts host transcript data, a conflict record is opened and supervisory alerts are emitted to prevent rogue lineage spoofing.

---

## 🩺 Autonomous Supervision & Failure Classification

While a human developer or lead coordinator can manually dispatch tasks one by one, `orchestrator:supervise` provides an autonomous supervision loop. It performs an atomic reclaim-classify-dispatch cycle over the run's eligible set:

```bash
bun harness.ts orchestrator:supervise --run .olt/capsules/<run-id> --actor coordinator
```

```text
┌──────────────────────────────────────────────────────────────────────────────────────────────────┐
│                               AUTONOMOUS SUPERVISION CYCLE                                       │
├──────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                  │
│  1. Reclaim Stale Leases                                                                         │
│     └── Identifies workers whose leases expired with no heartbeats; reclaims tasks to retry_ready│
│                                  │                                                               │
│                                  ▼                                                               │
│  2. Classify Failures (Transient vs. Deterministic)                                              │
│     ├── Transient: rate_limit, network, provider_5xx, timeout (retried within 4-hour window)     │
│     ├── Crash: Transient but capped at max 3 consecutive identical failures                      │
│     └── Deterministic: gate failure, RBAC rejection, invalid scope (escalated to human)         │
│                                  │                                                               │
│                                  ▼                                                               │
│  3. Calculate Dispatchable Waves                                                                 │
│     └── Queries topological dependency graph, respects reasoning & gate concurrency ceilings     │
│                                                                                                  │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘
```

### Dual Concurrency Ceilings: Reasoning vs. CPU Gates

The supervisor enforces two distinct, independent concurrency limits:

- **`--max-parallel` (Reasoning Ceiling):** Discovered from host limits (e.g. `max_concurrent_threads_per_session`) or configured in `harness.config.json`. Governs how many reasoning subagents may be active simultaneously.
- **`--gate-max-parallel` (Gate Execution Ceiling):** Derived from local CPU core count (`navigator.hardwareConcurrency`). Governs how many CPU-heavy build and test commands may execute concurrently to prevent system thrashing and test timeout flakes.

---

## 🔀 Sequential Fallback Mode (Single-Agent Environments)

When executing in environments where subagent concurrency is unavailable (e.g., standard single-agent terminal sessions), the harness automatically activates **Sequential Execution Mode**:

1. **Strict Context Reset:** When transitioning between the **Implementer** role and the **Validator** role, the agent must perform a complete context reset (wiping conversational working memory) to prevent self-grading bias.
2. **Distinct Agent ID Requirement:** `task:validate-start` strictly refuses a validator whose agent ID appears in the task's implementation attempts or who previously validated the task in an earlier round.
3. **Refusal Over Contamination:** If role independence cannot be guaranteed in the current session, validation remains blocked rather than permitting unverified self-approval.

---

## 📚 Diátaxis Reference: Host CLI Capabilities

| Capability Category | Command / Flag                                  | Purpose                                        | Host Supported |
| :------------------ | :---------------------------------------------- | :--------------------------------------------- | :------------- |
| **Registration**    | `agent:register --role <role> --host <host>`    | Registers agent grant in immutable ledger.     | All            |
| **Briefing**        | `task:brief --task <id>`                        | Emits zero-exploration markdown brief.         | All            |
| **Supervision**     | `orchestrator:supervise --run <path>`           | Runs single-pass autonomous supervision.       | All            |
| **Telemetry**       | `agent:report --tokens-in <N> --tokens-out <N>` | Records self-reported agent telemetry.         | All            |
| **Shell Interlock** | `shell --actor <id> -- <argv>`                  | Executes direct command under RBAC shield.     | All            |
| **Read Expansion**  | `scope:expand --actor <id> --read <path>`       | Dynamically expands allowed read neighborhood. | All            |

---

[⬅ Previous: Plan Revision & Freezing](../03-graph-scheduler/03-plan-revision-and-freezing.md) | [Master Table of Contents](../README.md) | [Next: Role Contracts & Task Execution Briefs ➡](./02-immutable-role-packets.md)
