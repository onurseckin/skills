# CLI Capability Manifest — mind (knowledge)

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../../cli-capabilities.md`](../../cli-capabilities.md).

### `memory:query`

Query indexed cross-run knowledge, decisions, and memory documents.

Performs full-text retrieval and ranking across knowledge base, charter, findings, decisions, and past run summaries with zero external file reads required.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--query` | string | no | no | - | Search query terms. |
| `--run` | string | no | no | - | Filter by capsule run root. |
| `--capsules-dir` | string | no | no | - | Override capsules root directory. |
| `--repo` | string | no | no | - | Repository root path. |
| `--kind` | string | no | no | - | Filter by document kind. |
| `--limit` | int | no | no | `10` | Maximum number of search results. |
| `--min-score` | string | no | no | - | Minimum similarity/match score threshold. |
| `--all` | bool | no | no | - | Display all matching documents without truncation. |
| `--now` | string | no | no | - | Timestamp override (ISO8601). |

```bash
bun harness.ts memory:query --query "authentication refactor"
```

### `smart-task:plan`

Autonomously synthesize self-evolution tasks or plan from feedback queue.

Smart task planner: prioritizes feedback intake, or synthesizes autonomic self-evolution tasks on empty queue.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--capsules-dir` | string | no | no | - | Capsules root directory. |
| `--max-tasks` | int | no | no | - | Maximum tasks to generate (default: 5). |
| `--goal` | string | no | no | - | Charter goal ID to bind. |

```bash
bun harness.ts smart-task:plan
bun harness.ts smart-task:plan --max-tasks 3
```

### `smart-task:ingest`

Ingest and enhance an external prompt into a gate-verifiable task plan.

Expands an external prompt into a structured task with write scope and mandatory gate.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--prompt` | string | yes | no | - | External prompt or task description. |
| `--id` | string | no | no | - | Custom task ID. |
| `--goal` | string | no | no | - | Charter goal ID to bind. |

```bash
bun harness.ts smart-task:ingest --prompt 'Implement real-time metrics telemetry' --id task-metrics
```
