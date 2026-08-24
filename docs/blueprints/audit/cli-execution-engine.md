# CLI Execution Engine Audit Blueprint

## Overview
This document represents an exhaustive, unconstrained deep code audit of the CLI execution engine for the `olt` project, specifically analyzing:
- `olt/scripts/src/cli/execute.ts`
- `olt/scripts/src/cli/arguments.ts` (mapped from `args.ts`)
- `olt/scripts/src/cli/output-format.ts` (mapped from `output.ts`)

## Exact "Things to Look For" Count: 9

### Findings & Failure Vectors

1. **`arguments.ts`: Strict POSIX Flag Rejection**
   The regex `^[a-z][a-z0-9-]*$` explicitly rejects single-hyphen flags (`-v`, `-h`). All tokens must start with `--`. Furthermore, single-letter flags (e.g. `--r`) are permitted by the regex, but the parser's logic `token.slice(2)` expects standard long-flag inputs, causing friction with typical UNIX CLI standards.

2. **`arguments.ts`: Positional Argument Swallow / Crash**
   If `shapes` is undefined (i.e. unregistered command), `consumesFollowing` falls back to `ALWAYS_VALUED.includes(name)`. Any other flag assumes it takes no value. If a user supplies `--unknown-flag value`, `value` is treated as an unexpected positional argument and crashes the parser.

3. **`output-format.ts`: Inconsistent Flag Stripping (`--format`)**
   The function `stripOutputFormat` attempts to isolate formatting directives before actual parsing.
   - If a user passes `--format json`, it strips both tokens and sets `json: true`.
   - If a user passes `--format text`, it strips both tokens and sets `json: false`.
   - If a user passes `--format=json`, it strips it and sets `json: true`.
   - **BUG**: If a user passes `--format=text`, it does **NOT** strip it because the condition explicitly filters out only `--format=json` and exact `--format`. This leaks `--format=text` into the downstream execution engine.

4. **`execute.ts`: Hardcoded Command Short-circuit**
   `resolveCommandSpec` intercepts `plan:brainstorm` and `brainstorm` strings directly, returning `PLAN_BRAINSTORM_SPEC` instead of relying on the standard dynamic `findCommand` registry. This creates an unscalable anti-pattern for command registration.

5. **`execute.ts`: Redundant Required Flag Verification**
   The execution loop iterates over `spec.flags` to populate default identity parameters (like `agent`, `actor`). It then calls `assertFlags(...)` but proceeds to re-scan `spec.flags.find((flag) => flag.required && !Object.hasOwn(parsed.flags, flag.name))` and manually throws a `HarnessError` if missing. The dual-validation pass is unnecessary.

6. **`execute.ts`: `CumulativePhaseInvariantEngine` Rigid State Transition**
   The deductive state machine tightly couples CLI logic to domain-specific state representations (e.g., checking `this.state.requirements` for the `"plan"` phase). This violates separation of concerns. If the state schema evolves, the CLI engine will crash unexpectedly with state invariant errors.

7. **`execute.ts`: Silent Invariant Engine Fallback**
   In `execute.ts`, if `loadRun(runRoot, false)` throws a non-`INVALID_STATE` error, it is caught and it executes `CumulativePhaseInvariantEngine.verify(spec, {});` with an empty state. If the spec requires prerequisites, this guarantees a failure rather than bubbling up the original underlying load error.

8. **`arguments.ts`: Levenshtein Distance Performance Edge Case**
   The algorithm for suggesting nearest flags calculates `levenshteinDistance` for all candidates. If the candidate registry grows significantly (e.g., hundreds of flags across a monorepo), an invalid flag trigger causes a complete matrix computation, creating a small but present performance bottleneck.

9. **`output-format.ts`: Pre-Boundary Eagerness**
   The check for formatting limits itself to before the `--` boundary via `const end = boundary === -1 ? argv.length : boundary`. However, `Array.prototype.some` and `filter` continue scanning; it simply disables the check via `index < end`. This works, but is less optimal than slicing the array prior to scanning.

## Comprehensive Call Graph & Flag Routing Mechanics

1. **Bootstrap (`output-format.ts`)**
   - Host tool calls CLI.
   - `stripOutputFormat(argv)` intercepts the raw arguments, extracts `--format=json` or `--format json`, and returns a stripped `argv` array alongside a `json` boolean.
2. **Command Resolution (`execute.ts`)**
   - `argv[0]` is matched in `resolveCommandSpec`. Short-circuits for `plan:brainstorm`, otherwise polls registry.
3. **Parsing (`arguments.ts`)**
   - `parseArguments` splits remainder arguments via `--` delimiter.
   - Converts boolean and value-based flags based on `FlagShapes`.
4. **Validation & State Check (`execute.ts`)**
   - Injects default agent/actor identities.
   - Validates required flags.
   - Triggers `CumulativePhaseInvariantEngine` if a `--run` state is passed, validating sequential execution invariants (plan -> queue -> task -> critic -> run).
5. **Execution**
   - Dispatches to `spec.handler`.
   - Returns a `JsonObject`.

## Zero-JSON CLI Surface Evaluation
- **Raw JSON Leaks**: High risk in `execute.ts` where `return (await spec.handler(...)) as JsonObject` is cast. If the host tool directly stringifies this return without checking the `json` boolean derived from `output-format.ts`, any command will vomit raw JSON objects.
- **Error Formatting**: `HarnessError` instances propagate upwards. If the global unhandled exception catcher does not respect the `OutputFormatScan.json` flag, it will either leak JSON errors into a text stream or text traces into a JSON parser.
- **Length Constraint (30 Lines)**: The help generation (noted as `run harness.ts help` inside `arguments.ts`) and suggested flag format alternatives (`formatAlternatives`) are safe text paths. However, the JSON output path for commands like `plan:brainstorm` can output hundreds of lines. We must ensure the `stdout` buffer is paginated or routed to files.

## Native Host Tool Interaction
- **LLM Command Parsing**: The parser explicitly blocks positional arguments unless they are safely encapsulated behind `--`. When LLMs try to interact using traditional patterns like `bun harness.ts command my-file.txt`, it will crash. LLMs must be instructed to either use `--my-file my-file.txt` or place it after `--`.
- **Error Messages for LLMs**: The errors from `parseArguments` are well-formed for LLM agents, providing explicit `hints` like: `"prefix it with -- to name a flag, or move it after a literal --"`.

## Concrete TypeScript Refactoring Blueprints

### 1. Command Consolidation (Dynamic Registry)
Remove the hardcoded `plan:brainstorm` block in `execute.ts`:
```typescript
function resolveCommandSpec(invocation: string): CommandSpec | undefined {
  return findCommand(invocation); // Register brainstorm dynamically within the registry folder
}
```

### 2. Output Format Fix
Fix the strict mismatch in `output-format.ts` to consistently filter `--format=*`:
```typescript
const filtered = argv.filter((arg, index) => {
  if (index >= end) return true;
  if (arg.startsWith("--format=")) return false;
  if (arg === "--format" || (index > 0 && argv[index - 1] === "--format")) return false;
  return true;
});
```

### 3. Argument Parsing Relaxation
Allow raw positional strings if explicitly opted-in by the command spec (e.g. `spec.takesPositional`), bypassing the strict `--` delimiter requirement, enabling a more robust LLM-to-CLI interface.