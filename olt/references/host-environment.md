# Host Environment Contract — Native Tooling, Platform Separation & System Invariants

## 1. Executive Summary & Architectural Separation

The Operation Loop Topology (OLT) architecture enforces a strict, formal boundary between the **Host Execution Platform** (the runtime environment hosting the language models and tools) and the **OLT Harness Protocol** (the deterministic orchestration engine).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           Host Execution Platform                           │
│     (Google Antigravity, Claude Code, OpenAI Codex, Cursor, Windsurf)       │
│                                                                             │
│  Native Primitives:                                                         │
│  - Filesystem I/O (`view_file`, `replace_file_content`, `write_to_file`, …) │
│  - Process Execution (`run_command`, `manage_task`)                         │
│  - Reactive Scheduler (`schedule`)                                          │
│  - Subagent Lifecycle (`define_subagent`, `invoke_subagent`, `send_message`)│
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │ Drives via Tool Calls & CLI
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           OLT Harness Protocol                              │
│              (`bun ~/.agents/skills/olt/scripts/harness.ts`)                │
│                                                                             │
│  Deterministic State Machine:                                               │
│  - POSIX Inode Locking (`flock`) & Append-Only Event Stream (`events.ndjson`)│
│  - SHA-256 Tamper-Proof Prompt & File Integrity Hashes                      │
│  - Bearer Token Leases & Disjoint Write-Scope Enforcements                  │
│  - Dependency DAG Scheduling, Wave Barriers & Gate Verifications            │
│  - Zero `any` & Zero Suppressions Quality Enforcement                       │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 The Host Platform Layer

The host platform provides low-level execution primitives: spawning language model subagents, executing system shell commands, reading and editing filesystem buffers, scheduling timers, and routing messages. The host runtime is stateless regarding OLT capsule semantics; it possesses no built-in knowledge of tasks, wave barriers, leases, or repair cycles.

### 1.2 The OLT Harness Protocol Layer

The OLT harness CLI (`bun ~/.agents/skills/olt/scripts/harness.ts`) is the authoritative source of truth for execution state. It enforces mathematical invariants: immutable prompt capture, dependency DAG execution, topological wave scheduling, atomic write-scope confinement, bearer token verification, cryptographic event hashing, and mechanical completion gating. The harness never spawns LLMs or invokes host tools directly—it is driven by agents invoking CLI commands.

### 1.3 The Separation Boundary Matrix

| Capability / Concern     | Host Platform Responsibility                                                | OLT Harness Protocol Responsibility                             |
| :----------------------- | :-------------------------------------------------------------------------- | :-------------------------------------------------------------- |
| **Agent Dispatch**       | Spawns Antigravity agent contexts via `invoke_subagent` or host equivalent. | Issues cryptographic lease tokens via `task:claim`.             |
| **State Tracking**       | Delivers inter-agent messages and process status.                           | Maintains tamper-proof `events.ndjson` and state projections.   |
| **File Mutation**        | Executes granular file edits via `replace_file_content` / `write_to_file`.  | Validates mutations strictly within leased `write_scope`.       |
| **Command Execution**    | Runs commands in subshells via `run_command`.                               | Tracks command exit codes and enforces shell interlocks.        |
| **Concurrency**          | Manages OS-level parallel subagent execution.                               | Enforces disjoint write-scope isolation across tasks in a wave. |
| **Verification & Gates** | Runs test runners and linters on host environment.                          | Mechanically checks gate criteria before advancing states.      |

---

## 2. Native Host Tools Catalog

Every agent operating within the OLT ecosystem interacts with the environment through standardized native host tools. Below are the canonical specifications, operational behaviors, parameter constraints, and invariants for all host tools.

### 2.1 Filesystem Tools

#### `view_file`

Reads contents of a file on the local filesystem.

- **Parameters**:
  - `AbsolutePath` (_string_, required): Full path to target file.
  - `StartLine` (_integer_, optional): 1-indexed start line (inclusive).
  - `EndLine` (_integer_, optional): 1-indexed end line (inclusive).
  - `ContentOffset` (_integer_, optional): Byte offset for reading truncated files.
