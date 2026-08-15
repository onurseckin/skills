# Pinned Runtime CLI & API Reference

Always execute harness commands with `orchestrating-long-tasks/scripts/harness.ts` (or the global path `~/.agents/skills/orchestrating-long-tasks/scripts/harness.ts`).

The harness provides a **Zero-JSON CLI API** where all commands output clean, compact Markdown briefs ($\le 30$ lines) by default for low token consumption. To output raw JSON, pass `--format=json`.

---

## 1. High-Level Zero-JSON Commands

### Planning & Compilation (`plan:*`)
- `plan:init`: Initializes a new run capsule with immutable prompt capture (`--prompt-stdin` or `--prompt-file <path>`).
- `plan:add`: Registers a work item (`--id <id> --label <title> --scope <paths> --gate <command>`).
- `plan:compile`: Compiles staged tasks, analyzes scope independence, derives atomic requirements, and commits Revision 1.
- `plan:status`: Displays current staging buffer or compiled DAG summary.

### Queue & Concurrency Management (`queue:*`)
- `queue:next`: Returns the next highest-priority task ready for execution.
- `queue:list`: Lists all tasks grouped by execution status and concurrency waves.
- `queue:pop`: Atomically claims the top ready task and returns the lease token (`--agent <id>`).

### Task Execution Lifecycle (`task:*`)
- `task:claim`: Leases an explicit ready task to a worker (`--task <id> --agent <id>`).
- `task:heartbeat`: Extends an active worker lease (`--task <id> --agent <id> --token <token>`).
- `task:submit`: Submits completed work with automatic write scope and diff audit (`--summary <text>`).
- `task:validate-start`: Dispatches an independent validator to review a submitted task (`--validator <id>`).
- `task:review`: Submits validator sign-off and attaches mandatory gate proof (`--status pass`).
- `task:reject`: Rejects a task with structured findings for targeted implementer repair (`--finding-id <id> --severity <sev> --observation <obs> --remediation <rem>`).

### Run Execution & Lifecycle (`run:*` & `critic:*`)
- `run:exec` (or `run`): Executes an external command under process isolation, tracking repository pre/post bindings.
- `run:status`: Prints execution wave progress table and current run health.
- `run:complete`: Seals the capsule and commits terminal completion.
- `critic:start`: Authorizes final completeness critic session against immutable prompt bytes.
- `critic:review`: Records critic verdict on whole-repository diff and prompt compliance (`--decision approve|request_changes`).

---

## 2. Low-Level Commands & Verification Contracts

### Commands, gates, and recovery

```text
bun <pinned> run --run <run> --actor <id> [--task <id>] [--gate <id>] \
  --cwd <repo> --wall-ms <n> --idle-ms <n> [--idempotent --retries <n>] -- <literal argv...>
bun <pinned> gate --run <run> --task <id> --gate <id> --command-id <id> --actor <id>
bun <pinned> finish --run <run> --task <id> --actor <id>
bun <pinned> recover --run <run> --actor <id>
bun <pinned> projection-recover --run <run> --actor <id>
bun <pinned> disposition-orphan --run <run> --actor <id> --disposition <json>
```

`run` never invokes a shell. Only declared idempotent transient failures can retry. Gate attachment
checks command fingerprint, success, task association, gate association, and the current
`trusted_host_observed_v1` record. A terminal mandatory gate requires matching non-null
`repository_before` and `repository_after` snapshots; a mutating check requires pre/post snapshots
consistent with the claimed task's write scope. Packet Git subprocesses use the same restricted command seam
that disables external hooks, filters, and pagers.

### Reporting and completeness verification

```text
bun <pinned> status --run <run>
bun <pinned> handoff --run <run>
bun <pinned> doctor --run <run>
bun <pinned> begin-critic --run <run> --critic <fresh-id>
bun <pinned> review-completion --run <run> --critic <critic> --token <secret> --review <json>
bun <pinned> remediate-completion --run <run> --actor <coordinator> --remediation <json>
bun <pinned> complete --run <run> --actor <coordinator>
```

The `review-completion --review` file has this required shape. Every check must name a successful
critic-owned command, and `repository_command_ids` must name the successful run-level commands that
were bound into the critic packet:

```json
{
  "packet_id": "critic-1",
  "packet_sha256": "<sha256>",
  "readiness_sha256": "<sha256 returned by begin-critic and bound into the packet>",
  "graph_revision": 1,
  "repository_binding": {
    "schema": "harness.repository-binding",
    "version": 1,
    "inspection_sha256": "<sha256 from the critic packet>",
    "git_identity_sha256": "<Git identity sha256 from the critic packet>",
    "content_sha256": "<sha256 from the critic packet>",
    "file_count": 123,
    "total_bytes": 456789
  },
  "status": "clean",
  "unresolved_finding_ids": [],
  "findings": [],
  "integrity_evidence": [{ "status": "passed", "issues": [] }],
  "repository_command_ids": ["C-RUN-GATE"],
  "checks": [{ "command_id": "C-CRITIC-CHECK" }],
  "requirement_proofs": [
    {
      "requirement_id": "R-001",
      "status": "satisfied",
      "evidence": [
        {
          "kind": "command",
          "reference": "C-REQUIREMENT-CHECK",
          "observation": "the command proves the acceptance criterion"
        }
      ]
    }
  ],
  "residual_risks": []
}
```
