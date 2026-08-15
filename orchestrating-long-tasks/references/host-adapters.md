# Host Adapters Specification

The harness never creates LLM agents or calls model APIs itself. It exposes a deterministic state machine and CLI API; the host application dispatches native agents and consumes their structured evidence.

---

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

| Milestone Event | Notification Sent to User? | Content Delivered |
| :--- | :--- | :--- |
| **Plan Compiled** | ✅ Yes | Brief summary of total tasks, execution waves, and write scopes. |
| **Wave Completed** | ✅ Yes | Confirmation of completed wave tasks and entry into validation. |
| **Escalation / Decision Needed** | ✅ Yes | Finding details if a task exhausts configured repair rounds. |
| **Step / Tool-Call Noise** | ❌ No (Suppressed) | Internal test runs, file edits, and heartbeats stay in background. |
| **Run Complete** | ✅ Yes | Final completeness sign-off, diff summary, and verification report. |

---

## 3. Host-Specific Adapter Implementations

### A. Google Antigravity (AGY / Antigravity CLI)
- **Discovery**: Global link at `~/.gemini/config/skills/orchestrating-long-tasks` or canonical `.agents/skills/orchestrating-long-tasks`.
- **Coordinator Spawning**:
  The main assistant calls `invoke_subagent` once to launch the Coordinator:
  ```json
  {
    "Subagents": [{
      "Role": "Run Coordinator",
      "TypeName": "self",
      "Prompt": "Orchestrate run <RUN_ID> using bun harness.ts commands."
    }]
  }
  ```
- **Wave Dispatch**: The Coordinator calls `invoke_subagent` with multiple worker specs in a single call to launch concurrent lanes.
- **Direct Messaging (`send_message`)**: Workers send completion messages to their parent Coordinator ID.

### B. Anthropic Claude Code
- **Discovery**: `.claude/skills/orchestrating-long-tasks` or `~/.claude/skills/orchestrating-long-tasks`.
- **Agent Teams & Teammates**:
  - The Lead Agent acts as the Tier 2 Coordinator, initializing the capsule and planning the graph.
  - Teammates claim ready tasks from `bun harness.ts queue:next` using their assigned write scope.
  - Claude hooks may trigger `bun harness.ts task:heartbeat`, but hook output is never authoritative state.

### C. OpenAI Codex & ChatGPT Coding Agents
- **Discovery**: `.agents/skills/orchestrating-long-tasks` or `~/.agents/skills/orchestrating-long-tasks`.
- **Worker Isolation**: Give each subagent its focused role packet path (`.capsules/<run>/packets/<task>/packet.md`), exclusive write scope, and gate command.
- **State Advancement**: The Coordinator alone advances durable state using the Harness CLI.

---

## 4. Silent Worker Recovery & Heartbeats

1. **Heartbeat Protocol**:
   - Active workers on long-running tasks send periodic heartbeats via `bun harness.ts task:heartbeat --task <id> --token <token>`.
2. **Crash & Hang Detection**:
   - If an agent crashes or stops reporting past `lease_seconds`, the Coordinator runs:
     ```bash
     bun harness.ts recover --run <RUN> --actor coordinator
     ```
   - The runtime safely revokes the expired token, transitions the task back to `ready`, and re-dispatches it without human intervention.