- **Operational Rules**:
  - Window size limit: At most 800 lines can be viewed in a single call.
  - Byte limit: Content truncated at 46,080 bytes (use `ContentOffset` to paginate).
  - Binary files (images, PDFs, video, audio) must be viewed without `StartLine` or `EndLine`.

#### `replace_file_content`

Performs surgical, contiguous block replacement within an existing file.

- **Parameters**:
  - `TargetFile` (_string_, required): Absolute path to file.
  - `StartLine` (_integer_, required): Starting line number of replacement chunk (1-indexed).
  - `EndLine` (_integer_, required): Ending line number of replacement chunk (1-indexed).
  - `TargetContent` (_string_, required): Exact string matching the file contents, preserving exact whitespace and indentation.
  - `ReplacementContent` (_string_, required): New string to replace `TargetContent`.
  - `AllowMultiple` (_boolean_, required): Set to `false` for surgical single-block edits.
  - `Instruction` (_string_, required): Description of change.
  - `Description` (_string_, required): User-facing rationale.
- **Operational Invariants**:
  - MUST make single contiguous edits. To edit multiple non-adjacent locations, make separate sequential tool calls.
  - NEVER attempt to replace entire large files with `replace_file_content`.

#### `write_to_file`

Creates a new file or overwrites an existing file entirely.

- **Parameters**:
  - `TargetFile` (_string_, required): Absolute path to create or overwrite.
  - `CodeContent` (_string_, required): Complete text content to write.
  - `Overwrite` (_boolean_, required): Must be `true` if file already exists; `false` creates new only.
  - `ArtifactMetadata` (_object_, optional for repo code, required for artifacts in `<appDataDir>/brain/<conversation_id>/`):
    - `Summary` (_string_): Description of artifact purpose.
    - `UserFacing` (_boolean_): `true` if user should inspect; `false` for internal data.
    - `RequestFeedback` (_boolean_): `true` if requesting user execution/feedback.
- **Operational Invariants**:
  - All file creations MUST remain within the agent's assigned `write_scope`.
  - Never create loose files in the repository root.

#### `list_dir`

Lists direct children of a directory with metadata.

- **Parameters**:
  - `DirectoryPath` (_string_, required): Absolute directory path.
- **Returns**: Array of entries with relative paths, file vs directory indicators, size in bytes, and recursive child count.

#### `grep_search`

Performs high-performance ripgrep text and regex search across files or directories.

- **Parameters**:
  - `SearchPath` (_string_, required): Absolute path to search within.
  - `Query` (_string_, required): Search term or regex pattern.
  - `IsRegex` (_boolean_, optional): `true` enables regular expression matching; `false` matches literal string.
  - `CaseInsensitive` (_boolean_, optional): Case-insensitive flag.
  - `MatchPerLine` (_boolean_, optional): `true` returns matched line numbers and snippets.
  - `Includes` (_array of strings_, optional): Glob patterns to filter matching files (e.g. `["*.ts"]`).
- **Operational Rules**: Results capped at 50 matches.

#### `find_by_name`

Performs `fd` search for files and directories.

- **Parameters**:
  - `SearchDirectory` (_string_, required): Absolute path to search.
  - `Pattern` (_string_, required): Glob pattern or filename to search.
  - `Type` (_enum_, optional): `"file"`, `"directory"`, or `"any"`.
  - `Extensions` (_array of strings_, optional): File extensions without leading dot.
  - `MaxDepth` (_integer_, optional): Maximum directory traversal depth.
  - `FullPath` (_boolean_, optional): Whether full path must match glob.
- **Operational Rules**: Results capped at 50 matches.

---

### 2.2 Execution & Process Management Tools

#### `run_command`

Executes a system shell command synchronously or transitions long-running operations to background tasks.

- **Parameters**:
  - `CommandLine` (_string_, required): The exact shell command to execute.
  - `Cwd` (_string_, required): Absolute path of working directory.
  - `WaitMsBeforeAsync` (_integer_, required): Milliseconds to wait before converting to a background task (max 10,000 ms).
