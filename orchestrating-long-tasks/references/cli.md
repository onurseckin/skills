# Pinned Runtime CLI & API Reference

All harness operations run through `orchestrating-long-tasks/scripts/harness.ts` (or the installed entrypoint `~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts`).

The harness provides a **Zero-JSON CLI API** where all domain commands output clean, compact Markdown briefs ($\le 30$ lines) by default for low token consumption. To output raw structured JSON, pass `--format=json`.

---

## Command Categories & Syntax

### 1. Planning & Graph Compilation (`plan:*`)

- **`plan:init`**: Initializes a new run capsule with immutable prompt capture.
  - **Flags**: `--repo <path>` (default `.`), `--run <slug>` or `--run-id <slug>`, `--prompt-file <path>` or `--prompt-stdin`, `--capture-mode <mode>`, `--source-verified <bool>`
  - **STDIN**: Accepts prompt bytes directly when `--prompt-stdin` is set.

  ```bash
  printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin
  ```

- **`plan:add`**: Registers a task declaration in the planning buffer before compilation.
  - **Flags**: `--run <path>`, `--id <task-id>`, `--label "<text>"`, `--scope "<comma-separated-paths>"`, `--gate "<cmd>"`, `[--deps "<comma-separated-deps>"]`, `[--goal "<text>"]`, `[--criteria "<semi-colon-separated>"]`, `[--priority <int>]`, `[--effort <int>]`, `[--actor <id>]`

  ```bash
  bun harness.ts plan:add --run .capsules/<run-id> --id task-1 --label "Database Schema" --scope "src/db,prisma" --gate "bun test tests/db.test.ts" --actor coordinator
  ```

- **`plan:status`**: Displays the current staging buffer or compiled DAG summary.
  - **Flags**: `--run <path>`

  ```bash
  bun harness.ts plan:status --run .capsules/<run-id>
  ```

- **`plan:compile`**: Validates scope independence, derives atomic requirements from prompt lines, constructs the topological execution DAG, and commits Graph Revision 1.
  - **Flags**: `--run <path>`, `[--strict-parallel]`, `[--actor <id>]`

  ```bash
  bun harness.ts plan:compile --run .capsules/<run-id> --actor planner
  ```

- **`plan:replan`**: Dynamic scope-aware replanning. Ingests findings from critic or validator rejections, partitions them by file paths into disjoint write scopes, increments the graph revision ($R \to R+1$), and compiles a new Repair Wave DAG.
  - **Flags**: `--run <path>`, `[--findings-file <path>]`, `[--findings '<json>']`, `[--gate "<reval-gate>"]`, `[--actor <id>]`
  ```bash
  bun harness.ts plan:replan --run .capsules/<run-id> --actor coordinator --gate "bun run typecheck"
  ```

---

### 2. Queue & Concurrency Management (`queue:*`)

- **`queue:next`**: Returns the next highest-priority task ready for execution in the current wave.
  - **Flags**: `--run <path>`

  ```bash
  bun harness.ts queue:next --run .capsules/<run-id>
  ```

- **`queue:list`**: Lists all tasks grouped by status (`ready`, `leased`, `validating`, `done`, `proposed`, `changes_requested`).
  - **Flags**: `--run <path>`

  ```bash
  bun harness.ts queue:list --run .capsules/<run-id>
  ```

- **`queue:pop`**: Atomically claims the highest-priority ready task and returns a lease token.
  - **Flags**: `--run <path>`, `--agent <worker-id>`, `[--lease-seconds <int>]` (default 1800)
  ```bash
  bun harness.ts queue:pop --run .capsules/<run-id> --agent worker-1 --lease-seconds 1800
  ```

---

### 3. Task Execution Lifecycle (`task:*`)

- **`task:claim`**: Leases a specific ready task to an implementer.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `[--role implementer]`, `[--lease-duration <sec>]`

  ```bash
  bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1
  ```

- **`task:heartbeat`**: Extends an active worker lease to prevent timeout during long edits.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <token>`, `[--extend <sec>]` (default 1800)

  ```bash
  bun harness.ts task:heartbeat --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>
  ```

- **`task:submit`**: Submits completed task work with write scope compliance check and diff auditing.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <token>`, `[--summary "<text>"]`

  ```bash
  bun harness.ts task:submit --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Implemented user auth"
  ```

- **`task:validate-start`**: Dispatches an independent validator to audit a submitted task.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <validator-id>`, `[--lease-duration <sec>]`

  ```bash
  bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1
  ```

- **`task:review`**: Submits validator sign-off and attaches mandatory gate proof commands.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <validator-id>`, `--token <token>`, `--status <pass|fail>`, `[--summary "<text>"]`, `[--checks <cmd-ids>]`, `[--evidence <cmd-ids>]`, `[--finding-id <id>]`

  ```bash
  bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --status pass --checks C-123,C-456 --summary "All tests pass"
  ```

