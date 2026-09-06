# Hardened Validation Contracts & CLI Ergonomics

This document details the hardened operational contracts for implementer submissions, cognitive reviews, CLI flag aliasing, and critic verification in OLT.

## 1. Cognitive Validator Detached Evidence Resolution

### The Problem

Cognitive Validators have `can_execute_shell: false` (Hard Rule 31: 0 commands). Previously, when a task carried a mandatory gate, validators had no way to cite gate proof without executing shell commands or triggering RBAC lockout violations.

### The Contract

`task:review` introduces detached evidence resolution through `resolveCheckIds` and `gateProofCommand`:

1. **Explicit Detached Evidence**:

   ```bash
   bun harness.ts task:review \
     --run .olt/capsules/<run-id> \
     --task <task-id> \
     --validator <validator-id> \
     --token <token> \
     --evidence <implementer-command-id> \
     --resolve <probe-finding-id>=<implementer-command-id> \
     --status pass \
     --summary "Verified gate proof from implementer command receipt"
   ```

   The validator names the implementer's recorded gate command ID. The harness validates that the command exists and belongs to `<task-id>`.

2. **Automatic Gate Proof Fallback**:
   If `--evidence` is omitted during a passing review (`--status pass`), the harness automatically scans `state.commands` for commands where:
   - `c.task_id === taskId`
   - `c.status === "succeeded"`
   - `c.exit_code === 0`
   - `c.gate_id !== null` or `commandMatchesGate(c, gate)`
     If a matching implementer gate command exists, it is auto-bound to `checkIds`. Zero validator shell commands are executed.

## 2. Implementer Submission Checks Reconciliation

### The Problem

Implementers submitting completed work (`task:submit`) frequently hit `cannot determine checks for <task>` when:

- Commands were recorded under a host runner identity rather than the agent ID.
- Tasks had no gate defined (documentation, planning, configuration).
- Fast-track or repair work needed to bypass command checks.

### The Contract

`buildSubmissionReport.ts` (`resolveChecks`) implements a three-tier reconciliation policy:

1. **Exact Agent Match**: Prioritizes commands where `c.task_id === task.id` and `c.actor === agentId`.
2. **Actor Variance Fallback**: If no exact actor match exists, falls back to any command where `c.task_id === task.id` and `c.exit_code === 0`.
3. **Empty Gate Auto-Bypass**: If no commands exist and the task's gate is empty (null, undefined, `""`, `[]`, or `{}`), returns empty check list with `agent_reported` evidence class instead of throwing an error.
4. **Explicit Skip Flags**: Passing `--skip-checks` or `--no-checks` cleanly skips check determination:
   ```bash
   bun harness.ts task:submit \
     --run .olt/capsules/<run-id> \
     --task <task-id> \
     --agent <agent-id> \
     --token <lease-token> \
     --skip-checks \
     --summary "Updated documentation"
   ```

## 3. Universal CLI Flag Aliasing & Ergonomics

`olt/scripts/src/cli/execute.ts` performs pre-parsing flag canonicalization:

| Primary Flag      | Accepted Aliases          | Scope                                                                     |
| :---------------- | :------------------------ | :------------------------------------------------------------------------ |
| `--run`           | `--capsule`, `--run-id`   | Universal across all commands accepting run context.                      |
| `--actor`         | `--agent`, `--agent-id`   | Universal across all commands accepting acting identities.                |
| `task:list --run` | `task:list --capsule`     | Queries and formats tasks directly from active capsule state.             |
| `--queue-path`    | Auto-derived from `--run` | When `--run` is passed to queue commands, resolves capsule `tasks.jsonl`. |

## 4. Critic Token Auto-Hydration

`critic:review` and `critic:reject` automatically hydrate critic assignment metadata and authentication tokens:

- **Packet Token Auto-Hydration**: When `--token` is omitted, the runtime loads the token directly from the published role packet in the capsule via `loadCriticRolePacket(run)`.
- **Packet Ledger Binding**: Resolves `state.completion_critic` and `state.packets` directly from capsule state.
- **Repository Evidence Auto-Discovery**: Binds authoritative run-level repository gate commands (`packet.repository_command_ids`).
- **Cryptographic Verification**: Verifies cryptographic token digests (`critic_token_digest`), preventing token loss or drift across context switches.

## 5. Non-Blocking Defect Logging

Harness execution errors and forensic discoveries automatically invoke `recordKeyedDefect` to append deduplicated records into `.olt/defects.jsonl` under cross-process `flock` locks without blocking command failure propagation or parent loop resumption.
