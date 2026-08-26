# CLI Capability Manifest — agent

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `scope:expand`

Dynamically expand the declared read scope neighborhood for an active actor.

Appends the specified target path or directory to the agent's allowed read scope manifest and logs the expansion.

- **Aliases**: `scope-expand`
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--actor` | string | yes | no | - | Agent id whose read scope is being expanded. |
| `--read` | string | yes | no | - | Target file or directory path to add to allowed read scope. |
| `--run` | string | no | no | - | Capsule run root. |
| `--run-id` | string | no | no | - | Alias for --run. |

```bash
bun harness.ts scope:expand --actor imp-1 --read src/shared/types.ts
bun harness.ts scope:expand --actor imp-1 --run .olt/capsules/<run-id> --read src/policy/repo-policy.ts
```

### `agent:register`

Record a dispatched subagent and mint its grant.

Spawning happens host-side; this is how the run learns a subagent exists, who deployed it and under which task. Model, tier, thinking level and toolset below are whatever the dispatcher relays — recorded only when supplied, tagged agent_reported, and left absent otherwise. The harness separately probes the host's own config and transcript for the same fields automatically; only that probe ever earns host_reported/derived/harness_observed. The parent agent must already hold a grant.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id of the dispatched subagent. |
| `--role` | string | yes | no | - | Canonical role the agent is granted. |
| `--host` | string | yes | no | - | Host runtime that spawned the agent. |
| `--host-address` | string | no | no | - | Host-level routable address of the agent: the spawn name or raw host agent id a message can actually be sent to. --agent is the harness actor id and is not addressable host-side, so omitting this leaves the grant unroutable. |
| `--parent-agent` | string | no | no | - | Agent id that dispatched it; omit for the root. |
| `--parent-task` | string | no | no | - | Task or branch sub-task the agent is dispatched onto. |
| `--actor` | string | no | no | - | Event actor; defaults to the parent agent, else the agent. |
| `--provider` | string | no | no | - | Provider serving the model, as the caller relays it (agent_reported). |
| `--model` | string | no | no | - | Model id as the caller relays it, recorded exactly as given and never parsed (agent_reported). |
| `--model-tier` | string | no | no | - | Tier as the caller relays it: xs, s, m, l or unknown (agent_reported unless unknown). |
| `--thinking-level` | string | no | no | - | Level as the caller relays it: low, medium, high or unknown (agent_reported unless unknown). |
| `--context-window` | int | no | no | - | Context window in tokens, as the caller relays it (agent_reported). |
| `--tool` | string | no | yes | - | One tool as <name> or <name>=<category>; repeat the flag for each tool. Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. A tool given without a category has none recorded. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact as <tool>:<key>=<value>, kept verbatim under the reported name. The tool must also be given with --tool. |

```bash
bun harness.ts agent:register --run .olt/capsules/<run-id> --agent worker-1 --role implementer --host claude-code --host-address a35c207176e4bb129 --parent-agent coordinator-1 --parent-task task-1 --tool Bash=shell --tool-extra Bash:shell=zsh
```

### `agent:report`

Ingest the caller's own report of tool usage and token counts mid-flight.

Token counts are the caller's running totals and replace the previous ones, tagged agent_reported; --tokens-estimated marks them derived estimates instead. The harness separately probes the host's own transcript for real counts (B34), which is what actually earns harness_observed. At least one of --tool, --tokens-in, --tokens-out or --token-extra is required.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id holding the grant. |
| `--tool` | string | no | yes | - | One tool as <name> or <name>=<category>; repeat the flag for each tool. Generic category of the tool, e.g. browser-automation, build, database, documentation, file-edit, formatter, http-client, linter, package-manager, search, shell, test-runner, type-checker, version-control. Any other value is recorded as given. A tool given without a category has none recorded. |
| `--tool-extra` | string | no | yes | - | One tool-specific fact as <tool>:<key>=<value>, kept verbatim under the reported name. The tool must also be given with --tool. |
| `--tokens-in` | int | no | no | - | Input tokens consumed so far, as the caller reports it. |
| `--tokens-out` | int | no | no | - | Output tokens produced so far, as the caller reports it. |
| `--token-extra` | string | no | yes | - | One provider-specific counter as <name>=<count>, kept under the name the caller reported it by. |
| `--tokens-estimated` | bool | no | no | - | Record the counts as estimates, not measurements. |
| `--actor` | string | no | no | - | Event actor; defaults to the reporting agent. |

```bash
bun harness.ts agent:report --run .olt/capsules/<run-id> --agent worker-1 --tool Read=file-edit --tool Grep=search --tokens-in 18000 --tokens-out 2400 --token-extra cache_read_input_tokens=91000
```

### `agent:release`

Close a subagent's grant.

Marks the grant released and stamps the release time. A released agent can no longer report.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--agent` | string | yes | no | - | Agent id holding the grant. |
| `--reason` | string | yes | no | - | Why the grant closed. |
| `--actor` | string | no | no | - | Event actor; defaults to the released agent. |

```bash
bun harness.ts agent:release --run .olt/capsules/<run-id> --agent worker-1 --reason "task-1 submitted"
```

### `agent:list`

Show who is deployed, or the lineage of one task.

Without flags it lists active grants with whatever telemetry was recorded, each field labelled with the evidence class it actually earned. --task answers who worked a task and under whom, including the agents those agents dispatched.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--task` | string | no | no | - | Report the lineage of this task instead of the roster. |
| `--all` | bool | no | no | - | Include released grants. |

```bash
bun harness.ts agent:list --run .olt/capsules/<run-id>
bun harness.ts agent:list --run .olt/capsules/<run-id> --task task-1
```

### `agent:brief`

Generate an exact-anchor subagent briefing.

Assembles the 100% complete, uncompressed 1-Shot Landing Prompt for a subagent.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--role` | string | yes | no | - | The role of the agent to brief. |
| `--format` | string | no | no | - | Output format. |

```bash
bun harness.ts agent:brief --role implementer
```

### `agent:define`

Define a new agent manifest.

Placeholder for defining new agents.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected
