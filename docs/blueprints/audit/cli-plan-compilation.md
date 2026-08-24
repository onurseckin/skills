# CLI Audit Blueprint: `plan-compile.ts`

## 1. Overview & Metrics

- **File**: `olt/scripts/src/cli/commands/plan-compile.ts`
- **Total "Things to Look For" Count**: 14 (5 Failure Vectors, 4 Edge Cases, 2 State Transitions, 3 Optimization Opportunities)

## 2. Call Graph & Flag Routing Mechanics

### Flags Routing
- `--run`: Parsed via `textFlag(flags, "run")`. Fails if omitted.
- `--actor`: Parsed via `actorFlag(flags)`.
- `--completion-gate`: Parsed via `textFlag(flags, "completion-gate")` and evaluated by `parseGateArgv()`.
- `--accept-audit`: Parsed via `listFlag(flags, "accept-audit")` and mapped through `parseAuditAcceptance`.

### Execution Call Graph
1. `loadRun(run)`
2. `hasBrainstormingExecuted(loaded, run)`
3. `analyzeScopeIndependence(...)`
4. `recordPlanAudit(...)` -> `blockingFindings()`, `advisoryFindings()`
5. `recordAuditAcceptance(...)` (if exceptions provided)
6. `analyzeTopologyDeclaration(...)` -> `assertTopologyJustified(...)`
7. `compileRequirementsFromPrompt(...)`
8. `compileGraphDocument(...)`
9. `dependencyData(...)`
10. `transact(run, actor, "plan-compiled", ...)` -> `guardPlanRevision(...)`, `projectPlan(...)`
11. `getHarnessConfig(...)` -> `recordTopology(...)`
12. `provisionWorktrees(...)`
13. `formatPlanCompileBrief(...)`
14. `compilePlanMarkdown(...)`
15. `executeDagViewCommand(...)`
16. FS Writes: `plan.md`, `dag.txt`, `requirements.jsonl`

## 3. Zero-JSON CLI Surface Evaluation

**Line-by-line evaluation for raw JSON leaks and >30 line outputs**:
- **Line 244-245**: `executeDagViewCommand` produces `dagReport.ascii_dag`. If this ASCII DAG exceeds 30 lines, it could flood the console if printed, but here it is explicitly written to `dag.txt`, preserving the zero-JSON terminal rule.
- **Line 258-276**: The command returns a heavily nested JavaScript object containing raw arrays (`topology_declaration.edges`, `warnings`), state metrics, and the full `markdown` brief.
  - **Risk**: If the surrounding CLI runner prints the return value natively (e.g. `console.log(result)`), it **will leak raw JSON** and easily exceed 30 lines. 
  - **Mitigation**: The command should strictly rely on standard formatters and perhaps return a string (the Markdown) or rely on a generic wrapper that knows to pluck `.markdown` and suppress the rest unless `--json` is explicitly passed.

## 4. Native Host Tool Interaction & LLM Mechanics

- **Error Formatting**: Most errors are thrown as `HarnessError` with explicit prefixes (e.g., `INVALID_ARGUMENT`, `INVALID_STATE`). This provides clear semantic clues to LLMs (e.g., `[MANDATORY_PLAN_STEP_SKIPPED]`).
- **Audit Acceptances**: The interaction mechanism for overriding audit blockers requires LLMs to parse the blocker ID and rerun with `--accept-audit <id>:<reason>`. This creates a tight feedback loop for intelligent agents.

## 5. Edge Cases, Flag Collisions, and Discrepancies

1. **Hardcoded Revision Bug (Critical)**: On Line 168, `nextRevision` is dynamically calculated (`currentGraph.revision + 1`). However, on Line 218 (`formatPlanCompileBrief({ revision: 1 ... })`) and Line 261 (`revision: 1`), it is completely hardcoded to `1`. This will desynchronize the UI and the returned data from the actual state.
2. **Missing `prompt` Validation**: On Line 115, `promptText(loaded.prompt)` assumes `loaded.prompt` is a strictly valid `Uint8Array`. If `prompt` is undefined, `TextDecoder` will throw an unhandled `TypeError`.
3. **Blind Cast of `planning_buffer`**: On Line 116-117, `rawBuffer` is blindly cast to `TaskDeclaration[]`. If the stored buffer contains malformed objects, it will corrupt downstream scope analysis.
4. **Scope Collision Sub-optimal Reporting**: On Line 122, if multiple scope collisions occur, only the *first* one is thrown in the error message, hiding the rest from the LLM and requiring multi-step iterative fixes.
5. **Requirements File Extra Newline**: On Line 254, joining an empty array and appending `(reqLines ? "\n" : "")` leaves edge cases where empty requirements create structurally empty files.
6. **Duplicated Event Scanning**: `hasBrainstormingExecuted` manually iterates over `loaded.events` and then again over `state.events` with verbose type guards.

## 6. TypeScript Refactoring Blueprints & Consolidation

- **Refactor `hasBrainstormingExecuted`**: Consolidate the type-casting mess into a single schema-validated lookup or leverage a helper like `findEvent(loaded, "plan-brainstormed")`.
- **Address Hardcoded Revision**: Plumb `nextRevision` into `formatPlanCompileBrief` and the returned payload.
- **Batch Error Accumulation for Scope**: Collect all scope collisions and throw them as a multi-line formatted string so LLMs can fix all bounding paths in one replan iteration.
- **Strict Validation**: Run `loaded.state.planning_buffer` through a Zod schema or strict type validator before assigning to `TaskDeclaration[]`.