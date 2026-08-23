import {
  UNKNOWN,
  code,
  joinOrNone,
  note,
  section,
  table,
  textOrUnknown,
} from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";
import type { TaskChecklistCoverageView } from "./markdown-sources.ts";

function checklistCoverageBlock(coverage: TaskChecklistCoverageView): string[] {
  const heading = [`### ${coverage.taskId}`, ""];
  if (!coverage.applicable) {
    return [...heading, ...note(coverage.reason ?? UNKNOWN), ""];
  }
  const checked = coverage.items.filter((item) => item.disposition === "checked");
  const notApplicable = coverage.items.filter((item) => item.disposition === "not_applicable");
  const couldNotCheck = coverage.items.filter((item) => item.disposition === "could_not_check");
  return [
    ...heading,
    `Domain: ${textOrUnknown(coverage.domain)}. ${checked.length} checked and passed, ${notApplicable.length} not applicable, ${couldNotCheck.length} could not be checked, of ${coverage.items.length} total.`,
    "",
    `Checked and passed: ${joinOrNone(checked.map((item) => code(item.id)))}`,
    "",
    "**Not applicable**",
    "",
    ...(notApplicable.length === 0
      ? note("No item was found not applicable.")
      : table(
          ["Item", "Reason"],
          notApplicable.map((item) => [code(item.id), textOrUnknown(item.reason)]),
        )),
    "",
    "**Could not be checked**",
    "",
    ...(couldNotCheck.length === 0
      ? note("No item was left unchecked.")
      : table(
          ["Item", "Reason"],
          couldNotCheck.map((item) => [code(item.id), textOrUnknown(item.reason)]),
        )),
    "",
    "**Adjacent standing-standard findings**",
    "",
    ...(coverage.adjacentFindings.length === 0
      ? note("No adjacent finding was recorded outside this task's own write scope.")
      : table(
          ["Finding", "Checklist item", "Severity", "Observation", "Remediation"],
          coverage.adjacentFindings.map((finding) => [
            code(finding.id),
            code(finding.checklistItemId),
            finding.severity,
            finding.observation,
            finding.remediation,
          ]),
        )),
    "",
  ];
}

export function renderChecklistCoverage(context: ReportContext): string[] {
  const lines = [
    ...note(
      "Coverage never gates a task's own verdict (section 14); it states separately what the validator's standing checklist actually inspected.",
    ),
    "",
    ...(context.checklistCoverage.length === 0
      ? note("No task has recorded a review yet, so no standing checklist coverage exists.")
      : context.checklistCoverage.flatMap(checklistCoverageBlock)),
  ];
  return section("20. Standing Checklist Coverage", lines);
}
