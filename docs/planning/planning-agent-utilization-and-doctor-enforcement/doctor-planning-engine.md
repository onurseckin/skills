# Doctor Plan Quality & Planning Agent Utilization Engine

> **Module**: `olt/scripts/src/reporting/doctor/plan-quality-engine.ts`  
> **Diagnostics Key**: `checkPlanQualityAndAgentUtilization`  
> **Consumer**: [`collectDiagnosticEngines`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/diagnostic-collector.ts)

---

## 1. Diagnostic Architecture

The `checkPlanQualityAndAgentUtilization` engine operates as an active health check inside `doctor`. It audits the active run's plan artifact, event log (`events.jsonl`), and grants ledger to verify that plans meet the minimum epistemic context threshold and were properly authored and vetted by planning agents.

```text
┌─────────────────────────────────────────────────────────────────────────┐
│              checkPlanQualityAndAgentUtilization Engine                 │
├─────────────────────────────────────────────────────────────────────────┤
│ 1. Plan Context Depth    ──► Line length, prompt bytes, requirement map │
│ 2. 8-Vector Expansion    ──► plan:brainstorm event presence & vectors   │
│ 3. Epistemic Confidence  ──► evaluatePlanEpistemicReadiness (>= 0.85)   │
│ 4. Granularity Audit     ──► auditPlanGranularity (<=2 sub, <=6 tasks)  │
│ 5. Agent Verification    ──► planner & plan-validator session tokens    │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Flaw Taxonomies & Severity Ratings

| Finding Code                          | Severity | Description                                                                   | Trigger Condition                                                                     |
| :------------------------------------ | :------- | :---------------------------------------------------------------------------- | :------------------------------------------------------------------------------------ |
| `SHALLOW_PLAN_CONTEXT_FLAW`           | `ERROR`  | Plan context is too short or ambiguous to guide deterministic implementation. | Prompt $< 500$ chars, task descriptions $< 100$ chars, or 0 line coordinate mappings. |
| `UNUTILIZED_PLANNING_AGENTS_FLAW`     | `ERROR`  | Plan was created/compiled without engaging Tier 3 `planner`.                  | Zero `planner` session or `plan:enhance` event recorded in `events.jsonl`.            |
| `MISSING_EIGHT_VECTOR_EXPANSION_FLAW` | `ERROR`  | Plan lacks mandatory 8-vector Socratic expansion.                             | Zero `plan:brainstorm` events found for compiled graph revision.                      |
| `MISSING_PLAN_VALIDATOR_AUDIT`        | `ERROR`  | Plan was compiled without adversarial audit from `plan-validator`.            | Zero `plan:review` approval token minted by an independent validator.                 |
| `EPISTEMIC_CONFIDENCE_DEFICIT`        | `WARN`   | Epistemic confidence score below threshold.                                   | `epistemic.confidenceScore < 0.85` or contradictory scope risks detected.             |
| `PLAN_GRANULARITY_VIOLATION`          | `ERROR`  | Monolithic plan or excessive scope per task.                                  | Spans $> 2$ subsystems, $> 6$ tasks, or $> 3$ files per task.                         |

---

## 3. TypeScript Engine Contract

```typescript
export interface PlanQualityCheckOptions {
  readonly runRoot?: string | undefined;
  readonly repoRoot?: string | undefined;
  readonly state?: Readonly<Record<string, unknown>> | null | undefined;
  readonly events?: readonly Readonly<Record<string, unknown>>[] | null | undefined;
}

export function checkPlanQualityAndAgentUtilization(
  options: PlanQualityCheckOptions = {},
): DoctorCheckEngineResult;
```

---

## 4. Remedial Actions & Next Actions Generation

When `doctor` detects planning flaws, [`generateRemedialGuidance`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/reporting/doctor/guidance.ts) outputs immediate actionable CLI commands:

```text
[UNUTILIZED_PLANNING_AGENTS_FLAW] Plan compiled without Tier 3 Planner engagement:
  -> Run: bun harness.ts plan:brainstorm --run <run> --actor planner-1
  -> Run: bun harness.ts plan:enhance --run <run> --actor planner-1

[MISSING_PLAN_VALIDATOR_AUDIT] Plan lacks adversarial review from Plan-Validator:
  -> Run: bun harness.ts plan:validate-start --run <run> --validator val-1
  -> Run: bun harness.ts plan:audit --run <run> --validator val-1
  -> Run: bun harness.ts plan:review --run <run> --status pass --validator val-1

[SHALLOW_PLAN_CONTEXT_FLAW] Plan context depth insufficient:
  -> Run: bun harness.ts plan:enhance --run <run> --deepen-context
```
