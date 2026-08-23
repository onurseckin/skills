import { isJsonObject } from "../../core/contracts/json.ts";
import { branchesForParent } from "../../workflow/branch/ledger.ts";
import type { AsciiBranch, AsciiTask } from "./markdown-ascii-graph.ts";
import { renderTaskGraphAscii } from "./markdown-ascii-graph.ts";
import {
  UNKNOWN,
  code,
  evidenceLabel,
  fence,
  formatDuration,
  joinOrNone,
  joinOrUnknown,
  note,
  numberOrUnknown,
  section,
  table,
  textOrUnknown,
} from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";
import type { PlanEntryView } from "./markdown-sources.ts";

function planRows(entries: readonly PlanEntryView[]): string[][] {
  return entries.map((entry, index) => [
    String(index + 1),
    entry.text,
    evidenceLabel(entry.evidenceClass),
  ]);
}

export function renderRunIdentity(context: ReportContext): string[] {
  const { manifest, metrics } = context;
  const rows: string[][] = [
    ["Run id", code(context.runId), "harness_observed"],
    ["Capsule id", code(textOrUnknown(manifest.capsule_id)), "harness_observed"],
    ["Created at", textOrUnknown(manifest.created_at), "harness_observed"],
    ["Prompt sha256", code(textOrUnknown(manifest.prompt_sha256)), "harness_observed"],
    ["Prompt bytes", numberOrUnknown(manifest.prompt_bytes), "harness_observed"],
    ["Capture mode", textOrUnknown(manifest.capture_mode), "harness_observed"],
    ["Capture assurance", textOrUnknown(manifest.assurance), "harness_observed"],
    ["Source verified", String(manifest.source_verified === true), "harness_observed"],
    ["Harness runtime", textOrUnknown(manifest.runtime_version), "harness_observed"],
    ["Graph revision", numberOrUnknown(context.graphRevision), "harness_observed"],
  ];
  const outcome: string[][] = [
    ["Tasks", `${metrics.satisfied_tasks} satisfied of ${metrics.total_tasks}`, "harness_observed"],
    ["Failed tasks", numberOrUnknown(metrics.failed_tasks), "harness_observed"],
    ["Wall duration", formatDuration(metrics.wall_duration_ms), "harness_observed"],
    ["Active command time", formatDuration(metrics.active_command_duration_ms), "harness_observed"],
    ["Commands executed", numberOrUnknown(metrics.total_commands_executed), "harness_observed"],
    ["Commands exiting zero", numberOrUnknown(metrics.total_gates_passed), "harness_observed"],
    ["Repair rounds", numberOrUnknown(metrics.repair_rounds_total), "harness_observed"],
    ["Findings resolved", numberOrUnknown(metrics.resolved_findings_total), "harness_observed"],
    ["Findings still open", numberOrUnknown(metrics.open_findings_total), "harness_observed"],
    ["Media assets recorded", numberOrUnknown(metrics.total_media_assets), "harness_observed"],
    ["Inter-agent exchanges", numberOrUnknown(metrics.total_edge_traffic_exchanges), "derived"],
    ["Branches opened", String(context.branches.length), "harness_observed"],
    ["Agents granted", String(context.agents.length), "harness_observed"],
  ];
  return section("1. Run Identity", [
    ...table(["Field", "Value", "Evidence"], rows),
    "",
    "### Outcome",
    "",
    ...table(["Measure", "Value", "Evidence"], outcome),
  ]);
}

export function renderOriginalPrompt(context: ReportContext): string[] {
  const body =
    context.promptText.trim().length === 0
      ? note("The capsule holds no prompt bytes.")
      : [
          ...note(
            "The verbatim prompt is the requirement source; every requirement below binds to these bytes.",
          ),
          "",
          ...fence(context.promptText),
        ];
  return section("2. Original Prompt", body);
}

export function renderEnhancedPlan(context: ReportContext): string[] {
  const plan = context.enhancedPlan;
  if (plan === null) {
    const planning = context.state.planning;
    const recorded = isJsonObject(planning) && isJsonObject(planning.enhanced_plan);
    return section(
      "3. Enhanced Plan",
      note(
        recorded
          ? "State records an enhanced plan, but planning/enhanced-plan.json could not be read; its content is unknown."
          : "No enhanced plan was recorded for this run.",
      ),
    );
  }

  const lines: string[] = [
    ...note(
      `Derived from ${textOrUnknown(plan.derivedFrom)} and authoritative: ${
        plan.authoritative === null ? UNKNOWN : String(plan.authoritative)
      }. Recorded by ${textOrUnknown(plan.actor)} at ${textOrUnknown(plan.recordedAt)}.`,
    ),
    "",
    `**Summary**: ${plan.summary === null ? UNKNOWN : plan.summary.text} (${
      plan.summary === null ? UNKNOWN : evidenceLabel(plan.summary.evidenceClass)
    })`,
    "",
  ];

  const blocks: Array<[string, string[][]]> = [
    ["Observations", planRows(plan.observations)],
    ["Todos", planRows(plan.todos)],
    ["Risks", planRows(plan.risks)],
    ["Open questions", planRows(plan.openQuestions)],
    ["Sources read", planRows(plan.sources)],
  ];
  for (const [title, rows] of blocks) {
    lines.push(`### ${title}`, "");
    if (rows.length === 0) lines.push(...note("None recorded."));
    else lines.push(...table(["#", title.replace(/s$/, ""), "Evidence"], rows));
    lines.push("");
  }
  return section("3. Enhanced Plan", lines);
}

