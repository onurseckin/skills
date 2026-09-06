# Epistemic Plan Context Depth Matrix & Canonical 8-Level Invariants

> **Subsystem**: `olt/scripts/src/mind/planning/engine/`, `olt/scripts/src/reporting/doctor/`  
> **Source of Truth**: [`plan-evaluator.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/planning/engine/plan-evaluator.ts), [`plan-granularity-auditor.ts`](file:///Users/onurseckinsenoglu/repos/skills/olt/scripts/src/mind/auditing/plan-granularity-auditor.ts)

---

## 1. The Canonical 8-Level Plan Architecture

Every plan evaluated by the `doctor` system must satisfy the 8 canonical levels:

| Level       | Dimension               | Minimum Context Criterion                                                                                                                                                                         | Verifying Engine / Token                      |
| :---------- | :---------------------- | :------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | :-------------------------------------------- |
| **Level 1** | Problem Grounding       | Verbatim prompt lines mapped to tasks with explicit line numbers (`plan:add --requirement-lines`).                                                                                                | `PROMPT_LINE_COORDINATE_BINDING`              |
| **Level 2** | Constraints & Non-Goals | Explicit non-goals, architectural limits, and forbidden modifications declared.                                                                                                                   | `ARCHITECTURAL_CONSTRAINTS_CHECK`             |
| **Level 3** | 8-Vector Expansion      | Formal analysis across all 8 vectors (`EMPTY_PAYLOAD`, `TIMEOUT_STAGNATION`, `CONCURRENCY_MUTATION`, `HOST_BOUNDARY`, `STATE_TRANSITION`, `TYPE_INVARIANT`, `CLI_TELEMETRY`, `ADVERSARIAL_GATE`). | `plan:brainstorm` events in log               |
| **Level 4** | Disjoint Write Scopes   | Filesystem partitioning strictly $\le 3$ files per task (target $1-2$ files); zero overlap across parallel lanes.                                                                                 | `detectScopeOverlap` & `auditPlanGranularity` |
| **Level 5** | DAG & Wave Topology     | Work/Span computation ($W, S, P = \lceil W/S \rceil$), Tarjan cycle check, and wave assignment.                                                                                                   | `checkPlanningDag`                            |
| **Level 6** | Fast Incremental Gates  | Deterministic CLI checks (`tsc --noEmit`, AST static audits, 0 any).                                                                                                                              | `task:check` gate commands                    |
| **Level 7** | Adversarial Probes      | Counterfactual falsifiability test proofs; gates must fail when code is missing or broken.                                                                                                        | `ADVERSARIAL_GATE_DISCRIMINATION`             |
| **Level 8** | Sealing & Completion    | Whole-run diff verification, reflog staging (`git add -A`), Conventional Commits, push, and sync.                                                                                                 | `COMPLETION_GATE_INTEGRITY`                   |

---

## 2. Quantitative Epistemic Confidence Formula

The plan evaluator computes an empirical epistemic confidence score ($C \in [0.0, 1.0]$):

$$C = w_e \cdot E_{\text{norm}} + w_g \cdot \frac{G_{\text{falsifiable}}}{G_{\text{total}}} + w_s \cdot S_{\text{historical}} - w_r \cdot R_{\text{contradictions}}$$

- **Empirical Evidence Ratio ($E_{\text{norm}}$)**: Number of observed repository symbols and tests referenced in `plan:enhance`.
- **Falsifiable Gate Ratio ($G_{\text{falsifiable}} / G_{\text{total}}$)**: Proves that gates are discriminating unit tests rather than vacuous passes (`echo ok` or whole-repo tests).
- **Contradiction Penalty ($R_{\text{contradictions}}$)**: Scope risks, circular references, or overlapping directory write targets.

**Pass Criterion**:

- **Threshold**: $C \ge 0.85$ (Evaluated by `evaluatePlanEpistemicReadiness`).
- If $C < 0.85$, `doctor` emits finding `EPISTEMIC_CONFIDENCE_DEFICIT` and blocks wave claiming.
