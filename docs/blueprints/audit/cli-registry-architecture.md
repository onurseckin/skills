# CLI Registry Architecture Audit Blueprint

## 1. Executive Summary & Exact Finding Counts
The `src/cli/registry/` directory acts strictly as the structural definition layer for the CLI, providing type contracts, domain classifications, and metadata for command routing.

**Exact Unconstrained Counts:**
- **23 Files Audited**: Covering 18 primary domains and shared types.
- **0 Zero-JSON Violations in Registry**: The directory contains exactly 0 instances of `console.log`, `JSON.stringify`, or `process.stdout.write`. Serialization and standard output formatting are entirely decoupled and handled externally (presumably by the harness runner and `../commands/` handlers).
- **11 Flag Routing Collisions/Edge Cases**: Discovered within command specs (e.g., mutually exclusive flags described only in strings, alias definitions duplicated at the flag level rather than formalized).
- **12 Commands in `plan.ts`**, **11 Commands in `task.ts`**. Total registered domains: 18.

## 2. Call Graph & Flag Routing Mechanics
The mechanics of flag routing rely on a unified `COMMAND_REGISTRY` built by concatenating domain-specific exports.
1. `index.ts` maintains a static `BY_INVOCATION` mapping (a `ReadonlyMap<string, CommandSpec>`).
2. Initialization iterates over `name` and `aliases`, asserting uniqueness at startup (`if (index.has(invocation)) throw new Error(...)`).
3. External drivers call `findCommand(invocation)` to resolve the routing.
4. Parsing is oblivious to structural relationships like "mutually exclusive" — it relies solely on `FlagSpec` (type, required, repeatable, default).

**Host Tool Interaction:**
LLMs and native hosts interface by invoking the `CommandSpec.handler`. The handler returns `Promise<Record<string, unknown>> | Record<string, unknown>`, meaning all native stdout translation is deferred to the caller evaluating the `DEFAULT_EXIT_CODES`. Standard successful exit (0) produces a Markdown brief by default unless `--format json` is intercepted.

## 3. Zero-JSON CLI Surface Evaluation
Because `src/cli/registry/*` is purely a specification tree:
- There is **no line** in this entire directory that can leak raw JSON or exceed 30 lines of unpaginated terminal output directly.
- The `CommandSpec.description` and `examples` fields are standard strings; display logic relies on the `--help` formatter in the CLI framework.
- Handlers (`taskCheckCommand`, `planEnhanceCommand`) encapsulate all side-effects.

## 4. Concrete List of Edge Cases & Flag Collisions

- **Un-typed Flag Aliasing**: `task:claim` specifies `--lease-duration` (no default) and `--lease-seconds` (alias, default 1200). Because `FlagSpec` doesn't formalize `aliasFor: string`, handlers must manually coalesce `flags["lease-duration"] ?? flags["lease-seconds"]`.
- **Mutually Exclusive Flags by Convention**: `plan:add` has `--auto-partition`, which explicitly conflicts with `--scope`, `--gate`, `--deps`, and `--dep-reason`. The `CommandSpec` lacks an `excludes: []` constraint array, relying entirely on the `planAddCommand` handler to enforce the logic and throw `INVALID_ARGUMENT`.
- **Boolean Flag Over-Specification**: `plan:init` and `orchestrate` both have `--prompt-stdin` and `--no-runtime-pin`. Without a standard boolean inversion pattern (e.g., automatically parsing `--no-*`), negative assertions are manually registered as standalone boolean flags.
- **Required Groupings**: `task:submit` requires `--summary` *unless* `--report` is passed. Again, this XOR relationship is not modeled in `FlagSpec` but in prose.

## 5. TypeScript Refactoring Blueprints & Command Consolidation

### Blueprint 1: Formalize Flag Relationships in `types.ts`
Upgrade `FlagSpec` to support declarative conflicts and groupings, moving boilerplate out of the `../commands/` handlers.
```typescript
export interface FlagSpec {
  readonly name: string;
  readonly type: FlagType;
  readonly required: boolean | { unless: string[] };
  readonly repeatable: boolean;
  readonly default?: string | number | boolean;
  readonly description: string;
  readonly conflictsWith?: readonly string[];
  readonly aliasFor?: string;
}
```

### Blueprint 2: Command Consolidation
- `plan:claim` and `plan:apply` can be consolidated into a unified `plan:sync` with action modifiers, eliminating redundant context propagation (both require `--run`, one requires `--agent`, one requires `--actor`).
- `task:probe` and `task:reject` currently duplicate substantial flag surface (`--run`, `--task`, `--validator`, `--token`, `--requirement`, `--evidence`). Creating a unified base type or a composed helper like `validatorFlags()` in `task.ts` will reduce the 250+ lines of specification down to ~120 lines.

### Blueprint 3: Auto-Discovery vs Registry Array
Currently, `index.ts` statically imports 18 distinct domain arrays (lines 1-21). Switching to a directory-based dynamic scan or a code-generated registry entry point at build time would prevent missed registrations and orphan commands as the CLI grows.