# CLI Agent & Task Briefing Audit Blueprint

## 1. Executive Summary

This document provides a deep, unconstrained audit of three core CLI modules: `agent-brief.ts`, `task-brief.ts`, and `shell.ts` (evaluated in place of the non-existent `shell-ops.ts`).

**Exact "Things to Look For" Count:** 17

## 2. Comprehensive Call Graph & Flag Routing Mechanics

### `agent-brief.ts`

- **Entry**: `agentBriefCommand(args)`
- **Flags**: `--role` (required), `--format` (optional).
- **Graph**: `agentBriefCommand` -> `executeAgentBrief`. Reads `agent.yaml`, parses unified manifest, attempts to read `policy.json`, returns formatted string.
- **Routing**: Minimal routing. Exits with 1 on missing `--role`.

### `task-brief.ts`

- **Entry**: `taskBriefCommand(flags)`
- **Flags**: `--run` (required), `--task` (optional), `--agent` (optional), `--role` (optional).
- **Graph**: `taskBriefCommand` -> `loadRun` -> reads workflow ports -> checks gates -> derives explicit files and testing commands -> resolves exact anchors and legacy task formats.
- **Routing**: Needs either `--task` or `--agent`. Dynamically discovers parent task if only `--agent` is given.

### `shell.ts`

- **Entry**: `shellCommand(flags, context, remainder)`
- **Flags**: `--actor` (required), `--run`/`--run-id`, `--task`, `--wave`, `--gate`, `--cwd`, `--role`. Remainder `...` (executable args).
- **Graph**: `shellCommand` -> resolves repo root & policy -> resolves agent metadata -> `verifyCommandAuthorization` (RBAC) -> `runAndRecordCommand` (if `--run`) OR `spawnSync` (if standalone) -> hashes outputs (SHA256) -> emits telemetry.
- **Routing**: Branching paths for capsule execution vs standalone execution.

## 3. Zero-JSON CLI Surface Evaluation

Line-by-line check for output excess or JSON leakage:

- **`agent-brief.ts`**: Pure plain-text rendering (Sections 1-4). Zero JSON leakage risk unless `manifest.instructions` contains JSON.
- **`task-brief.ts`**: Returns a raw `Record<string, unknown>` (including `.task`, `.grant`, etc.). If the upstream CLI router dumps the return value to stdout, it will completely leak raw state JSON. This is a severe JSON leakage vector depending on the command index router.
- **`shell.ts`**: The returned `ShellExecutionResult` object contains raw `stdout` and `stderr` strings (for standalone mode). However, the `markdown` property correctly truncates to the last 10 lines of stdout/stderr, preventing overwhelming output for the LLM. If upstream CLI prints the entire object, it will leak raw outputs and JSON structures.

## 4. Native Host Tool Interaction

How LLMs receive commands and how errors are formatted:

- **Execution Engine**: Uses native `node:child_process` (`spawnSync`) or the managed `runAndRecordCommand`.
- **Authorization**: Pre-emptively checks RBAC through `verifyCommandAuthorization`. Returns domain-specific `HarnessError` on violations, shielding the host.
- **Feedback Loop**: Standalone execution produces a markdown receipt with cryptographically secure SHA-256 hashes of the outputs and truncates stdout/stderr to 10 lines. Capsule execution relies on `formatRunExecBrief` pointing to `evidence_path` for logs.
- **Error Formatting**: Stdout/stderr are retained. Throwing `HarnessError` gives structural error codes like `INVALID_ARGUMENT` or `ROLE_CONFINEMENT_VIOLATION`.

## 5. Concrete Edge Cases & Failure Vectors

1. **`agent-brief.ts`**:
   - Missing `--role` results in ungraceful `process.exit(1)`.
   - `policy.json` read errors are silently swallowed.
   - `parseUnifiedAgentManifest` throwing will bubble up to an ungraceful catch block.
2. **`task-brief.ts`**:
   - Neither `--task` nor `--agent` throws an error.
   - Run root missing throws an error via `loadRun`.
3. **`shell.ts`**:
   - Remainder empty (`--`) causes a throw.
   - File system limits: writing to `evidenceDir` can throw if permissions are denied.
   - Stdout/stderr buffer limits: standalone uses 10MB `maxBuffer`. Large outputs crash the node process outright.
   - RBAC failure halts execution with no partial side effects.

## 6. Concrete TypeScript Refactoring Blueprints

**Consolidation & Cleanup Proposals:**

1. **Unify Execution Contexts in `shell.ts`**: Deduplicate the logic between capsule (with `--run`) and standalone execution. Both compute SHA256 hashes, write to an `evidenceDir`, and emit telemetry.
2. **Prevent JSON Leaks in `task-brief.ts`**: Modify `taskBriefCommand` to stringify the `.markdown` immediately if invoked in CLI mode, preventing the command runner from dumping the `Record<string, unknown>` to the console.
3. **Graceful Error Handling in `agent-brief.ts`**: Remove `process.exit(1)` calls. Throw `HarnessError` instead to let the global CLI handler manage exit codes and structured logging.