- **`task:reject`**: Rejects a task with structured findings for targeted implementer repair.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <validator-id>`, `--token <token>`, `--reason "<issue>"`, `[--finding "<remediation>"]`, `[--finding-id <id>]`, `[--checks <cmd-ids>]`
  ```bash
  bun harness.ts task:reject --run .capsules/<run-id> --task task-1 --validator val-1 --token <token> --reason "Missing input validation on POST /users"
  ```

---

### 4. Process Execution & Monitored Gates (`run:*`)

- **`run:exec`**: Executes an external verification or gate command under process isolation, capturing stdout/stderr, timestamps, exit codes, and repository pre/post bindings. Automatically scans and ingests Playwright UI screenshots and `visual-report.json`.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--gate <gate-id>]`, `[--cwd <path>]`, `[--actor <id>]`, `[--save-evidence <bool>]`
  - **Separator**: Command arguments follow `--`

  ```bash
  bun harness.ts run:exec --run .capsules/<run-id> --task task-1 --gate gate-1 --actor val-1 -- bun test tests/unit/auth.test.ts
  ```

- **`run:status`**: Displays execution wave progress table, task statuses, and current run health.
  - **Flags**: `--run <path>`, `[--detailed]`

  ```bash
  bun harness.ts run:status --run .capsules/<run-id>
  ```

- **`run:complete`**: Seals the capsule, verifies completion artifacts, checks live repository bindings, and commits terminal completion.
  - **Flags**: `--run <path>`, `[--actor <id>]` (default `coordinator`), `[--auth-token <token>]`
  ```bash
  bun harness.ts run:complete --run .capsules/<run-id> --actor coordinator
  ```

---

### 5. Completeness Critic Operations (`critic:*`)

- **`critic:start`**: Authorizes a final completeness critic session against the original immutable prompt bytes.
  - **Flags**: `--run <path>`, `--critic <critic-id>`

  ```bash
  bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1
  ```

- **`critic:review`**: Records critic sign-off on whole-repository diff and prompt compliance.
  - **Flags**: `--run <path>`, `--critic <critic-id>`, `--token <token>`, `--decision <approve|request_changes>`, `[--summary "<text>"]`

  ```bash
  bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <token> --decision approve --summary "All prompt criteria verified in whole diff"
  ```

- **`critic:reject`**: Rejects completion with structured findings triggering the Cascading Scope-Aware Replanning protocol.
  - **Flags**: `--run <path>`, `--critic <critic-id>`, `--token <token>`, `--reason "<text>"`, `[--finding "<remediation>"]`, `[--findings-file <path>]`
  ```bash
  bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <token> --reason "Missing error boundary component"
  ```

---

### 6. Summary, Analytics & GVUI Integration (`summary:*`)

- **`summary:export`**: Generates full Graph Visualization UI (GVUI) datasets (`graph.json`, `metrics.json`, `timeline.json`, `summary.md`).
  - **Flags**: `--run <path>`

  ```bash
  bun harness.ts summary:export --run .capsules/<run-id>
  ```

- **`summary:view`**: Renders executive Markdown brief in the terminal.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts summary:view --run .capsules/<run-id>
  ```

---

### 7. Inspection Operations (`finding:*`, `report:*`, `evidence:*`)

- **`finding:get`**: Retrieves specific or all findings recorded for a task.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--id <finding-id>]`
- **`report:get`**: Retrieves task submission or review reports.
  - **Flags**: `--run <path>`, `--task <task-id>`, `[--type <submission|review>]`, `[--screenshots]`
- **`evidence:get`**: Retrieves execution evidence records for commands or tasks.
  - **Flags**: `--run <path>`, `[--id <cmd-id>]`, `[--task <task-id>]`, `[--screenshots]`
- **`evidence:screenshots`**: Queries and lists all captured UI screenshots with test IDs and viewports.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--command <cmd-id>]`

---

### 8. Autonomous Orchestrator Loop (`orchestrator:run`)

- **`orchestrator:run`** (or `orchestrator`): Executes an autonomous coordination loop over a capsule, managing wave transitions and automated repair.
  - **Flags**: `--run <path>`, `[--max-rounds <int>]`, `[--auto-repair]`

---

### 9. Multi-Client Installation (`install`, `installation-status`)

- **`install`**: Installs and links the canonical skill to multiple AI assistant environments simultaneously.
  - **Flags**: `--source <path>`, `--home <path>`, `--clients <antigravity,claude,codex,chatgpt>`
- **`installation-status`**: Audits installation integrity, symlink targets, and runtime versions.
  - **Flags**: `--source <path>`, `--home <path>`

---

## Exit Codes Contract

| Exit Code | Classification                       | Meaning & Resolution                                                                                             |
| :-------- | :----------------------------------- | :--------------------------------------------------------------------------------------------------------------- |
| **`0`**   | `SUCCESS`                            | Command executed successfully; markdown brief emitted to stdout.                                                 |
| **`3`**   | `INVALID_ARGUMENT` / `INVALID_STATE` | Flag error, missing required arguments, illegal state transition (e.g. claiming unready task), or gate mismatch. |
| **`70`**  | `INTERNAL` / `IO_ERROR`              | Filesystem error, missing capsule path, or unexpected system exception.                                          |
