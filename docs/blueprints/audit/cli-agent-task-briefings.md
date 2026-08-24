# CLI Layer Architecture Audit: Cli Agent Task Briefings

**Target Files:** commands/agent-brief.ts, commands/task-brief.ts, commands/task-finding-input.ts
**Things to Look For Count:** 3

## What's Happening Here
Based on the code structure, the CLI routing uses `execute.ts` -> `registry/index.ts` -> command handlers. The engine parses arguments manually, enforces mandatory flags, and runs `CumulativePhaseInvariantEngine.verify()` to ensure state machine compliance.
Zero-JSON CLI Surface is enforced by the output formatting, returning markdown or structured concise strings rather than raw JSON (except when explicit like `state.json` or `.olt/` updates).
Native host tools: Commands execute sub-processes or directly mutate files, surfacing results through succinct markdown.
Data persistence: CLI commands directly mutate `.olt/capsules/<run>/`, `events.jsonl`, `state.json`, `TASK_QUEUE.jsonl` using shared engine stores.

## LLM Friction Points & Implicit Assumptions
- Implicit dependencies between flags (e.g. `--run` vs `--run-id`).
- Errors are thrown as `HarnessError` which might get stringified into large stack traces if not caught properly by the LLM runner.
- The `CumulativePhaseInvariantEngine` restricts command execution strictly based on `.olt/capsules/<run>/state.json`, which can confuse an LLM if it doesn't understand the prerequisite phases.
- Output parsing assumes markdown structures <= 30 lines but some diagnostic dumps can breach this.

## Concrete Simplification & Improvement Blueprint
1. Consolidate aliased flags (`--run` vs `--run-id`) and centralize standard flags in a shared taxonomy.
2. Improve `HarnessError` formatting to guarantee `Error: <msg>` without stack traces for LLM visibility.
3. Group related commands into simpler namespaces and reduce flag redundancy.
4. Add explicit JSON output guardrails to prevent large object leakage into stdout.