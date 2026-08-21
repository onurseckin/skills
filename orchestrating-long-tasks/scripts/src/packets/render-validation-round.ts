import { isJsonObject, type JsonObject, type JsonValue } from "../contracts/json.ts";
import { assertNoConclusions } from "./prior-round-demands.ts";

function fenced(text: string, language: string): string {
  const longest = [...text.matchAll(/`+/gu)].reduce(
    (width, run) => Math.max(width, run[0].length),
    0,
  );
  const fence = "`".repeat(Math.max(3, longest + 1));
  return `${fence}${language}\n${text.replace(/\n+$/u, "")}\n${fence}`;
}

function array(value: JsonValue | undefined): JsonObject[] {
  return Array.isArray(value) ? value.filter(isJsonObject) : [];
}

function text(value: JsonValue | undefined): string {
  return typeof value === "string" ? value : "";
}

function demandLines(demands: JsonObject[]): string {
  if (demands.length === 0) return "No demand from an earlier round stands on the record.";
  return demands
    .map((demand) => {
      const where = array(demand.look_at);
      const round =
        typeof demand.probe_round === "number" ? ` (probe round ${demand.probe_round})` : "";
      const lines = [
        `- \`${text(demand.demand_id)}\` — requirement ${text(demand.requirement_id)}${round}`,
        `  - Prove: ${text(demand.prove)}`,
      ];
      if (typeof demand.prove_by === "string") lines.push(`  - By: ${demand.prove_by}`);
      if (where.length > 0) lines.push(`  - Look at: ${JSON.stringify(where)}`);
      return lines.join("\n");
    })
    .join("\n");
}

function streamBlock(label: string, stream: JsonValue | undefined): string {
  if (!isJsonObject(stream)) return "";
  const truncated = stream.truncated === true ? " (tail only; the recorded log is longer)" : "";
  return `\n${label}${truncated}:\n${fenced(text(stream.text), "text")}`;
}

function commandBlocks(commands: JsonObject[]): string {
  if (commands.length === 0) return "This run has recorded no command against this task.";
  return commands
    .map((command) => {
      const exit =
        command.exit_code === null ? text(command.status) : `exit ${String(command.exit_code)}`;
      const gate = command.gate_id === null ? "no gate binding" : `gate ${text(command.gate_id)}`;
      const argv = Array.isArray(command.argv) ? command.argv.join(" ") : "";
      return [
        `#### \`${text(command.command_id)}\` — ${exit}`,
        `Ran \`${argv}\` in \`${text(command.cwd_relative)}\` as ${text(command.actor)}, ${gate}, finished ${text(command.finished_at)}.`,
        streamBlock("stdout", command.stdout),
        streamBlock("stderr", command.stderr),
      ]
        .filter((part) => part !== "")
        .join("\n");
    })
    .join("\n\n");
}

function endpoint(pair: JsonValue | undefined, side: string): string {
  return isJsonObject(pair) ? JSON.stringify(pair[side] ?? null) : "null";
}

function recordedChangeLine(change: JsonValue | undefined): string {
  if (!isJsonObject(change)) return "";
  const digest =
    change.content_sha256_changed === true
      ? "recorded different content digests"
      : "recorded the same content digest";
  return [
    `\nThat inspection and the current one ${digest}`,
    `(${endpoint(change.file_count, "before")} → ${endpoint(change.file_count, "after")} files,`,
    `${endpoint(change.total_bytes, "before")} → ${endpoint(change.total_bytes, "after")} bytes).`,
  ].join(" ");
}

function diffBlock(title: string, diff: JsonValue | undefined): string {
  if (!isJsonObject(diff)) return "";
  const anchor = isJsonObject(diff.anchor) ? diff.anchor : {};
  const commit =
    anchor.head_commit === null ? "no recorded commit" : `commit ${text(anchor.head_commit)}`;
  const header = `#### ${title}\nAnchored to the inspection taken at ${text(anchor.captured_at)} (${commit}).${recordedChangeLine(diff.recorded_change)}`;
  if (typeof diff.unavailable === "string")
    return `${header}\nNo diff was measured: ${diff.unavailable}`;
  const argv = Array.isArray(diff.argv) ? ` Measured with \`git ${diff.argv.join(" ")}\`.` : "";
  const truncated =
    diff.truncated === true ? "\nThe diff below is the first part of a longer one." : "";
  const body = text(diff.text);
  return `${header}${argv}${truncated}\n${body.trim() === "" ? "No tracked file differs from that commit." : fenced(body, "diff")}`;
}

export function renderValidationRound(round: JsonObject): string {
  assertNoConclusions(round, "validation_round");
  const previous = isJsonObject(round.previous_round) ? round.previous_round : {};
  const started = text(previous.started_at);
  const ended = text(previous.ended_at);
  const delta = isJsonObject(round.repository_delta) ? round.repository_delta : {};
  const sections = [
    `## Round ${String(round.round)} — the record this run already holds`,
    [
      "Everything below is what the run measured or what an earlier round put on the record as a",
      "demand. No finding, ruling or line of reasoning from an earlier reviewer is carried here, and",
      "none of it is available to you: the judgement on this task is yours to reach from the code and",
      "the evidence in front of you.",
      "",
      `The previous round is round ${String(previous.round ?? "")}${started === "" ? "" : `, which started at ${started}`}${ended === "" ? "" : ` and ended at ${ended}`}.`,
    ].join("\n"),
    "### Prove these hold",
    demandLines(array(round.prove_these_hold)),
    "### Commands already run for this task",
    "Read back from the recorded logs, so nothing here is a rerun or a retelling.",
    commandBlocks(array(round.commands_already_run)),
    "### Gates that apply, with their latest recorded result",
    fenced(JSON.stringify(round.gates ?? [], null, 2), "json"),
    "### Repository delta",
    diffBlock("Everything that differs from the baseline the run recorded", delta.full),
    diffBlock("Since the previous round's inspection", delta.since_previous_round),
  ];
  return `${sections.filter((section) => section !== "").join("\n\n")}\n`;
}
