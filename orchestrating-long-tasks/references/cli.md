# Pinned Runtime CLI & API Reference

Always execute harness commands with `orchestrating-long-tasks/scripts/harness.ts` (or the global path `~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts`).

The harness provides a **Zero-JSON CLI API** where all commands output clean, compact Markdown briefs ($\le 30$ lines) by default for low token consumption. To output raw JSON, pass `--format=json`.

---

## 1. Planning & Compilation (`plan:*`)

- **`plan:init`**: Initializes a new run capsule with immutable prompt capture.
  ```bash
  printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin
  ```
- **`plan:add`**: Registers a work unit with a disjoint write scope and mandatory gate command.
  ```bash
  bun harness.ts plan:add --run <run-id> --id <task-id> --label "<label>" --scope <path> --gate "<gate-cmd>" [--deps <dep-id>]
  ```
- **`plan:status`**: Displays current staging buffer or compiled DAG summary.
  ```bash
  bun harness.ts plan:status --run <run-id>
  ```
- **`plan:compile`**: Compiles staged tasks, analyzes scope independence, derives atomic requirements, and commits Revision 1.
  ```bash
  bun harness.ts plan:compile --run <run-id> --actor planner
  ```

---

## 2. Queue & Concurrency Management (`queue:*`)

- **`queue:next`**: Returns the next highest-priority task ready for execution.
  ```bash
  bun harness.ts queue:next --run <run-id>
  ```
- **`queue:list`**: Lists all tasks grouped by execution status and concurrency waves.
  ```bash
  bun harness.ts queue:list --run <run-id>
  ```
- **`queue:pop`**: Atomically claims the top ready task and returns the lease token.
  ```bash
  bun harness.ts queue:pop --run <run-id> --agent <worker-id> --lease-seconds 1800
  ```

---

## 3. Task Execution Lifecycle (`task:*`)

- **`task:claim`**: Leases an explicit ready task to a worker.
  ```bash
  bun harness.ts task:claim --run <run-id> --task <task-id> --agent <worker-id>
  ```
- **`task:heartbeat`**: Extends an active worker lease.
  ```bash
  bun harness.ts task:heartbeat --run <run-id> --task <task-id> --agent <worker-id> --token <token>
  ```
- **`task:submit`**: Submits completed work with automatic write scope and diff audit.
  ```bash
  bun harness.ts task:submit --run <run-id> --task <task-id> --agent <worker-id> --token <token> --summary "<summary>"
  ```
- **`task:validate-start`**: Dispatches an independent validator to review a submitted task.
  ```bash
  bun harness.ts task:validate-start --run <run-id> --task <task-id> --validator <val-agent>
  ```
- **`task:review`**: Submits validator sign-off and attaches mandatory gate proof.
  ```bash
  bun harness.ts task:review --run <run-id> --task <task-id> --validator <val-agent> --token <token> --status pass --summary "<summary>" [--evidence <cmd-id>]
  ```
- **`task:reject`**: Rejects a task with structured findings for targeted implementer repair.
  ```bash
  bun harness.ts task:reject --run <run-id> --task <task-id> --validator <val-agent> --token <token> --reason "<reason>" --finding "<remediation>" [--evidence <cmd-id>]
  ```

---

## 4. Run Execution & Completeness Critic (`run:*` & `critic:*`)

- **`run:exec`**: Executes an external command under process isolation, tracking repository pre/post bindings.
  ```bash
  bun harness.ts run:exec --run <run-id> --actor <actor-id> [--task <task-id>] [--gate <gate-id>] -- <argv...>
  ```
- **`run:status`**: Prints execution wave progress table and current run health.
  ```bash
  bun harness.ts run:status --run <run-id>
  ```
- **`critic:start`**: Authorizes final completeness critic session against immutable prompt bytes.
  ```bash
  bun harness.ts critic:start --run <run-id> --critic <critic-id>
  ```
- **`critic:review`**: Records critic verdict on whole-repository diff and prompt compliance.
  ```bash
  bun harness.ts critic:review --run <run-id> --critic <critic-id> --token <token> --decision approve --summary "<summary>"
  ```
- **`run:complete`**: Seals the capsule and commits terminal completion.
  ```bash
  bun harness.ts run:complete --run <run-id> --actor coordinator
  ```

---

## 5. Visual Summary & Analytics (`summary:*`)

- **`summary:export`**: Generates full Graph Visualization UI (GVUI) datasets, metrics, and timeline events.
  ```bash
  bun harness.ts summary:export --run <run-id>
  ```
- **`summary:view`**: Renders terminal executive summary and execution metrics.
  ```bash
  bun harness.ts summary:view --run <run-id>
  ```
- **GVUI CLI Ingestion (`gvui:import`)**: Imports the generated summary into GVUI for browser-based DAG inspection.
  ```bash
  # Run from gvui repository
  bun run gvui:import --capsule /path/to/.capsules/<run-id>
  ```

