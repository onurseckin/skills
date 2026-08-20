import { isJsonObject, type JsonObject } from "../contracts/json.ts";
import type { Finding } from "../contracts/workflow.ts";
import { isProbeDemand } from "../workflow/review/finding-class.ts";
import type { TaskRecord, ValidationAttempt } from "../workflow/types.ts";
import {
  UNKNOWN,
  code,
  evidenceLabel,
  evidencedText,
  formatDuration,
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
import type { CommandView, TaskChecklistCoverageView } from "./markdown-sources.ts";

function durationOf(command: CommandView): string {
  if (command.startedAt === null || command.finishedAt === null) return UNKNOWN;
  const started = Date.parse(command.startedAt);
  const finished = Date.parse(command.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) return UNKNOWN;
  return formatDuration(finished - started);
}

/** A command that never reported an exit code did not exit 0; it exited unknown. */
function exitCodeOf(command: CommandView): string {
  return command.exitCode === null ? String(UNKNOWN) : String(command.exitCode);
}

export function renderScripts(context: ReportContext): string[] {
  if (context.commands.length === 0) {
    return section("12. Scripts And Commands", note("No command was recorded in this run."));
  }
  const rows = context.commands.map((command) => [
    code(command.id),
    command.argv.length === 0 ? UNKNOWN : code(command.argv.join(" ")),
    code(textOrUnknown(command.actor)),
    command.taskId === null ? "-" : code(command.taskId),
    command.gateId === null ? "-" : code(command.gateId),
    textOrUnknown(command.status),
    exitCodeOf(command),
    durationOf(command),
    numberOrUnknown(command.stdoutBytes),
    numberOrUnknown(command.stderrBytes),
    numberOrUnknown(command.attempts),
  ]);
  const body = [
    ...note("Exit codes are harness observations: the harness ran the child and read its status."),
    "",
    ...table(
      [
        "Command",
        "Argv",
        "Actor",
        "Task",
        "Gate",
        "Status",
        "Exit code",
        "Duration",
        "Stdout bytes",
        "Stderr bytes",
        "Attempts",
      ],
      rows,
    ),
  ];
  return section("12. Scripts And Commands", body);
}

export function renderTools(context: ReportContext): string[] {
  const rows: string[][] = [];
  for (const agent of context.agents) {
    for (const tool of agent.tools_used ?? []) {
      rows.push([
        code(toolRefText(tool)),
        code(agent.id),
        "used",
        evidenceLabel(tool.evidence_class),
        tool.first_reported_at,
      ]);
    }
    for (const granted of agent.tools_granted?.value ?? []) {
      rows.push([
        code(toolRefText(granted)),
        code(agent.id),
        "granted",
        evidenceLabel(agent.tools_granted?.evidence_class ?? "unknown"),
        "-",
      ]);
    }
  }
  const body =
    rows.length === 0
      ? note("No tool was granted or reported through the CLI, so tool usage is unknown.")
      : table(["Tool", "Agent", "Grant or use", "Evidence", "First reported"], rows);
  return section("13. Tools", body);
}

function findingsOf(task: TaskRecord): Finding[] {
  return task.findings ?? [];
}

function resolutionText(finding: Finding): string {
  const proof = finding.revalidation_proof;
  if (!isJsonObject(proof)) return finding.status === "resolved" ? UNKNOWN : "open";
  const method = typeof proof.method === "string" ? proof.method : UNKNOWN;
  const evidence = Array.isArray(proof.evidence)
    ? proof.evidence.flatMap((entry) => {
        if (!isJsonObject(entry)) return [];
        const id = entry.command_id;
        return typeof id === "string" ? [id] : [];
      })
    : [];
  return `${method} via ${joinOrUnknown(evidence.map(code))}`;
}

// B12.2: one entry per domain now open, alongside every archived round's entries.
function validationAttempts(task: TaskRecord): ValidationAttempt[] {
  return [...(task.validation_history ?? []), ...(task.validations ?? [])];
}

export function renderProbesAndPushbacks(context: ReportContext): string[] {
  const probeRows: string[][] = [];
  const defectRows: string[][] = [];
  for (const task of context.tasks) {
    for (const finding of findingsOf(task)) {
      if (isProbeDemand(finding)) {
        probeRows.push([
          code(task.id),
          numberOrUnknown(typeof finding.probe_round === "number" ? finding.probe_round : null),
          code(finding.id),
          finding.observation,
          finding.status,
          textOrUnknown(typeof finding.resolved_by === "string" ? finding.resolved_by : null),
          resolutionText(finding),
        ]);
        continue;
      }
      defectRows.push([
        code(task.id),
        code(finding.id),
        finding.severity,
        finding.observation,
        finding.remediation,
        finding.revalidation,
        finding.status,
        resolutionText(finding),
      ]);
    }
  }

  const verdictRows = context.tasks.flatMap((task) =>
    validationAttempts(task).map((attempt) => [
      code(task.id),
      String(attempt.attempt),
      code(attempt.validator_id),
      textOrUnknown(attempt.verdict),
      joinOrNone((attempt.checks ?? []).map((check) => code(check.command_id))),
    ]),
  );

  const lines = [
    ...note(
      "A probe demands proof and does not claim a defect; a pushback asserts one. They are counted separately and neither is inferred from the other.",
    ),
    "",
    "### Adversarial probes",
    "",
    ...(probeRows.length === 0
      ? note("No probe demand was recorded.")
      : table(
          ["Task", "Probe round", "Finding", "Demand", "Status", "Answered by", "Answer"],
          probeRows,
        )),
    "",
    "### Pushbacks and defect findings",
    "",
    ...(defectRows.length === 0
      ? note("No defect finding was recorded.")
      : table(
          [
            "Task",
            "Finding",
            "Severity",
            "Observation",
            "Remediation",
            "Revalidation",
            "Status",
            "Resolution",
          ],
          defectRows,
        )),
    "",
    "### Repair rounds",
    "",
    ...table(
      ["Task", "Repair rounds", "Probe rounds"],
      context.tasks.map((task) => [
        code(task.id),
        String(task.repair_round ?? 0),
        String(task.probe_round ?? 0),
      ]),
    ),
    "",
    "### Validation attempts",
    "",
    ...(verdictRows.length === 0
      ? note("No validation attempt was recorded.")
      : table(["Task", "Attempt", "Validator", "Verdict", "Cited commands"], verdictRows)),
  ];
  return section("14. Probes, Pushbacks And Repairs", lines);
}

export function renderGates(context: ReportContext): string[] {
  const commandsByGate = new Map<string, CommandView[]>();
  for (const command of context.commands) {
    if (command.gateId === null) continue;
    const list = commandsByGate.get(command.gateId) ?? [];
    list.push(command);
    commandsByGate.set(command.gateId, list);
  }
  const gateRows = context.gates.map((gate) => {
    const runs = commandsByGate.get(gate.id) ?? [];
    return [
      code(gate.id),
      textOrUnknown(gate.scope),
      code(textOrUnknown(gate.command)),
      gate.mandatory === null ? UNKNOWN : String(gate.mandatory),
      joinOrNone(gate.requirementIds.map(code)),
      runs.length === 0
        ? "never run"
        : runs.map((run) => `${run.id} exit ${exitCodeOf(run)}`).join("; "),
    ];
  });
  const resultRows = context.tasks.flatMap((task) =>
    (task.gate_results ?? []).map((result) => [
      code(task.id),
      code(result.gate_id),
      code(result.command_id),
      result.status,
    ]),
  );
  const lines = [
    ...(gateRows.length === 0
      ? note("No gate was compiled.")
      : table(
          ["Gate", "Scope", "Command", "Mandatory", "Requirements", "Recorded runs"],
          gateRows,
        )),
    "",
    "### Gate results attached to tasks",
    "",
    ...(resultRows.length === 0
      ? note("No gate result was attached to a task.")
      : table(["Task", "Gate", "Command", "Status"], resultRows)),
  ];
  return section("15. Gates", lines);
}

function objectArray(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

export function renderCritic(context: ReportContext): string[] {
  const authorization = context.state.completion_critic;
  const review = context.state.completion_review;
  const result = context.state.completion_result;
  const report = context.criticReport;

  if (authorization === undefined && review === undefined) {
    return section(
      "16. Completeness Critic",
      note("No completeness critic was authorised for this run."),
    );
  }

  const lines = [
    ...table(
      ["Field", "Value"],
      [
        ["Critic", code(textOrUnknown(authorization?.critic_id ?? review?.critic_id))],
        ["Authorisation status", textOrUnknown(authorization?.status)],
        ["Attempt", numberOrUnknown(authorization?.attempt)],
        ["Verdict", textOrUnknown(review?.status)],
        ["Decision recorded in the report", textOrUnknown(report?.decision)],
        ["Critic summary", textOrUnknown(report?.summary)],
        ["Report written at", textOrUnknown(report?.createdAt)],
        ["Reviewed at", textOrUnknown(review?.reviewed_at)],
        ["Unresolved findings", joinOrNone((review?.unresolved_finding_ids ?? []).map(code))],
        ["Run completion", textOrUnknown(result?.status)],
        ["Completed at", textOrUnknown(result?.completed_at)],
        ["Completed by", textOrUnknown(result?.actor)],
      ],
    ),
    "",
    "### Requirement proofs",
    "",
  ];
  const proofs = review?.requirement_proofs ?? [];
  lines.push(
    ...(proofs.length === 0
      ? note("The critic recorded no requirement proof.")
      : table(
          ["Requirement", "Status", "Evidence"],
          proofs.map((proof) => [
            code(proof.requirement_id),
            proof.status,
            joinOrNone(
              proof.evidence.map((item) => `${item.kind} ${item.reference}`),
              "; ",
            ),
          ]),
        )),
  );

  lines.push("", "### Critic findings", "");
  const findings = review?.findings ?? [];
  lines.push(
    ...(findings.length === 0
      ? note("The critic recorded no finding.")
      : table(
          ["Finding", "Requirement", "Severity", "Observation", "Remediation", "Revalidation"],
          findings.map((finding) => [
            code(finding.id),
            code(finding.requirement_id),
            finding.severity,
            finding.observation,
            finding.remediation,
            finding.revalidation,
          ]),
        )),
  );

  lines.push("", "### Residual risks accepted", "");
  const risks = review?.residual_risks ?? [];
  lines.push(
    ...(risks.length === 0
      ? note("No residual risk was accepted.")
      : table(
          ["Risk", "Severity", "Description", "Rationale"],
          risks.map((risk) => [code(risk.id), risk.severity, risk.description, risk.rationale]),
        )),
  );

  const remediations = objectArray(context.state.completion_remediations);
  lines.push("", "### Remediations recorded against the review", "");
  lines.push(
    ...(remediations.length === 0
      ? note("No remediation was recorded.")
      : table(
          ["Actor", "Recorded at", "Findings answered"],
          remediations.map((remediation) => [
            code(textOrUnknown(String(remediation.actor ?? ""))),
            textOrUnknown(String(remediation.recorded_at ?? "")),
            joinOrNone(
              objectArray(remediation.resolutions).map((resolution) =>
                code(String(resolution.finding_id ?? UNKNOWN)),
              ),
            ),
          ]),
        )),
  );
  return section("16. Completeness Critic", lines);
}

export function renderTelemetry(context: ReportContext): string[] {
  const perAgent = context.agents.map((agent) => [
    code(agent.id),
    agent.role,
    evidencedText(agent.provider),
    evidencedText(agent.model),
    evidencedText(agent.model_tier),
    evidencedText(agent.thinking_level),
    evidencedText(agent.tokens_in, (value) => value.toLocaleString()),
    evidencedText(agent.tokens_out, (value) => value.toLocaleString()),
  ]);
  // Counters only some hosts keep, under the names those hosts used. A run whose host counts
  // nothing unusual simply has no rows here.
  const extraRows = context.agents.flatMap((agent) =>
    Object.entries(agent.token_extras ?? {}).map(([name, counter]) => [
      code(agent.id),
      code(name),
      evidencedText(counter, (value) => value.toLocaleString()),
    ]),
  );
  const estimate = context.metrics.estimated_tokens;
  const lines = [
    ...note(
      "Model, tier, thinking level and token counts are only ever what a host reported through the CLI. Nothing here is inferred from a model name, an agent id or the exporting machine.",
    ),
    "",
    ...(perAgent.length === 0
      ? note("No agent grant carried telemetry, so per-agent model and token usage is unknown.")
      : table(
          ["Agent", "Role", "Provider", "Model", "Tier", "Thinking", "Tokens in", "Tokens out"],
          perAgent,
        )),
    "",
    "### Host-specific token counters",
    "",
    ...(extraRows.length === 0
      ? note("No host reported a counter beyond input and output tokens.")
      : table(["Agent", "Counter", "Value"], extraRows)),
    "",
    "### Run-level token estimate",
    "",
    ...table(
      ["Measure", "Value", "Evidence"],
      [
        ["Tokens in", estimate.tokens_in.toLocaleString(), evidenceLabel("derived", true)],
        ["Tokens out", estimate.tokens_out.toLocaleString(), evidenceLabel("derived", true)],
        ["Total tokens", estimate.total_tokens.toLocaleString(), evidenceLabel("derived", true)],
      ],
    ),
    "",
    ...note(
      "The run-level figures are a byte-ratio estimate computed from recorded bytes, not a measurement of any model's usage.",
    ),
  ];
  return section("17. Model And Token Telemetry", lines);
}

export function renderTimeline(context: ReportContext): string[] {
  if (context.timeline.length === 0) {
    return section("18. Complete Timeline", note("The capsule recorded no event."));
  }
  const rows = context.timeline.map((event) => [
    String(event.sequence),
    event.timestamp,
    event.phase,
    code(event.actor),
    code(event.event),
    event.summary,
    event.task_id === undefined ? "-" : code(event.task_id),
    event.round === undefined ? "-" : String(event.round),
  ]);
  const body = [
    ...note("Every recorded event, in sequence. Nothing is sampled away."),
    "",
    ...table(["#", "Timestamp", "Phase", "Actor", "Event", "Summary", "Task", "Round"], rows),
  ];
  return section("18. Complete Timeline", body);
}

function checklistCoverageBlock(coverage: TaskChecklistCoverageView): string[] {
  const heading = [`### ${coverage.taskId}`, ""];
  if (!coverage.applicable) {
    return [
      ...heading,
      ...note(coverage.reason ?? "no standing checklist domain was named for this review"),
      "",
    ];
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

/**
 * B12.5: what a validator's standing checklist actually covered, per task — separate from the
 * task's own pass/fail finding (section 14, "Probes, Pushbacks And Repairs"). A task with no
 * coverage recorded says so in the validator's own stated reason rather than rendering an empty
 * table indistinguishable from a checklist that came back clean (B33: an omission and a fabricated
 * pass are the same failure mode).
 */
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
  return section("19. Standing Checklist Coverage", lines);
}
