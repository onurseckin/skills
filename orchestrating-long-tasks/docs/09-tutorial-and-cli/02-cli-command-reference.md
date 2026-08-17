# 02. Comprehensive CLI Command Reference Manual

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)

---

## 📖 Zero-JSON CLI Grammar & Invocation Patterns

The `orchestrating-long-tasks` CLI provides domain-specific colon commands designed for direct agent consumption. Instead of authoring large JSON payloads, all interactions use concise CLI flags and emit compact Markdown briefs ($\le 30$ lines) for minimum context token overhead:

```bash
bun harness.ts <domain:command> [flags...] [-- <argv...>]
```

---

## 📑 Complete Command Catalog

### 1. Planning & Decomposition (`plan:*`)

- **`plan:init`**: Initialize a new run capsule with byte-exact prompt capture and digest binding.
  - **Flags**: `--repo <path>`, `--run <slug>` or `--run-id <slug>`, `--prompt-file <path>` or `--prompt-stdin`, `[--capture-mode <mode>]`, `[--source-verified <bool>]`
  ```bash
  printf "%s" "$PROMPT" | bun harness.ts plan:init --repo . --run <run-id> --prompt-stdin
  ```
- **`plan:add`**: Register a modular task with disjoint write scopes and mandatory gates.
  - **Flags**: `--run <path>`, `--id <task-id>`, `--label "<label>"`, `--scope "<comma-separated-paths>"`, `--gate "<gate-cmd>"`, `[--deps "<comma-separated-deps>"]`, `[--goal "<text>"]`, `[--criteria "<semi-colon-separated>"]`, `[--priority <int>]`, `[--effort <int>]`, `[--actor <id>]`
  ```bash
  bun harness.ts plan:add --run .capsules/<run-id> --id task-1 --label "Database Schema" --scope "src/db,prisma" --gate "bun test tests/db.test.ts"
  ```
- **`plan:status`**: Output current draft planning buffer and task table.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts plan:status --run .capsules/<run-id>
  ```
- **`plan:compile`**: Compile dependency DAG with 100% line disposition coverage verification, scope independence analysis, and revision freeze.
  - **Flags**: `--run <path>`, `[--strict-parallel]`, `[--actor <id>]`
  ```bash
  bun harness.ts plan:compile --run .capsules/<run-id> --actor coordinator
  ```
- **`plan:replan`**: Ingest critic or validator pushback findings, partition disjoint scopes, increment graph revision ($R \to R+1$), and compile a new Repair Wave DAG.
  - **Flags**: `--run <path>`, `[--findings-file <path>]`, `[--findings '<json>']`, `[--gate "<reval-gate>"]`, `[--actor <id>]`
  ```bash
  bun harness.ts plan:replan --run .capsules/<run-id> --actor coordinator --gate "bun run typecheck"
  ```

---

### 2. Queue & Dispatch Management (`queue:*`)

- **`queue:next`**: Query the next ready task unblocked in the dependency graph.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts queue:next --run .capsules/<run-id>
  ```
- **`queue:list`**: List all currently queued, ready, or leased tasks across waves.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts queue:list --run .capsules/<run-id>
  ```
- **`queue:pop`**: Pop the highest-priority conflict-free task and lease it to a worker.
  - **Flags**: `--run <path>`, `--agent <worker-id>`, `[--lease-seconds <N>]` (default 1800)
  ```bash
  bun harness.ts queue:pop --run .capsules/<run-id> --agent worker-1 --lease-seconds 1800
  ```

---

### 3. Task Implementation & Submission (`task:*`)

- **`task:claim`**: Explicitly lease a ready task to an assigned agent.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `[--role implementer]`, `[--lease-duration <sec>]`
  ```bash
  bun harness.ts task:claim --run .capsules/<run-id> --task task-1 --agent worker-1
  ```
- **`task:heartbeat`**: Extend an active task lease during ongoing execution.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <bearer-token>`, `[--extend <sec>]`
  ```bash
  bun harness.ts task:heartbeat --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token>
  ```
- **`task:submit`**: Submit finished implementation work with diff verification and report generation.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--agent <worker-id>`, `--token <bearer-token>`, `[--summary "<summary>"]`
  ```bash
  bun harness.ts task:submit --run .capsules/<run-id> --task task-1 --agent worker-1 --token <token> --summary "Completed task-1 implementation"
  ```

---

### 4. Independent Validation & Bounded Repair (`task:*`)

- **`task:validate-start`**: Dispatch an independent validator with a fresh validation token.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <val-id>`, `[--lease-duration <sec>]`
  ```bash
  bun harness.ts task:validate-start --run .capsules/<run-id> --task task-1 --validator val-1
  ```
