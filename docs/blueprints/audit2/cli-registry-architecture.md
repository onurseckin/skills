# CLI Registry Architecture Audit (audit2)

## 1. Unconstrained Finding Count

**Total Registry Modules Analyzed**: 23
**Total Domains Identified**: 18 (`plan`, `queue`, `task`, `reporting`, `run`, `critic`, `summary`, `inspection`, `orchestrator`, `branch`, `agent`, `orphan`, `authority`, `install`, `diagnostics`, `gate`, `capture`, `mind`)
**Primary Routing Files**: `execute.ts`, `registry/index.ts`, `arguments.ts`

## 2. Call Graph & CLI Routing

The CLI routing strictly follows a deterministic execution path from the host argv down to the internal command handlers.

```mermaid
flowchart TD
    A[Raw argv] --> B[execute.ts: execute()]
    B --> C[registry/index.ts: resolveCommandSpec()]
    C --> D[findCommand(invocation)]
    D --> E[CommandSpec Matched]
    E --> F[arguments.ts: parseArguments(argv, flagShapes)]
    F --> G[execute.ts: autoDeriveCallerIdentity()]
    G --> H[execute.ts: CumulativePhaseInvariantEngine.verify()]
    H --> I[CommandSpec.handler(flags, context, remainder)]
    I --> J[src/cli/commands/* (Business Logic)]
```

**Mechanics:**

1. **Resolution**: `execute.ts` intercepts the invocation (with a special case for `plan:brainstorm`) and delegates to `findCommand` inside `registry/index.ts` to retrieve the `CommandSpec`.
2. **Argument Parsing**: It invokes `parseArguments()` leveraging `flagShapes(spec.flags)` to accurately map boolean flags, repeatable flags, and required value flags defined inside the specific domain registry file (e.g., `registry/task.ts`).
3. **Identity Injection**: `autoDeriveCallerIdentity()` automatically populates identity flags (`agent`, `actor`, `validator`, `critic`, `role`) based on session context if they are omitted but required.
4. **Invariant Checking**: The deductive state machine enforces prerequisites before any handler fires.

## 3. Flag Routing Mechanics

Flags are routed completely decoupled from hardcoded yargs-style external libraries, relying on `arguments.ts`:

- **Shape Definitions**: Each command in a registry module (e.g., `task.ts`) explicitly declares its flags via helper functions: `requiredFlag()`, `optionalFlag()`, and `repeatableFlag()`.
- **Lexical Parsing**: `parseArguments` performs a single pass over argv. It detects boolean values, single-string values, and array accumulations for repeatable flags. Double-dash (`--`) splits the `remainder` arguments (e.g., the actual bash command string for `run:exec`).
- **Validation**: `assertFlags` ensures no extraneous flags exist, and a subsequent sweep ensures all required flags are populated.
- **Auto-wiring**: If `run-id` is provided but not `run` (or vice-versa), they alias each other prior to validation.

## 4. Zero-JSON Compliance

The harness adheres to a **Zero-JSON CLI Surface** strategy:

- **Input**: Agents never submit JSON payloads. All configurations, IDs, and parameters are passed via standard UNIX flags (e.g. `--task task-1 --actor worker-1`).
- **Output**: Handlers resolve to structured objects, but `execute.ts` captures harness-level errors and formats them into strict Markdown (`markdown: "**Error (${error.code})**: ${error.message}..."`). This guarantees that LLM agents consume high-signal text/markdown rather than parsing nested JSON structures, reducing context window bloat and eliminating JSON parse errors in agent workflows.

## 5. Native Host Tool Interaction

### How Agents Know Which Commands to Run

Agents do not probe or explore the environment. Instead, they operate under **Zero-Exploration Exact-Anchor Briefings**:

- **Briefing Mechanism**: The `task:brief` command generates a precise, 1-shot briefing.
- **Contents**: The briefing provides the exact assigned write scope, target files, gate commands, and recommended file-scoped test commands (e.g. `bun test <path>`).
- **Execution Paths**:
  - `run:exec`: Captures `argv`, timestamps, `cwd`, exit codes, and log bytes securely into the capsule.
  - `shell` (`exec:safe`): Validates actor role capabilities against repository policy (mechanical RBAC). For instance, it actively blocks Cognitive Validators from running test suites and prevents un-targeted whole-repo test runs by Implementers.

### Role Boundary Watchdog (RBAC)

When an agent attempts to execute a host tool via `run:exec` or `shell`, the CLI checks `assertGrantedCommand()` based on the derived caller identity. The system prevents domain-bleeding (e.g., validators writing code or executing shells).

## 6. Current Live Code Verification Assessment

The CLI embeds a **Cumulative Phase Invariant Engine** directly in `execute.ts`.

- **Deductive State Machine**: Before any command runs, it inspects the loaded run's state JSON.
- **Prerequisites Engine**: It ensures that a command belonging to a downstream phase (e.g. `run:complete`) is blocked unless upstream phases (`plan`, `queue`, `task`, `critic`) are fully populated in the ledger.
- **Integrity**: Any out-of-bounds execution by a misaligned or hallucinating agent is instantaneously mechanically rejected (`INVALID_STATE`), reinforcing structural consistency across the long-task lifecycle.
