# CLI Task Queue Lifecycle Audit Blueprint

## 1. Executive Summary

This document provides a comprehensive deep code audit of the Task Queue, Mind Pulse, Orchestrator, Critic, Memory, and Branch operations within the `olt/scripts/src/cli/commands` directory.

**Exact "Things to Look For" Count: 44**

## 2. Comprehensive Call Graph and Flag Routing Mechanics

### `todo-ops.ts` (Mind Queue)

- **Commands**: `list`, `add`, `drain`, `seal`, `clean`
- **Routing**: Aliased to `mindQueue*` commands.
- **Mechanics**: Reads/writes to a JSON ledger for feedback queues. Uses `resolveFeedbackQueuePath` and `resolveCompletedTasksLedgerPath`.

### `mind-pulse.ts` (Mind Pulse)

- **Commands**: `mindPulseCommand`
- **Routing**: Computes cognitive telemetry, calculates budget, assesses topological waves (lanes), and transacts `mind-pulse-opened`.

### `orchestrator-ops.ts` (Orchestrator)

- **Commands**: `run`, `supervise` (`tick`)
- **Routing**: `run` relies on `AutonomousLoopRunner`. `supervise` leverages `RunSupervisor` and optionally `runSupervisionWatch` for daemon mode.

### `critic-ops.ts` (Critic)

- **Commands**: `start`, `review`, `reject`, `remediate`
- **Routing**: Integrates deeply with `workflowPort(run)` to validate completeness.

### `memory-ops.ts` (Memory)

- **Commands**: `query`
- **Routing**: Dispatches to `searchMemory` building an ephemeral index of capsule files.

### `branch-ops.ts` (Branching)

- **Commands**: `open`, `claim`, `submit`, `collect`, `abandon`, `status`
- **Routing**: Custom sub-task string parsing (`id=value`). Calls `workflow/branch/*`.

## 3. Zero-JSON CLI Surface Evaluation

The CLI framework uses a pattern of returning dual-purpose objects `(markdown: string, ...rawData)`.

- **`todo-ops.ts`**: Safely bound by `enforceLineLimit` (limits range from 25 to 30 lines).
- **`mind-pulse.ts`**: Returns `MindPulseResult`. Limits output to 35 lines via `enforceLineLimit`.
- **`orchestrator-ops.ts`**: Output bound heavily depends on `formatMorningReportMarkdown` and `AutonomousLoopRunner`'s markdown summaries. **Risk**: High likelihood of exceeding 30 lines if the morning report is extensive. No inline `enforceLineLimit`.
- **`critic-ops.ts`**: Only `criticRemediateCommand` uses `enforceLineLimit(30)`. Others rely on `formatCritic*` functions.
- **`memory-ops.ts`**: Relies on `formatMemoryQueryBrief`.
- **`branch-ops.ts`**: Relies on `formatBranch*` formatters.

## 4. Native Host Tool Interaction

- Errors are consistently thrown as `HarnessError("INVALID_STATE", ...)`.
- Many error messages embed explicit **LLM steering instructions**, e.g., `Outcome: halted. Next: human inspection required.` or `Next: assign a fresh completeness critic with critic:start.`

## 5. Concrete List of Edge Cases, Flag Collisions, and Parameter Discrepancies

### Flag Collisions / Aliases (17 identified)

1. `todo-ops`: `queue-file` vs `queue-path`.
2. `todo-ops`: `content` vs `description` vs `content` (redundant check).
3. `todo-ops`: `archive-file` vs `completed-file`.
4. `todo-ops`: `resolution` vs `note` vs `summary` vs `resolution`.
5. `mind-pulse`: `now` overrides clock if provided.
6. `orchestrator-ops`: `run-id` vs `run`.
7. `orchestrator-ops`: `prompt` vs `prompt-file` vs `prompt-stdin`.
8. `orchestrator-ops`: `max-parallel` vs `gate-max-parallel`.
9. `critic-ops`: `findings` vs `findings-file`.
10. `critic-ops`: `proofs` vs `proofs-file`.
11. `critic-ops`: `resolution-method` paired implicitly with `resolve`.
12. `memory-ops`: `query` as flag vs inline argument.
13. `memory-ops`: `generation` vs `gen`.
14. `memory-ops`: `tags` vs `tag`.
15. `branch-ops`: `sub-task`, `sub-label`, `sub-scope`, `sub-gate` lists must correctly align.

### Edge Cases (12 identified)

1. `mind-pulse`: Missing charter file triggers a hard halt.
2. `mind-pulse`: Event sequence > 100,000 threshold halt.
3. `mind-pulse`: Open pulse past its deadline requires reclaim.
4. `orchestrator-ops`: Missing host-injected executor prevents `run`.
5. `critic-ops`: Superficial approval (`lgtm`, `looks good`) triggers rejection.
6. `critic-ops`: Approval with findings payload triggers argument error.
7. `critic-ops`: Rejection without finding payload triggers argument error.
8. `branch-ops`: Multi-value grouping for same sub-task throws error on label/scope.

## 6. TypeScript Refactoring Blueprints & Command Consolidation

### Optimization Opportunities (6 identified)

1. **Centralize Alias Resolution**: Extract `resolveFlag([alias1, alias2])` to deduplicate null coalescing in every command.
2. **Unified Output Truncation**: Apply `enforceLineLimit` at the CLI framework router level, rather than ad-hoc within command implementations.
3. **Array Pair Parsing**: `branch-ops.ts` `splitPair` and `groupPairs` logic should be abstracted into an `options.ts` array-tuple parser.
4. **Memory/Capsule Path Discovery**: Standardize `.capsules` discovery between `memory-ops.ts` and `orchestrator-ops.ts`.
5. **Prompt Intake**: Centralize `prompt` vs `prompt-file` vs `stdin` into a single `resolvePromptInput` utility.
6. **Task/Branch Unified State**: Merge parent task status lookup logic to avoid repetitive ad-hoc graph reads.
