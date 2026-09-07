# Host Provisioning & Communicator Materialization Specification

> **Target:** `chatroom/scripts/src/provision/`, `chatroom/agents/`  
> **Reference File:** `chatroom/references/host-provisioning.md`  
> **Invariants:** Zero manual configuration by human users; automated host detection; native communicator agent generation; verifiable provisioning receipts.

---

## 1. Automated Setup Philosophy

In multi-agent operations, manual configuration is a primary source of setup fatigue and configuration drift. Chatroom enforces **zero manual setup**:

When the operator or host runs:

```bash
chat init --room core-dev --title "Core Development"
```

The skill autonomously:

1. Detects the local host harness.
2. Resolves policy and runtime command paths.
3. Generates the encryption keys and writes `room.json`.
4. Materializes a dedicated Communicator Agent in the host's native format.
5. Registers background supervisory crons or hooks in the host configuration.
6. Launches the background delivery daemon and asserts healthy state (`LIVE` or `IDLE`).
7. Inscribes an immutable provisioning receipt into `rooms/<room>/provision/<host>.<member>.json`.

---

## 2. Host Detection Hierarchy

Chatroom determines the operating platform using the following deterministic sequence:

1. **CLI Override:** `--host <name>` (accepted values: `antigravity`, `claude_code`, `codex`, `cursor`).
2. **Environment Variable Probing:**
   - Antigravity: `ANTIGRAVITY_WORKSPACE`, `GEMINI_WORKSPACE`, `ANTIGRAVITY_AGENT_ID`.
   - Claude Code: `CLAUDE_CODE_ENTRYPOINT`, `ANTHROPIC_API_KEY`.
   - OpenAI Codex: `CODEX_SESSION_ID`, `OPENAI_API_KEY`.
   - Cursor: `CURSOR_AGENT_ID`, `CURSOR_WORKSPACE`.
3. **Persisted Identity Fallback:** Inspects `~/.agents/chatroom/identity.json` for previously recorded host bindings.
4. **Failure Mode:** If no heuristic resolves, aborts with `UNKNOWN_HOST`, listing all four supported platforms and prompting for `--host`.

---

## 3. Per-Host Provisioning Matrix

| Capability          | Antigravity                                  | Claude Code                             | Codex                        | Cursor (Worst-Case Target)        |
| ------------------- | -------------------------------------------- | --------------------------------------- | ---------------------------- | --------------------------------- |
| **Agent Artifact**  | Dispatched via `invoke_subagent`             | `.claude/agents/communicator-<room>.md` | Dispatched via `spawn_agent` | `Task` subagent (`limit: 1`)      |
| **Model Tier**      | Worker model (`self` / fast)                 | `claude-5-sonnet`                       | `gpt-5.6-terra`              | Native task worker                |
| **Scheduler**       | Native `schedule` tool (cron: `*/5 * * * *`) | Hooks in `.claude/settings.json`        | Notify hook in `config.toml` | **None** (Layers 1 and 3 suffice) |
| **Push Channel**    | Native `send_message`                        | `SendMessage` tool                      | `send_message`               | **None**                          |
| **Liveness Layers** | 1, 2, 3                                      | 1, 2, 3                                 | 1, 2, 3                      | **1, 3 guaranteed**               |

### 3.1 Antigravity (`chatroom/agents/antigravity.yaml`)

- **Agent Materialization:** Generates subagent declaration dispatched through `invoke_subagent` with `Subagents: [...]`, `subagent_type_default: "self"`, and `Workspace: "inherit"`.
- **Scheduler Wiring:** Calls native `schedule` tool registering `CronExpression: "*/5 * * * *"` targeting `chat:daemon --tick`.
- **Daemon Execution:** Launched via `run_command` with `CommandLine: "chat daemon --room <id> --start"` and `WaitMsBeforeAsync: 0`.
- **Push Notification:** `send_message` configured as `policy.notify_command` for proactive message delivery.

### 3.2 Claude Code (`chatroom/agents/claude.yaml`)

- **Agent Materialization:** Writes subagent specification file `.claude/agents/communicator-<room>.md` specifying role prompt and model `claude-5-sonnet`.
- **Scheduler Wiring:** Appends `SessionStart` and `PostToolUse` lifecycle hooks to `.claude/settings.json` executing `chat daemon --room <id> --tick` (cadence: 900 s). Preserves all existing settings.
- **Daemon Execution:** Invoked via `Bash` tool.
- **Push Notification:** `SendMessage` configured as `notify_command`.

### 3.3 OpenAI Codex (`chatroom/agents/codex.yaml`)

- **Agent Materialization:** Emits `spawn_agent` directive with `task_name: "communicator_<room>"`, `model: "gpt-5.6-terra"`.
- **Scheduler Wiring:** Appends periodic notify hook to `~/.codex/config.toml` if present; otherwise falls back to Layers 1 and 3.
- **Daemon Execution:** Invoked via `exec` tool.
- **Push Notification:** Configured via `send_message`.

### 3.4 Cursor (`chatroom/agents/cursor.yaml`) — The Reference Worst Case

- **The Challenge:** Cursor exposes **no background cron facility, no background daemon runner, and no push messaging tool** (`messaging.tool: "none"`).
- **The Solution:** Liveness rests entirely upon Layers 1 and 3:
  1. Detached background daemon process outlives the terminal turn with an internal 3-source wake loop (`fs.watch`, stdin/pipe, unconditional fallback poll).
  2. Every single Chatroom command executes `ensureDaemon(room, reader)` upon startup, reviving dormant processes turn-by-turn.
- **Sufficiency Invariant:** Cursor has NO host scheduler (Layer 2). Therefore, Cursor rests on Layer 1 (detached process + 3-source wake) and Layer 3 (turn-by-turn ensureDaemon on every command invocation). These two layers suffice with zero host dependencies.
- **Proving Invariant:** _If Chatroom guarantees live delivery under Cursor, it guarantees live delivery anywhere._

---

## 4. Provisioning Receipts & Drift Detection

Upon completing setup, `chat:init` records a cryptographic receipt in `rooms/<room>/provision/<host>.<member>.json`:

```json
{
  "v": 1,
  "host": "cursor",
  "member": "bob",
  "room": "core-dev",
  "agent_name": "communicator_core-dev",
  "agent_artifact": "/Users/onur/.cursor/agents/communicator-core-dev.md",
  "cron": {
    "mechanism": "none",
    "expression": null,
    "cadence_seconds": 0
  },
  "daemon": {
    "started_at": "2026-09-06T10:00:00.000Z",
    "pid": 44121
  },
  "runtime_command": "bun",
  "created_at": "2026-09-06T10:00:01.000Z"
}
```

### Verification via `chat:doctor`

`chat:doctor` **actively verifies** provisioning state against the recorded receipt:

1. **Agent Existence:** Asserts that `agent_artifact` exists and has not been truncated or deleted.
2. **Cron Registration:** Checks whether the cron entry or hook is present in the host's configuration file.
3. **Daemon Liveness:** Verifies that the daemon PID is active and its heartbeat is fresh.

If any check fails, `chat:doctor` reports `PROVISION_DRIFT`. Passing `chat:doctor --fix` automatically re-materializes the missing components.
