import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import type { Finding } from "../../core/contracts/workflow.ts";
import {
  UNKNOWN,
  code,
  evidenceLabel,
  evidencedText,
  joinOrNone,
  note,
  numberOrUnknown,
  section,
  table,
  textOrUnknown,
} from "./markdown-primitives.ts";
import type { ReportContext } from "./markdown-report-context.ts";

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
        ["Authorised at", textOrUnknown(authorization?.started_at)],
        ["Authorisation deadline", textOrUnknown(authorization?.deadline_at)],
        [
          "Critic packet",
          authorization?.packet_id === undefined && review?.packet_id === undefined
            ? UNKNOWN
            : code(textOrUnknown(authorization?.packet_id ?? review?.packet_id)),
        ],
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
          ["Requirement", "Status", "Evidence", "Observation"],
          proofs.map((proof) => [
            code(proof.requirement_id),
            proof.status,
            joinOrNone(
              proof.evidence.map((item) => `${item.kind} ${item.reference}`),
              "; ",
            ),
            joinOrNone(
              proof.evidence.map((item) => item.observation),
              "; ",
            ),
          ]),
        )),
  );

  lines.push("", "### Capsule integrity evidence", "");
  const integrityEvidence = objectArray(review?.integrity_evidence);
  lines.push(
    ...(integrityEvidence.length === 0
      ? note("The critic recorded no capsule integrity check.")
      : table(
          ["Kind", "Status", "Event head", "Issues"],
          integrityEvidence.map((entry) => [
            textOrUnknown(typeof entry.kind === "string" ? entry.kind : null),
            textOrUnknown(typeof entry.status === "string" ? entry.status : null),
            code(textOrUnknown(typeof entry.event_head === "string" ? entry.event_head : null)),
            joinOrNone(
              objectArray(entry.issues).map(
                (issue) =>
                  `${textOrUnknown(typeof issue.code === "string" ? issue.code : null)}: ${textOrUnknown(
                    typeof issue.message === "string" ? issue.message : null,
                  )}`,
              ),
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

function conflictValueText(value: unknown): string {
  if (value === null || value === undefined) return UNKNOWN;
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
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
  const extraRows = context.agents.flatMap((agent) =>
    Object.entries(agent.token_extras ?? {}).map(([name, counter]) => [
      code(agent.id),
      code(name),
      evidencedText(counter, (value) => value.toLocaleString()),
    ]),
  );
  const conflictRows = context.agents.flatMap((agent) =>
    (agent.telemetry_conflicts ?? []).map((conflict) => [
      code(agent.id),
      code(conflict.field),
      conflictValueText(conflict.recorded_value),
      conflict.recorded_evidence_class,
      conflictValueText(conflict.probed_value),
      conflict.probed_evidence_class,
    ]),
  );
  const estimate = context.metrics.estimated_tokens;
  const lines = [
    ...note(
      "A value typed on a CLI flag (--model, --provider, --tokens-in and the rest) is agent_reported: a claim from whichever process called the harness, true only if that caller was honest. Only a value the harness itself read off the host's own configuration or transcript earns derived or harness_observed. Nothing here is ever inferred from a model name, an agent id or the exporting machine.",
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
    "### Telemetry conflicts",
    "",
    ...note(
      "Two sources disagreed about the same field. Neither value is discarded to pick a winner — both are kept, each with the evidence class it actually earned.",
    ),
    "",
    ...(conflictRows.length === 0
      ? note("No probe ever disagreed with an explicitly reported value.")
      : table(
          [
            "Agent",
            "Field",
            "Recorded value",
            "Recorded evidence",
            "Probed value",
            "Probed evidence",
          ],
          conflictRows,
        )),
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
