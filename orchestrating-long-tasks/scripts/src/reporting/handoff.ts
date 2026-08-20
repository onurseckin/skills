import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTopology } from "../contracts/topology.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { loadRun } from "../store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { TaskView } from "./action-types.ts";
import { agentRows, liveWaveLine, topologyRows } from "./handoff-sections.ts";
import { nextActions } from "./next-actions.ts";
import { workflowView } from "./workflow-view.ts";
import { renderPreplanHandoff } from "./preplan-handoff.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../contracts/trusted-host.ts";

/**
 * The harness this code is part of, which `references/protocol.md` names as the entrypoint every
 * run command goes through. A capsule carries no runtime of its own — `CAPSULE_LAYOUT` declares no
 * `runtime/` and nothing creates one — so a path built under the run root would be a file the
 * reader cannot execute, on the one section of this document that exists to be pasted.
 */
const ENTRYPOINT = fileURLToPath(new URL("../../harness.ts", import.meta.url));

function jsonRows(values: unknown[]): string[] {
  return values.length ? values.map((value) => JSON.stringify(value)) : ["none"];
}

function gateEvidenceLines(): string[] {
  return [
    "## Gate evidence assurance",
    "",
    JSON.stringify(trustedHostEvidence()),
    ...trustedHostLimitations(),
  ];
}

export function renderHandoff(runRoot: string): string {
  const loaded = loadRun(runRoot);
  const graph = loaded.state.graph as Record<string, unknown> | undefined;
  if (graph === undefined)
    return [
      renderPreplanHandoff(loaded, ENTRYPOINT).trimEnd(),
      "",
      ...gateEvidenceLines(),
      "",
    ].join("\n");
  const view = workflowView(runRoot);
  const tasks = view.tasks as unknown as TaskView[];
  const requirements = view.requirements as unknown[];
  const branches = view.branches as unknown[];
  // Agent grants and topology live outside the workflow projection, so they are read from the
  // capsule state the document is already holding rather than through a second load.
  const agents = readAgentLedger(loaded.state);
  const topology = readTopology(loaded.state);
  const findings = tasks.flatMap((task) =>
    task.open_finding_ids.map((id) => ({ task_id: task.id, finding_id: id })),
  );
  const recent = loaded.events
    .slice(-10)
    .map((event) => `${event.sequence} | ${event.timestamp} | ${event.actor} | ${event.kind}`);
  const actions = nextActions(loaded.runRoot, ENTRYPOINT, view, agents);
  return [
    "# Harness handoff",
    "",
    `Run: ${loaded.manifest.run_id}`,
    `Assurance: ${loaded.manifest.assurance}`,
    `Prompt SHA-256: ${loaded.manifest.prompt_sha256}`,
    `State revision: ${loaded.state.revision}`,
    // No fallback: `workflowView` above refuses a graph without a valid revision, so this line is
    // only ever reached with one the capsule recorded. A stand-in here would be a number nobody
    // wrote, on the one field a fresh agent uses to tell which plan it is looking at.
    `Graph revision: ${String(graph.revision)}`,
    liveWaveLine(topology, tasks),
    "Authentication: Packet files contain no bearer tokens. Use the host-only secret returned once by the authority command; if it was lost, wait for that authority deadline, then run recover --grace-seconds 0.",
    "",
    ...gateEvidenceLines(),
    "",
    "## Waves",
    "",
    ...topologyRows(topology, tasks),
    "",
    "## Agent grants",
    "",
    ...agentRows(agents),
    "",
    "## Branches",
    "",
    ...jsonRows(branches),
    "",
    "## Tasks",
    "",
    ...jsonRows(tasks),
    "",
    "## Requirements",
    "",
    ...jsonRows(requirements),
    "",
    "## Open findings",
    "",
    ...jsonRows(findings),
    "",
    "## Gates and commands",
    "",
    ...jsonRows([...(view.gates as unknown[]), ...(view.commands as unknown[])]),
    "",
    "## Packets and orphan evidence",
    "",
    ...jsonRows([
      ...(view.packets as unknown[]),
      ...(view.orphan_evidence as unknown[]),
      ...(view.orphan_evidence_dispositions as unknown[]),
    ]),
    "",
    "## Completion",
    "",
    JSON.stringify({
      critic: view.completion_critic,
      critic_history: view.completion_critic_history,
      review: view.completion_review,
      reviews: view.completion_reviews,
      remediations: view.completion_remediations,
      verification: view.completion_verification,
      result: view.completion_result,
      current_repository_binding: view.current_repository_binding,
    }),
    "",
    "## Completion blockers",
    "",
    ...((view.completion_blockers as string[]).length
      ? (view.completion_blockers as string[])
      : ["none"]),
    "",
    "## Recent events",
    "",
    ...(recent.length ? recent : ["none"]),
    "",
    "## Exact next argv",
    "",
    ...actions.argv.map((argv) => JSON.stringify(argv)),
    "",
    "## Steps with no CLI command",
    "",
    ...(actions.unavailable.length ? actions.unavailable : ["none"]),
    "",
  ].join("\n");
}

export function writeHandoff(runRoot: string): string {
  const path = join(runRoot, "handoff.md");
  atomicWriteBytes(path, new TextEncoder().encode(renderHandoff(runRoot)), { mode: 0o444 });
  return path;
}

/**
 * The restart document is derived, so a failure to regenerate it must not fail the command that
 * changed the state: the capsule is already durable by the time this runs, and refusing the write
 * would report a completed transition as an error. The path is returned only when it was written,
 * so a caller never claims a document that is not there.
 */
export function refreshHandoff(runRoot: string): string | undefined {
  try {
    return writeHandoff(runRoot);
  } catch {
    return undefined;
  }
}

/**
 * Escalation is where the automated path stops: the repair budget is spent and a fresh reader has
 * to take the run over. That reader is exactly who the restart document is for, so it is rewritten
 * at the moment the task escalates rather than at whatever command happens to run next.
 */
export function refreshHandoffOnEscalation(runRoot: string, status: string): string | undefined {
  return status === "escalated" ? refreshHandoff(runRoot) : undefined;
}
