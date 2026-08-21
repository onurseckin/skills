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
import type { CommandView } from "./markdown-sources.ts";

function durationOf(command: CommandView): string {
  if (command.startedAt === null || command.finishedAt === null) return UNKNOWN;
  const started = Date.parse(command.startedAt);
  const finished = Date.parse(command.finishedAt);
  if (Number.isNaN(started) || Number.isNaN(finished)) return UNKNOWN;
  return formatDuration(finished - started);
}

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
          finding.severity,
          finding.remediation,
          finding.revalidation,
          textOrUnknown(typeof finding.demanded_at === "string" ? finding.demanded_at : null),
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
      textOrUnknown(attempt.domain),
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
          [
            "Task",
            "Probe round",
            "Finding",
            "Demand",
            "Severity",
            "Remediation",
            "Revalidation",
            "Demanded at",
            "Status",
            "Answered by",
            "Answer",
          ],
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
      : table(
          ["Task", "Attempt", "Domain", "Validator", "Verdict", "Cited commands"],
          verdictRows,
        )),
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
