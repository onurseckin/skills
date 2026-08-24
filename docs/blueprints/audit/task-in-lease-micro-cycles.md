# Architectural Audit: Task In-Lease Micro-Cycles

## Target File(s)
- `olt/scripts/src/workflow/review/micro-cycle.ts`
- `olt/scripts/src/cli/commands/task-reject.ts`

## Things to Look For Count
- **Micro-cycle iterations:** Up to 3 bounded attempts.
- **Micro-cycle flags:** `--micro-cycle`, `--in-lease`
- **Role boundaries:** Implementer vs. Validator responsibilities.

## What's Happening Here
When an Implementer completes a write task, it undergoes validation. If the Validator finds issues, a 1-Hop Micro-Cycle is triggered.
- **What calls what:** The Validator issues a `task:reject --in-lease`. This triggers the `micro-cycle.ts` engine, sending the task back directly to the active Implementer without tearing down the workspace or lease.
- **Autonomous Loop Mechanics:** The Implementer addresses the feedback, verifies it locally (file-scoped tests), and resubmits. If it exceeds 3 bounds, it escalates to formal repair via the Coordinator.
- **Native Host Tool Interaction:** No new `invoke_subagent` calls are made during the micro-cycle; communication happens via direct agent messaging (`send_message`).

## LLM Friction Points & Implicit Assumptions
- **Friction Point:** The Validator might try to execute the fix itself instead of returning feedback (violating the Zero Command hard-lock on Cognitive Validators).
- **Friction Point:** The Implementer might lose context of its disjoint write scope and try to modify files outside its lease to fix a failing test.
- **Friction Point:** The LLM might tear down the lease unnecessarily for a trivial 1-line syntax error.

## Concrete Simplification & Improvement Blueprint
1. **Strict 1-Hop Constraint:** The `task:reject --in-lease` command must structurally lock the Implementer to only edit files within its previously assigned `write_scope`.
2. **Validator Command Lockout:** Reinforce the `can_execute_shell: false` rule mechanically so the Validator is physically incapable of running fix commands.
3. **Fast Incremental Verification:** The Implementer must automatically use `task:check` for fast AST/typecheck validation before resubmitting the micro-cycle.
