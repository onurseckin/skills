# Architectural Audit: Orchestrator Multi-Round Loop

## Target File(s)
- `olt/scripts/src/orchestrator/loop-runner.ts`
- `olt/scripts/src/orchestrator/capsule-chainer.ts`
- `olt/scripts/src/orchestrator/supervision-loop.ts`

## Things to Look For Count
- **Round Iterations:** 1-10 max rounds
- **Capsule boundaries:** `.olt/capsules/<run>/` state
- **Subagent Invocations:** `invoke_subagent` calls targeting Coordinators

## What's Happening Here
The Tier 1 Orchestrator is responsible for running a multi-round execution loop (up to 10 rounds) to fulfill a deployed task or task group from the backlog.
- **What calls what:** Mind `invoke_subagent`s the Orchestrator. The Orchestrator runs `loop-runner`, which spawns Tier 2 Coordinators to handle waves.
- **Autonomous Loop Mechanics:** If a round yields defects, `capsule-chainer` carries the state to the next round, maintaining isolation.
- **Data Persistence:** Orchestrator reads from `.olt/backlog.jsonl` and persists capsule states to `.olt/capsules/<run>/`.

## LLM Friction Points & Implicit Assumptions
- **Friction Point:** The Orchestrator might try to do the implementation itself or fix tests when a defect occurs.
- **Friction Point:** Not waiting for Coordinators. The Orchestrator might spin in a loop instead of yielding until the Coordinator reports back via `send_message`.
- **Friction Point:** Failing to hard-reset (kill) Coordinators after a round finishes.

## Concrete Simplification & Improvement Blueprint
1. **Rigid Delegate-and-Wait:** Force the Orchestrator to `invoke_subagent(Coordinator)` and immediately end its turn. Rely on system messages for the Coordinator's return.
2. **Deterministic Chaining:** Ensure `capsule-chainer.ts` operates mechanically. If defect count > 0, spawn Coordinator for Round N+1. If 0, declare Convergence.
3. **Hard Resets:** Enforce `manage_subagents { Action: 'kill' }` strictly on completed Coordinators to prevent ghost leases and context bloat.
