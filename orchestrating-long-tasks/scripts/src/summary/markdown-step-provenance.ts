import type { ActionStepRecord, ActionTarget } from "./types.ts";
import { code, note, section, table } from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";

/**
 * Fixed so the same target always renders the same string regardless of the object's own key
 * order — `ActionTarget` is built by spreading conditional entries in `timeline-collector.ts`, so
 * insertion order is an implementation detail, not something a reader should have to account for.
 */
const TARGET_FIELD_ORDER: readonly (keyof ActionTarget)[] = [
  "taskId",
  "gateId",
  "branchId",
  "subTaskId",
  "agentId",
  "commandId",
  "packetId",
  "requirementId",
  "path",
  "nodeId",
];

/** Every field the target actually carries, `key=value`, joined — never a subset chosen by kind. */
function targetText(target: ActionTarget): string {
  const parts: string[] = [];
  for (const key of TARGET_FIELD_ORDER) {
    const value = target[key];
    if (value !== undefined) parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(" ") : "none";
}

/**
 * Renders `RunFacts.steps` (B15.1): every command, file write, grant, lease, packet, finding,
 * probe, review, branch and plan revision the append-only chain recorded, in the chain's own order.
 * This is the same array `graph.json` carries under `run.steps` — rendered here, not recomputed, so
 * the two views of one run can never disagree about what happened.
 */
export function renderActionProvenance(context: ReportContext): string[] {
  if (context.steps.length === 0) {
    return section("19. Action Provenance Trace", note("The capsule recorded no step."));
  }
  const rows = context.steps.map((step: ActionStepRecord) => [
    String(step.step),
    step.timestamp,
    code(step.actor),
    step.kind,
    code(step.rawKind),
    targetText(step.target),
    step.outcome,
    step.evidence_class,
    step.summary,
  ]);
  const body = [
    ...note(
      "Every recorded action, in the append-only chain's own order (B15.1): its kind, what it targeted, whether it succeeded, and how the harness knows.",
    ),
    "",
    ...table(
      ["Step", "Timestamp", "Actor", "Kind", "Raw event", "Target", "Outcome", "Evidence", "Summary"],
      rows,
    ),
  ];
  return section("19. Action Provenance Trace", body);
}