- **`task:review`**: Record validator approval following successful gate runs.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <val-id>`, `--token <val-token>`, `--status <pass|fail>`, `[--summary "<summary>"]`, `[--checks <cmd-ids>]`, `[--evidence <cmd-ids>]`, `[--finding-id <id>]`
  ```bash
  bun harness.ts task:review --run .capsules/<run-id> --task task-1 --validator val-1 --token <val-token> --status pass --checks C-123 --summary "All verification gates passed"
  ```
- **`task:reject`**: Reject task submission with structured remediation findings for implementer repair.
  - **Flags**: `--run <path>`, `--task <task-id>`, `--validator <val-id>`, `--token <val-token>`, `--reason "<reason>"`, `[--finding "<remediation>"]`, `[--finding-id <id>]`, `[--checks <cmd-ids>]`
  ```bash
  bun harness.ts task:reject --run .capsules/<run-id> --task task-1 --validator val-1 --token <val-token> --reason "Missing unit tests for edge case X"
  ```

---

### 5. Monitored Execution & Completeness Critic (`run:*` & `critic:*`)

- **`run:exec`**: Execute commands under watchdog monitoring and capture `trusted_host_observed_v1` evidence and screenshots.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--gate <gate-id>]`, `[--cwd <path>]`, `[--actor <id>]`, `[--save-evidence <bool>]`
  - **Trailing Command**: Command and arguments placed after `--`
  ```bash
  bun harness.ts run:exec --run .capsules/<run-id> --task task-1 --gate gate-1 --actor val-1 -- bun test tests/unit/task.test.ts
  ```
- **`run:status`**: Output complete task states, findings, and gate results.
  - **Flags**: `--run <path>`, `[--detailed]`
  ```bash
  bun harness.ts run:status --run .capsules/<run-id>
  ```
- **`critic:start`**: Begin completeness critic review session against immutable prompt bytes.
  - **Flags**: `--run <path>`, `--critic <critic-id>`
  ```bash
  bun harness.ts critic:start --run .capsules/<run-id> --critic critic-1
  ```
- **`critic:review`**: Submit final completeness critic audit decision.
  - **Flags**: `--run <path>`, `--critic <critic-id>`, `--token <critic-token>`, `--decision <approve|request_changes>`, `[--summary "<summary>"]`
  ```bash
  bun harness.ts critic:review --run .capsules/<run-id> --critic critic-1 --token <token> --decision approve --summary "Whole-diff verified against prompt"
  ```
- **`critic:reject`**: Rejects completion with structured findings triggering the Cascading Scope-Aware Replanning protocol.
  - **Flags**: `--run <path>`, `--critic <critic-id>`, `--token <token>`, `--reason "<text>"`, `[--finding "<remediation>"]`, `[--findings-file <path>]`
  ```bash
  bun harness.ts critic:reject --run .capsules/<run-id> --critic critic-1 --token <token> --reason "Missing error boundary component"
  ```
- **`run:complete`**: Mechanically evaluate the 8-point checklist, verify repository post-bindings, and seal the run.
  - **Flags**: `--run <path>`, `[--actor <name>]`, `[--auth-token <token>]`
  ```bash
  bun harness.ts run:complete --run .capsules/<run-id> --actor coordinator
  ```

---

### 6. Visual Summary, Inspection & GVUI Ingestion (`summary:*`, `finding:*`, `report:*`, `evidence:*`)

- **`summary:export`**: Generate complete graph dataset, metrics, timeline, and Markdown summary suite.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts summary:export --run .capsules/<run-id>
  ```
- **`summary:view`**: Render terminal executive summary and execution telemetry.
  - **Flags**: `--run <path>`
  ```bash
  bun harness.ts summary:view --run .capsules/<run-id>
  ```
- **`finding:get`**: Retrieve specific or all findings recorded for a task.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--id <finding-id>]`
- **`report:get`**: Retrieve task submission or review reports.
  - **Flags**: `--run <path>`, `--task <task-id>`, `[--type <submission|review>]`, `[--screenshots]`
- **`evidence:get`**: Retrieve execution evidence records for commands or tasks.
  - **Flags**: `--run <path>`, `[--id <cmd-id>]`, `[--task <task-id>]`, `[--screenshots]`
- **`evidence:screenshots`**: Inspect captured Playwright and visual audit screenshots across tasks.
  - **Flags**: `--run <path>`, `[--task <task-id>]`, `[--command <cmd-id>]`
- **GVUI CLI Ingestion (`gvui:import`)**: Ingest capsule graph into GVUI for interactive browser inspection.
  ```bash
  # Run from gvui repository
  bun run gvui:import --capsule /path/to/.capsules/<run-id>
  ```

---

[⬅ Previous: Complete End-to-End Tutorial](./01-end-to-end-tutorial.md) | [Master Table of Contents](../README.md) | [Next: Troubleshooting & FAQ ➡](./03-troubleshooting-and-faq.md)