- **Core Invariants**:
  1. **The Zero-`cd` Mandate**: NEVER include `cd <dir> && ...` in `CommandLine`. Working directory MUST be specified exclusively via `Cwd`.
  2. **Synchronous Execution (`WaitMsBeforeAsync: 10000`)**: Always set `WaitMsBeforeAsync: 10000` for deterministic CLI and test commands (`bun harness.ts ...`, `bun test ...`, `oxlint ...`).
  3. **Background Conversion**: Commands running longer than `WaitMsBeforeAsync` automatically transition to background tasks and return a task ID (e.g., `<conversation_id>/task-<N>`).

#### `manage_task`

Interacts with running background tasks.

- **Parameters**:
  - `Action` (_enum_, required): `"list"`, `"status"`, `"send_input"`, `"kill"`.
  - `TaskId` (_string_, required for `status`, `send_input`, `kill`): Target task ID.
  - `Input` (_string_, required for `send_input`): Text input to send to stdin.
- **Anti-Polling Invariant**:
  - DO NOT poll `manage_task:status` in an active loop. The host messaging system automatically delivers notifications when background tasks output logs or terminate. Agents should conclude their turn and rely on reactive wakeups.

---

### 2.3 Asynchronous Scheduler Tool

#### `schedule`

Schedules a one-shot notification timer or a recurring background cron job.

- **Parameters**:
  - `Prompt` (_string_, required): Notification message delivered upon timer trigger.
  - `DurationSeconds` (_integer_, mutually exclusive with `CronExpression`): Delay in seconds before triggering one-shot timer.
  - `TimerCondition` (_string_, optional, default `'never'`):
    - `'never'`: Unconditionally fires after `DurationSeconds`.
    - `'any'`: Automatically cancels if ANY message is received before duration.
    - `<sender-id>`: Automatically cancels if a message from that specific subagent conversation ID or background task ID arrives before duration.
  - `CronExpression` (_string_, mutually exclusive with `DurationSeconds`): Standard 5-field cron expression (e.g., `'*/5 * * * *'`).
  - `MaxIterations` (_integer_, optional): Maximum cron firings before termination.
- **Operational Invariants**:
  - **Non-blocking Call**: `schedule` returns immediately. To wait for the timer, the agent MUST end its tool turn.
  - **Anti-Sleep Mandate**: NEVER execute `sleep <N>` or shell wait loops inside `run_command`. Always use `schedule`.
  - **Single Timer Condition**: Agents cannot maintain concurrent timers with overlapping `'any'` or identical sender ID conditions.

---

### 2.4 Antigravity Agent Lifecycle Tools

#### `define_subagent` (Antigravity)

Defines a reusable Antigravity subagent archetype.

- **Parameters**:
  - `name` (_string_, required): Unique identifier (letters, digits, `_`, `-`, `.`).
  - `description` (_string_, required): Human-readable capability summary.
  - `system_prompt` (_string_, required): Specialized system prompt defining invariants and protocols.
  - `enable_write_tools` (_boolean_, optional): Grants filesystem mutation and `run_command`.
  - `enable_subagent_tools` (_boolean_, optional): Grants subagent definition and invocation.
  - `enable_mcp_tools` (_boolean_, optional): Grants MCP server tool access.

#### `invoke_subagent` (Antigravity)

Concurrently launches one or more Antigravity subagents in background threads.

- **Parameters**:
  - `Subagents` (_array of objects_, required):
    - `TypeName` (_string_, required): Subagent archetype name.
    - `Role` (_string_, required): 2-5 word role title (e.g., `'Task Implementer'`).
    - `Prompt` (_string_, required): Complete self-contained briefing containing task ID, write scope, lease tokens, and acceptance criteria.
    - `Model` (_enum_, optional): `'inherit'` (default), `'pro'`, `'flash'`, `'flash_lite'`.
    - `Workspace` (_enum_, optional): `'inherit'` (default), `'branch'` (isolated clone), `'share'` (git worktree shared repository).

#### `manage_subagents` (Antigravity)

Monitors and manages active subagents.

