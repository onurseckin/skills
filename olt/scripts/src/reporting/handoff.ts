import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readTopology } from "../core/contracts/topology.ts";
import { atomicWriteBytes } from "../core/durable-write.ts";
import { loadRun } from "../engine/store/index.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import type { TaskView } from "./action-types.ts";
import { agentRows, liveWaveLine, topologyRows } from "./handoff-sections.ts";
import { nextActions } from "./next-actions.ts";
import { workflowView } from "./workflow-view.ts";
import { renderPreplanHandoff } from "./preplan-handoff.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../core/contracts/trusted-host.ts";

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

export function refreshHandoff(runRoot: string): string | undefined {
  try {
    return writeHandoff(runRoot);
  } catch {
    return undefined;
  }
}

export function refreshHandoffOnEscalation(runRoot: string, status: string): string | undefined {
  return status === "escalated" ? refreshHandoff(runRoot) : undefined;
}
