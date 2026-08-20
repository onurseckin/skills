import type { AgentGrantRecord } from "../contracts/agents.ts";
import type { BranchRecord, BranchRepositoryObservation } from "../contracts/branch.ts";
import type { TaskRecord } from "../workflow/types.ts";
import {
  UNKNOWN,
  code,
  evidencedText,
  fence,
  joinOrNone,
  joinOrUnknown,
  note,
  numberOrUnknown,
  section,
  table,
  textOrUnknown,
  toolRefText,
} from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";

function reportField(task: TaskRecord, key: string): string | null {
  const value = task.report?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function reportStrings(task: TaskRecord, key: string): string[] {
  const value = task.report?.[key];
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

export function renderPhases(context: ReportContext): string[] {
  if (context.waves.length === 0) {
    return section("7. Implementation Phases", note("No tasks were scheduled into a phase."));
  }
  const decisions = new Map(
    (context.topology?.decisions ?? []).map((decision) => [decision.task_id, decision]),
  );
  const tasks = new Map(context.tasks.map((task) => [task.id, task]));
  const lines: string[] = [];
  for (const wave of context.waves) {
    const heading = wave.wave === null ? "Phase: wave unknown" : `Phase ${wave.wave}`;
    lines.push(`### ${heading}`, "");
    lines.push(
      wave.taskIds.length > 1
        ? `${wave.taskIds.length} tasks were free to run in parallel in this phase.`
        : "One task was scheduled into this phase.",
    );
    lines.push("");
    lines.push(
      ...table(
        ["Task", "Label", "Status", "Agent", "Ran alongside", "Waited for", "Why", "Evidence"],
        wave.taskIds.map((taskId) => {
          const task = tasks.get(taskId);
          const decision = decisions.get(taskId);
          return [
            code(taskId),
            task === undefined
              ? UNKNOWN
              : textOrUnknown(typeof task.label === "string" ? task.label : null),
            task === undefined ? UNKNOWN : task.status,
            task === undefined ? UNKNOWN : textOrUnknown(task.original_implementer),
            decision === undefined ? UNKNOWN : joinOrNone(decision.parallel_with.map(code)),
            decision === undefined ? UNKNOWN : joinOrNone(decision.serialized_after.map(code)),
            decision === undefined
              ? "no topology decision was recorded for this task"
              : `${decision.reason}: ${decision.rationale}`,
            decision === undefined ? UNKNOWN : decision.evidence_class,
          ];
        }),
      ),
    );
    lines.push("");
  }
  return section("7. Implementation Phases", lines);
}

export function renderTaskTrajectory(context: ReportContext): string[] {
  if (context.tasks.length === 0) {
    return section("8. Task Trajectory", note("The run compiled no tasks."));
  }
  const lines: string[] = [];
  for (const task of context.tasks) {
    lines.push(`### ${task.id} — ${textOrUnknown(String(task.label ?? ""))}`, "");
    lines.push(
      ...table(
        ["Field", "Value"],
        [
          ["Status", task.status],
          ["Write scope", joinOrUnknown(task.write_scope.map(code))],
          ["Requirements", joinOrNone(task.requirement_ids.map(code))],
          ["Depends on", joinOrNone(task.dependencies.map(code))],
          ["Implementer", textOrUnknown(task.original_implementer)],
          ["Repair rounds", String(task.repair_round ?? 0)],
          ["Probe rounds", String(task.probe_round ?? 0)],
          ["Repair assignee", textOrUnknown(task.repair_assignee)],
          ["Replacement reason", textOrUnknown(task.replacement_reason)],
          ["Submitted summary", textOrUnknown(reportField(task, "summary"))],
          [
            "Files changed",
            `${joinOrUnknown(reportStrings(task, "files_changed").map(code))} (${textOrUnknown(
              reportField(task, "files_changed_evidence_class"),
            )})`,
          ],
        ],
      ),
    );
    lines.push("", "State transitions:", "");
    lines.push(
      ...(task.history.length === 0
        ? note("No transitions were recorded.")
        : table(
            ["At", "From", "To", "Actor", "Attempt", "Reason"],
            task.history.map((entry) => [
              entry.at,
              entry.from,
              entry.to,
              code(entry.actor),
              String(entry.attempt),
              entry.reason,
            ]),
          )),
    );
    lines.push("");
  }
  return section("8. Task Trajectory", lines);
}

function lineageLines(
  agents: readonly AgentGrantRecord[],
  parentId: string | null,
  depth: number,
): string[] {
  const children = agents.filter((agent) => (agent.parent_agent_id ?? null) === parentId);
  return children.flatMap((agent) => [
    `${"  ".repeat(depth)}${depth === 0 ? "" : "+-- "}${agent.id} [${agent.role}] on ${
      agent.parent_task_id ?? "no task"
    } (${agent.status})`,
    ...lineageLines(agents, agent.id, depth + 1),
  ]);
}

export function renderAgents(context: ReportContext): string[] {
  if (context.agentLedgerIssue !== undefined) {
    return section(
      "9. Agents And Sub-agents",
      note(`The grant ledger could not be read: ${context.agentLedgerIssue}`),
    );
  }
  if (context.agents.length === 0) {
    return section("9. Agents And Sub-agents", note("No agent grants were registered."));
  }
  const roster = table(
    ["Agent", "Role", "Parent agent", "Task", "Host", "Status", "Granted", "Released"],
    context.agents.map((agent) => [
      code(agent.id),
      agent.role,
      agent.parent_agent_id === null ? "(root)" : code(agent.parent_agent_id),
      agent.parent_task_id === null ? "(none)" : code(agent.parent_task_id),
      agent.host,
      agent.status,
      agent.granted_at,
      agent.status === "released"
        ? `${textOrUnknown(agent.released_at)} — ${textOrUnknown(agent.release_reason)}`
        : "-",
    ]),
  );
  const grants = table(
    ["Agent", "Tools granted", "Tools reported used", "Reports received", "Last report"],
    context.agents.map((agent) => [
      code(agent.id),
      evidencedText(agent.tools_granted, (tools) => joinOrNone(tools.map(toolRefText))),
      agent.tools_used === undefined || agent.tools_used.length === 0
        ? "none"
        : agent.tools_used
            .map((tool) => `${toolRefText(tool)} [${tool.evidence_class}]`)
            .join(", "),
      numberOrUnknown(agent.report_count ?? 0),
      textOrUnknown(agent.last_reported_at),
    ]),
  );
  const body = [
    ...roster,
    "",
    "### Lineage",
    "",
    ...fence(lineageLines(context.agents, null, 0).join("\n"), "text"),
    "",
    "### What each grant carried and what came back",
    "",
    ...grants,
  ];
  return section("9. Agents And Sub-agents", body);
}

function observationText(observation: BranchRepositoryObservation | undefined): string {
  if (observation === undefined) return UNKNOWN;
  if (!observation.git_available) return "the repository could not be observed";
  return `${observation.entries.length} paths at ${observation.observed_at} (head ${
    observation.head ?? UNKNOWN
  })`;
}

function branchBlock(branch: BranchRecord): string[] {
  const lines = [
    `### ${branch.id}`,
    "",
    ...table(
      ["Field", "Value"],
      [
        ["Why it opened", branch.reason],
        ["Parent task", code(branch.parent_task_id)],
        ["Parent agent", code(branch.parent_agent_id)],
        ["Depth", String(branch.depth)],
        ["Status", branch.status],
        ["Opened at", branch.opened_at],
        ["Collected at", textOrUnknown(branch.collected_at)],
        ["Abandoned at", textOrUnknown(branch.abandoned_at)],
        ["What came back", textOrUnknown(branch.outcome_summary)],
        [
          "Files changed",
          evidencedText(branch.files_changed, (files) => joinOrNone(files.map(code))),
        ],
        ["Worktree at open", observationText(branch.opened_observation)],
        ["Worktree at collect", observationText(branch.collected_observation)],
      ],
    ),
    "",
    ...table(
      ["Sub-task", "Label", "Sub-agent", "Status", "Write scope", "Gate", "Reported back"],
      branch.sub_tasks.map((subTask) => [
        code(subTask.id),
        subTask.label,
        subTask.agent_id === undefined ? "unclaimed" : code(subTask.agent_id),
        subTask.status,
        joinOrUnknown(subTask.write_scope.map(code)),
        textOrUnknown(subTask.gate),
        textOrUnknown(subTask.summary),
      ]),
    ),
    "",
  ];
  const recovered = branch.sub_tasks.flatMap((subTask) =>
    subTask.recovery === undefined
      ? []
      : [
          `- \`${subTask.id}\` was reclaimed at ${subTask.recovery.recovered_at} from ${subTask.recovery.expired_agent_id}, whose lease expired at ${subTask.recovery.expired_at}.`,
        ],
  );
  if (recovered.length > 0) lines.push(...recovered, "");
  return lines;
}

export function renderBranches(context: ReportContext): string[] {
  if (context.branches.length === 0) {
    return section("10. Branch Excursions", note("No branch was opened during this run."));
  }
  return section("10. Branch Excursions", context.branches.flatMap(branchBlock));
}

export function renderFilesChanged(context: ReportContext): string[] {
  const rows: string[][] = [];
  for (const task of context.tasks) {
    const evidence = textOrUnknown(reportField(task, "files_changed_evidence_class"));
    for (const path of reportStrings(task, "files_changed")) {
      rows.push([code(path), code(task.id), evidence]);
    }
  }
  for (const branch of context.branches) {
    for (const path of branch.files_changed?.value ?? []) {
      rows.push([code(path), code(branch.id), branch.files_changed?.evidence_class ?? UNKNOWN]);
    }
  }
  const body =
    rows.length === 0
      ? note("No agent reported a changed file and no branch observation recorded one.")
      : table(["Path", "Reported by", "Evidence"], rows);
  return section("11. Files Changed", body);
}