- **Parameters**:
  - `Action` (_enum_, required): `"list"`, `"kill"`, `"kill_all"`.
  - `ConversationIds` (_array of strings_, required for `"kill"`): Subagent IDs to terminate.
- **Lifecycle States**: `running`, `idle`, `waiting_for_input`, `waiting_for_dependents`, `waiting_for_message`, `canceling`, `errored`, `unspecified`.

#### `send_message`

Direct point-to-point communication between agents.

- **Parameters**:
  - `Recipient` (_string_, required): Recipient conversation ID (e.g., caller agent ID).
  - `Message` (_string_, required): Message body.
- **Mandatory Reporting Rule**: Subagent return values are NOT automatically transmitted to callers upon process termination. Subagents MUST explicitly call `send_message` to transmit completion reports, verification evidence, and lease tokens before ending execution.

---

## 3. Zero-Hallucination Invariant & Prohibited Patterns

Language models, particularly small and medium parameter models, frequently hallucinate non-existent abstractions when attempting multi-agent orchestration or CLI execution. The OLT architecture strictly prohibits these hallucinated patterns.

```
❌ PROHIBITED HALLUCINATIONS                     ✅ CANONICAL HOST IMPLEMENTATION
────────────────────────────────────────────────────────────────────────────────
import { Agy } from 'agy';                      Native host tools (`invoke_subagent`, `send_message`)
agy models list                                 Native tool parameter `Model: 'pro' | 'flash'`
import { Task } from '@antigravity/sdk';        bun ~/.agents/skills/olt/scripts/harness.ts task:claim
nohup bun test & disown                         `run_command` + `manage_task` or `schedule`
sleep 300                                       `schedule` tool with `DurationSeconds: 300`
cd /path/to/repo && bun test                    `run_command` with `Cwd: "/path/to/repo"`
```

### 3.1 Prohibited Fictitious SDKs & Libraries

Agents must never attempt to import fictitious JavaScript/TypeScript packages:

- `import { Agy } from 'agy'` or `@agy/*`
- `import { Agent, Task } from '@antigravity/sdk'`
- `import { Harness } from '@olt/harness'`
- `import { ClaudeCode } from '@anthropic/claude-code'`

**Rule**: All orchestration actions must use the CLI entrypoint (`bun ~/.agents/skills/olt/scripts/harness.ts <command>`) or native host tool calls.

### 3.2 Prohibited CLI Commands

Agents must never invoke imaginary binaries:

- `agy models`, `agy task`, `agy agent`
- `gemini agent spawn`, `antigravity dispatch`
- `claude-code subagent`, `agentctl run`

**Rule**: The only permitted orchestration CLI is `bun ~/.agents/skills/olt/scripts/harness.ts` (or local `bun ./olt/scripts/harness.ts`).

### 3.3 Prohibited Shell Detachment & Polling Hacks

Agents must never bypass host process tracking by launching background processes in raw bash:

- `nohup <cmd> > /dev/null 2>&1 &`
- `<cmd> & disown`
- `bash -c "while true; do ... sleep 5; done &"`

**Rule**: Long-running commands must run through `run_command` (which automatically converts to managed tasks) and `schedule` for reactive delayed wakeups.

---

## 4. Canonical Paths, Directory Semantics & Workspace Hygiene

To prevent workspace cross-contamination and ensure atomic verification, every file and path in the OLT ecosystem adheres to canonical semantic boundaries.

