# CLI Capability Manifest — branch

Generated from `olt/scripts/src/cli/registry` by `olt/scripts/generate-cli-manifest.ts`. Do not edit by
hand. Index: [`../cli-capabilities.md`](../cli-capabilities.md).

### `branch:open`

Subdivide the work you hold into sub-tasks a sub-agent can take.

A branch is an execution-time subdivision, never a plan task, so it never touches the plan revision. The parent moves to `branched` and its lease clock freezes until collect or abandon, which is what stops a parent blocked on children from being reaped as stale. Every sub-task scope must be a STRICTLY PROPER subset of the parent scope and stay disjoint from its siblings; a violation is refused, not trimmed. That proper-subset rule is what makes a chain of branches terminate. --parent-task accepts a plan task or another branch's sub-task; config max_branch_depth (default 5) is an escalation tripwire on nesting rather than a structural bound, and config max_agents (default 100) caps the grants a run may issue at any depth — a branch is charged one grant per sub-task up front.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--parent-task` | string | yes | no | - | Plan task or sub-task the branch hangs off. |
| `--agent` | string | yes | no | - | Agent holding the parent lease. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--reason` | string | yes | no | - | Why the work had to be subdivided. |
| `--sub-task` | string | no | yes | - | Sub-task id; repeat the flag for each sub-task. |
| `--sub-label` | string | no | yes | - | `<sub-task-id>=<label>`; one per sub-task. |
| `--sub-scope` | string | no | yes | - | `<sub-task-id>=<path>`; repeat for each path. |
| `--sub-gate` | string | no | yes | - | `<sub-task-id>=<command>`; optional revalidation gate. |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:open --run .olt/capsules/<run-id> --parent-task task-1 --agent worker-1 --token <token> --reason "parser rewrite blocks the API change" --sub-task S-1 --sub-label S-1="Fix the parser" --sub-scope S-1=src/one/parser
```

### `branch:claim`

Lease one branch sub-task to a sub-agent.

Returns the bearer token the sub-agent echoes back to branch:submit. The lease expires like any other, and `recover` reclaims it if the sub-agent dies.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--sub-task` | string | yes | no | - | Sub-task id to claim. |
| `--agent` | string | yes | no | - | Sub-agent receiving the lease. |
| `--role` | string | yes | no | - | Branch role the sub-agent works under: sub-implementer, sub-investigator or sub-validator. |
| `--lease-seconds` | int | no | no | - | Lease length in seconds (5-86400). |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:claim --run .olt/capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --role sub-implementer
```

### `branch:submit`

Hand a finished sub-task back to the branch.

Records what the sub-agent reports it did and releases the sub-lease. The summary is agent-reported; the file-level truth is measured once, by branch:collect.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--sub-task` | string | yes | no | - | Sub-task id being submitted. |
| `--agent` | string | yes | no | - | Sub-agent holding the sub-lease. |
| `--token` | string | yes | no | - | Sub-lease bearer token. |
| `--summary` | string | yes | no | - | What the sub-agent changed. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:submit --run .olt/capsules/<run-id> --branch B-<uuid> --sub-task S-1 --agent sub-1 --token <token> --summary "Parser accepts the new grammar"
```

### `branch:collect`

Take the branch back and resume the parent.

Refuses while any sub-task is still live. Records a real Git observation of the worktree delta across the branch window as harness_observed evidence, restores the parent lease with a fresh expiry and returns the parent to `running`. When the repository cannot be observed the file list stays absent rather than becoming an empty one.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--agent` | string | yes | no | - | Parent agent that opened the branch. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--summary` | string | yes | no | - | What came back from the sub-agents. |
| `--repo` | string | no | no | - | Repository root observed through Git; falls back to the current directory. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:collect --run .olt/capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --summary "Parser fixed; API change unblocked"
```

### `branch:abandon`

Give up on a branch and resume the parent.

The failure path. Every non-terminal sub-task is marked abandoned and its lease released, then the parent gets its lease back and returns to `running` to carry the work itself.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | yes | no | - | Branch id returned by branch:open. |
| `--agent` | string | yes | no | - | Parent agent that opened the branch. |
| `--token` | string | yes | no | - | Parent lease bearer token. |
| `--reason` | string | yes | no | - | Why the branch is being given up. |
| `--actor` | string | no | no | - | Event actor; defaults to the acting agent. |

```bash
bun harness.ts branch:abandon --run .olt/capsules/<run-id> --branch B-<uuid> --agent worker-1 --token <token> --reason "sub-agent could not reproduce the failure"
```

### `branch:status`

Show which branches are open and what they are waiting on.

Lists open branches by default with the reason each one was opened. --all includes collected and abandoned ones, --branch narrows to one and --task narrows to a parent.

- **Aliases**: none
- **Stdin**: not read
- **Arguments after `--`**: rejected

| Flag | Type | Required | Repeatable | Default | Description |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `--run` | string | yes | no | - | Capsule run root. |
| `--branch` | string | no | no | - | Show only this branch. |
| `--task` | string | no | no | - | Show only branches under this parent. |
| `--all` | bool | no | no | - | Include collected and abandoned branches. |

```bash
bun harness.ts branch:status --run .olt/capsules/<run-id>
bun harness.ts branch:status --run .olt/capsules/<run-id> --task task-1 --all
```
