import type { ActionStepRecord, ActionTarget } from "../graph/index.ts";
import { code, note, section, table } from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";

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

function targetText(target: ActionTarget): string {
  const parts: string[] = [];
  for (const key of TARGET_FIELD_ORDER) {
    const value = target[key];
    if (value !== undefined) parts.push(`${key}=${value}`);
  }
  return parts.length > 0 ? parts.join(" ") : "none";
}

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
      [
        "Step",
        "Timestamp",
        "Actor",
        "Kind",
        "Raw event",
        "Target",
        "Outcome",
        "Evidence",
        "Summary",
      ],
      rows,
    ),
  ];
  return section("19. Action Provenance Trace", body);
}