```
Repository Root: /path/to/repo/
├── .olt/                                 <-- RUNTIME STATE & LEDGERS (Harness owned, flock-locked)
│   └── capsules/
│       └── <run_id>/
│           ├── manifest.json             <-- Sealed prompt hash, token, run configuration
│           ├── events.ndjson             <-- Append-only SHA-256 hash-chained event stream
│           ├── grants.ndjson             <-- Agent registration & capability grants
│           ├── tasks/                    <-- Per-task state files & lease locks
│           └── evidence/                 <-- Captured test logs, diffs & screenshots
│
├── olt/                                  <-- SKILL DEFINITION & ROLES (Immutable during runs)
│   ├── SKILL.md                          <-- Skill entrypoint & tier coordination briefs
│   ├── AGENTS.md                         <-- Detailed agent instructions & operational rules
│   ├── agents/                           <-- 21 unified agent manifests (identity + permissions + runbook)
│   ├── references/                       <-- Architectural references & host contracts
│   └── scripts/                          <-- Harness TypeScript source (`harness.ts`, …)
│
├── docs/                                 <-- PROJECT DOCUMENTATION & CHARTERS
│   └── CHARTER.md                        <-- Single Source of Truth for Mind Charter
│
├── scratch/                              <-- TEMPORARY & DEBUG SCRATCHPAD
│   └── (Ephemeral reproduction scripts, debug logs; ignored by git/evidence)
│
└── (Project source files: src/, tests/, …)
```

### 4.1 Directory Responsibilities

1. **Repository Root (`<repo_root>/`)**:
   - Contains application code, test suites, build configuration, and documentation.
   - **Hygiene Rule**: Zero loose scratch files in root. No `./temp.ts`, `./foo.log`, or uncoordinated artifacts.
2. **Global Skill Root (`~/.agents/skills/olt/`)**:
   - The canonical global installation of the OLT skill toolchain.
   - Entrypoint: `bun ~/.agents/skills/olt/scripts/harness.ts`.
3. **Skill Source (`olt/`)**:
   - Contains skill definitions, role contracts, checklists, and references.
   - **Immutability Rule**: Treated as strictly read-only during task execution unless a task lease explicitly assigns write scope to `olt/*`.
4. **Runtime Capsule State (`.olt/capsules/<run_id>/`)**:
   - Ephemeral, run-specific state managed exclusively by the harness CLI under kernel locks.
   - **Protection Rule**: Agents must NEVER edit `.olt/` files directly with filesystem tools (`write_to_file`, `replace_file_content`). All state changes must occur via harness CLI commands (`task:claim`, `task:submit`, `branch:collect`, etc.).
5. **Scratch Directory (`scratch/` or `<appDataDir>/brain/<conversation_id>/scratch/`)**:
   - Dedicated space for temporary reproduction scripts, one-off test runners, and investigative notes.
   - Ignored by Git tracking and clean tree assertions.

### 4.2 Mind Charter: Single Source of Truth

The canonical engineering principles and non-negotiable repository standards are defined in **`docs/CHARTER.md`**:

- **0 `any` Annotations**: Absolute prohibition of TypeScript `any` types.
- **0 Compiler / Linter Suppressions**: Absolute prohibition of `@ts-ignore`, `@ts-expect-error`, and `eslint-disable`.
- **Atomic Disjoint Scopes**: Tasks must modify only their assigned `write_scope`.
- **Falsifiable Verification**: All changes must be verified against deterministic test suites (`bun test tests/unit`, `bun run typecheck`, `oxlint`).

---

## 5. Summary Checklist for Agents

| Phase             | Required Host Tool / CLI Command                                         | Verification Invariant                                             |
| :---------------- | :----------------------------------------------------------------------- | :----------------------------------------------------------------- |
| **Claim Lease**   | `bun harness.ts task:claim --task <id> --agent <id> --role <role>`       | Obtain bearer lease token; confirm `write_scope`.                  |
| **Read Context**  | `view_file`, `grep_search`, `find_by_name`, `list_dir`                   | Stay within token budget; use line slices (max 800 lines).         |
| **Execute Edit**  | `replace_file_content` / `write_to_file`                                 | Confine edits strictly within leased `write_scope`. 0 loose files. |
| **Execute Tests** | `run_command` with `Cwd: "<repo>"` & `WaitMsBeforeAsync: 10000`          | Never use `cd`. Enforce 0 `any`, 0 linter suppressions.            |
| **Submit Task**   | `bun harness.ts task:submit --task <id> --token <token> --summary "..."` | Pass valid lease token; verify exit 0.                             |
| **Report Result** | `send_message` with `Recipient: "<parent_id>"`                           | Subagent must explicitly message parent with summary.              |
