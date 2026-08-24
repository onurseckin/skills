# CLI Plan Compilation & DAG Audit

## 1. Executive Summary & Assessment
This audit reviews the CLI plan compilation routing (`plan-compile.ts`, `plan-apply.ts`), DAG visualizations (`dag.ts`, `dag-view.ts`), and related components against the Canonical Agent Operating Directives (AGENTS.md).

**Current Live Code Verification Assessment:**
The code structure heavily supports autonomous plan execution and wave topological sorting. However, there are discrepancies in output limit enforcement. While `dag.ts` enforces the canonical 30-line limit for markdown briefs, `dag-view.ts` violates this constraint by allowing up to 80 lines, contradicting Rule #10. Both CLI modules generate structured objects that include rich JSON data alongside the `markdown` brief, which relies on the outer CLI shell to enforce the Zero-JSON output requirement.

## 2. Unconstrained Finding Count
- **dag-view.ts Line Limit Violation**: `dag-view.ts` uses `enforceLineLimit(fullMarkdown, 80)` instead of the canonical 30 lines.
- **Mixed Return Signatures**: Command implementations (e.g. `dagViewCommand`, `planCompileCommand`) return hybrid Record/JSON payloads alongside `markdown`. If the CLI outer layer fails to drop the JSON payload, it will violate the Zero-JSON CLI Surface rule.
- **Total Defect Count**: 1 major enforcement violation (80-line limit), 1 architectural risk (return objects containing raw JSON rather than exclusively formatted markdown or strictly relying on `harness.ts` to unwrap and print only `markdown`).

## 3. Flag Routing Mechanics
- The entry points `executeDagRenderCommand` / `executeDagViewCommand` accept either a string array (`argv`) or a pre-parsed `Flags` object.
- If a string array is passed, `parseArguments` is used to convert it into `Flags`.
- Commands extract specific flags using strictly typed helpers: `boolFlag(flags, "detailed")`, `textFlag(flags, "run")`, `integerFlag(flags, "from-seq")`, `actorFlag(flags)`.
- Options like `--all` bypass the `enforceLineLimit` constraints, rendering the full un-truncated markdown block (e.g., `showAll ? report.markdown : enforceLineLimit(...)`).

## 4. Call Graphs

### plan-compile.ts (`planCompileCommand`)
1. Parses flags, validates state (e.g., `hasBrainstormingExecuted`).
2. Checks scope collisions (`analyzeScopeIndependence`).
3. Executes plan audit constraints (`recordPlanAudit`).
4. Compiles requirements (`compileRequirementsFromPrompt`).
5. Generates the graph document and resolves dependencies (`compileGraphDocument`, `dependencyData`).
6. Applies ledger transactions and writes to persistent state (`guardPlanRevision`, `projectPlan`, `recordTopology`).
7. Initializes isolated branch structures for parallel lanes (`provisionWorktrees`).
8. Invokes `executeDagViewCommand` to write `dag.txt` to the planning directory.
9. Returns a structured JSON result wrapping `markdown`.

### dag.ts (`dagRenderCommand` / `dagTraceCommand`)
1. Resolves capsule run contexts (`resolveCapsuleRun`, `loadRun`).
2. Extracts scheduling metrics (`schedulingMetrics`).
3. Formats topological graph representations (`buildSugiyamaDagReport` / `buildLivingTracerReport`).
4. Constrains output (`enforceLineLimit(report.markdown, 30)`).

### dag-view.ts (`dagViewCommand`)
1. Evaluates parallelization potential via Brent Work/Span topologies (`computeTopologicalWaves`, `analyzeParallelization`).
2. Checks for write-scope conflicts and identifies overlapping constraints (`analyzeDependencyForensics`, `analyzeSerialization`).
3. Looks for multi-coordinator subsystem splits (`analyzeMultiCoordinatorOpportunities`).
4. Assembles an exhaustive markdown report string (`renderAsciiDag`).
5. Implements line limiting with a non-compliant threshold (`enforceLineLimit(fullMarkdown, 80)`).

## 5. Zero-JSON Compliance Status
- **Rule 10 (Zero-JSON CLI Surface)** dictates that agents interact with the harness exclusively through clean colon commands and receive concise, structured markdown briefs ($\le 30$ lines).
- **Compliance in Code**: The internal methods return an object `Record<string, unknown>` that includes both the formatted `markdown` field and raw JSON execution context (`run_root`, `metrics`, `topology`, `active_agents`, etc.). 
- **Conclusion**: The inner logic is technically JSON-heavy. Compliance relies entirely on the outer harness shell script (`harness.ts shell`) extracting the `markdown` field and discarding the JSON object when printing to standard output. If an agent executes `dag:view` or `plan:compile` and the wrapper does not strictly extract `.markdown`, the agent will be bombarded with the raw JSON objects, leading to token exhaustion.