export function renderRequirements(context: ReportContext): string[] {
  if (context.requirements.length === 0) {
    return section("4. Derived Requirements", note("No requirements were compiled."));
  }
  const rows = context.requirements.map((requirement) => [
    code(requirement.id),
    textOrUnknown(requirement.status),
    textOrUnknown(requirement.disposition),
    requirement.sourceLines.length === 0 ? UNKNOWN : requirement.sourceLines.join(", "),
    textOrUnknown(requirement.instruction),
    textOrUnknown(requirement.subsystem),
    textOrUnknown(requirement.risk),
    numberOrUnknown(requirement.priority),
    joinOrNone(requirement.dependencies),
  ]);
  const lines = [
    ...note("Requirements are derived from the prompt lines named in the source column."),
    "",
    ...table(
      [
        "Requirement",
        "Status",
        "Disposition",
        "Prompt lines",
        "Instruction",
        "Subsystem",
        "Risk",
        "Priority",
        "Depends on",
      ],
      rows,
    ),
    "",
    "### How each requirement is to be implemented",
    "",
    ...table(
      ["Requirement", "Implementation"],
      context.requirements.map((requirement) => [
        code(requirement.id),
        textOrUnknown(requirement.implementation),
      ]),
    ),
    "",
    "### Acceptance criteria and evidence",
    "",
  ];
  const criteriaRows = context.requirements.flatMap((requirement) =>
    requirement.acceptance.length === 0 && requirement.evidence.length === 0
      ? []
      : [
          [
            code(requirement.id),
            joinOrNone(requirement.acceptance, "; "),
            joinOrNone(requirement.evidence, "; "),
          ],
        ],
  );
  lines.push(
    ...(criteriaRows.length === 0
      ? note("No acceptance criteria were compiled.")
      : table(["Requirement", "Acceptance criteria", "Evidence"], criteriaRows)),
  );

  lines.push("", "### Prompt line dispositions", "");
  const dispositionRows = context.dispositions.map((disposition) => [
    numberOrUnknown(disposition.line),
    textOrUnknown(disposition.kind),
    joinOrNone(disposition.requirementIds),
    textOrUnknown(disposition.rationale),
  ]);
  lines.push(
    ...(dispositionRows.length === 0
      ? note("No line dispositions were recorded.")
      : table(["Prompt line", "Kind", "Requirements", "Rationale"], dispositionRows)),
  );
  return section("4. Derived Requirements", lines);
}

export function renderTopology(context: ReportContext): string[] {
  const topology = context.topology;
  if (topology === null) {
    return section(
      "5. Recorded Topology",
      note(
        "No topology was recorded, so what ran in parallel and why is unknown for this run; the waves below are the ones the tasks fall into by dependency alone.",
      ),
    );
  }
  const lines = [
    `- **Topology revision**: ${topology.revision}`,
    `- **Max parallel**: ${topology.max_parallel}`,
    "",
    ...table(
      ["Wave", "Tasks", "Width"],
      topology.waves.map((wave) => [
        String(wave.wave),
        joinOrUnknown(wave.task_ids.map(code)),
        String(wave.task_ids.length),
      ]),
    ),
    "",
    "### Why each task landed where it did",
    "",
    ...table(
      ["Task", "Wave", "Parallel with", "Serialized after", "Reason", "Rationale", "Evidence"],
      topology.decisions.map((decision) => [
        code(decision.task_id),
        String(decision.wave),
        joinOrNone(decision.parallel_with.map(code)),
        joinOrNone(decision.serialized_after.map(code)),
        decision.reason,
        textOrUnknown(decision.rationale),
        evidenceLabel(decision.evidence_class),
      ]),
    ),
  ];
  return section("5. Recorded Topology", lines);
}

function asciiBranchesFor(context: ReportContext, taskId: string): AsciiBranch[] {
  return branchesForParent(context.branches, taskId).map((branch) => ({
    id: branch.id,
    reason: branch.reason,
    status: branch.status,
    subTasks: branch.sub_tasks.map((subTask) => ({
      id: subTask.id,
      label: subTask.label,
      status: subTask.status,
      agentId: subTask.agent_id ?? null,
    })),
  }));
}

export function renderTaskGraph(context: ReportContext): string[] {
  const tasks: AsciiTask[] = context.tasks.map((task) => ({
    id: task.id,
    label: typeof task.label === "string" ? task.label : null,
    status: task.status,
    agentId: task.lease?.agent_id ?? task.original_implementer ?? null,
    dependencies: [...task.dependencies],
    branches: asciiBranchesFor(context, task.id),
  }));
  const body = [
    ...note("Waves run top to bottom. Tasks drawn inside one wave were free to run together."),
    "",
    ...fence(renderTaskGraphAscii({ waves: context.waves, tasks }).join("\n"), "text"),
  ];
  return section("6. Task Graph", body);
}
