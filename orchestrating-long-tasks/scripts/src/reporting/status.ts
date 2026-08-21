import { fileURLToPath } from "node:url";
import { indexFreshness, loadIndex, loadRun, verifyIntegrity } from "../store/index.ts";
import type { IndexFreshness } from "../store/capsule-index.ts";
import { workflowView } from "./workflow-view.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../contracts/trusted-host.ts";
import { readAgentLedger } from "../workflow/agents/ledger.ts";
import { nextActions } from "./next-actions.ts";
import type { NextActions } from "./action-types.ts";
import type { JsonObject } from "../contracts/json.ts";
import { enforceLineLimit } from "../cli/formatters/line-limiter.ts";

const ENTRYPOINT = fileURLToPath(new URL("../../harness.ts", import.meta.url));

function counts(values: readonly unknown[], field: string): Record<string, number> {
  const result: Record<string, number> = {};
  for (const value of values) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
    const key = (value as Record<string, unknown>)[field];
    if (typeof key === "string") result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

export interface CatalogueCounts {
  tasks: number;
  commands: number;
  findings: number;
  open_findings: number;
  reports: number;
  captures: number;
  blobs: number;
  packets: number;
}

export interface CapsuleCatalogue {
  available: boolean;
  freshness: IndexFreshness;
  index_of_event?: { sequence: number; head: string | null } | undefined;
  counts?: CatalogueCounts | undefined;
  stored_bytes?: number | undefined;
}

export function capsuleCatalogue(runRoot: string): CapsuleCatalogue {
  let index;
  try {
    index = loadIndex(runRoot).index;
  } catch {
    return { available: false, freshness: "unknown" };
  }
  return {
    available: true,
    freshness: indexFreshness(runRoot, index),
    index_of_event: index.index_of_event,
    counts: {
      tasks: index.tasks.length,
      commands: index.commands.length,
      findings: index.findings.length,
      open_findings: index.tasks.reduce((sum, task) => sum + task.open_finding_ids.length, 0),
      reports: index.reports.length,
      captures: index.captures.length,
      blobs: index.blobs.length,
      packets: index.packets.length,
    },
    stored_bytes: index.blobs.reduce((sum, blob) => sum + blob.bytes, 0),
  };
}

export interface StatusBriefParams {
  readonly runId: string;
  readonly runRoot: string;
  readonly phase: string;
  readonly tasksCount: number;
  readonly satisfiedCount: number;
  readonly actions: NextActions;
  readonly catalogue?: CapsuleCatalogue | undefined;
  readonly maxLines?: number | undefined;
}

export function formatStatusBrief(params: StatusBriefParams): string {
  const maxLines = params.maxLines ?? 30;
  const headerLines = [
    `### Run Status: ${params.runId} (Phase: ${params.phase})`,
    `- **Capsule**: \`${params.runRoot}\``,
    `- **Progress**: ${params.satisfiedCount}/${params.tasksCount} tasks satisfied`,
  ];
  if (params.catalogue?.stored_bytes !== undefined) {
    headerLines.push(`- **Stored**: ${params.catalogue.stored_bytes} B`);
  }
  headerLines.push("", "#### Next Actions:");

  const totalActions = params.actions.argv.length;
  if (totalActions === 0) {
    if (params.actions.unavailable.length > 0) {
      for (const reason of params.actions.unavailable) {
        headerLines.push(`- *Unavailable*: ${reason}`);
      }
    } else {
      headerLines.push("- *None*");
    }
    return enforceLineLimit(headerLines.join("\n"), maxLines);
  }

  const remainingBudget = maxLines - headerLines.length;
  if (totalActions <= remainingBudget) {
    for (const argv of params.actions.argv) {
      headerLines.push(`- \`${argv.join(" ")}\``);
    }
    return enforceLineLimit(headerLines.join("\n"), maxLines);
  }

  const actionBudget = Math.max(0, remainingBudget - 1);
  const renderedActions = params.actions.argv.slice(0, actionBudget);
  const remainderCount = totalActions - actionBudget;

  for (const argv of renderedActions) {
    headerLines.push(`- \`${argv.join(" ")}\``);
  }
  if (remainderCount > 0) {
    headerLines.push(`*... and ${remainderCount} more actions (${totalActions} total)*`);
  }

  return enforceLineLimit(headerLines.join("\n"), maxLines);
}

export function runStatus(
  runRoot: string,
  entrypoint: string = ENTRYPOINT,
): Record<string, unknown> {
  const issues = verifyIntegrity(runRoot);
  let loaded;
  try {
    loaded = loadRun(runRoot, issues.length === 0);
  } catch {
    loaded = undefined;
  }

  if (loaded === undefined) {
    const actions: NextActions = { argv: [], unavailable: [] };
    const catalogue = capsuleCatalogue(runRoot);
    const markdown = formatStatusBrief({
      runId: runRoot.split("/").pop() ?? runRoot,
      runRoot,
      phase: "Corrupted",
      tasksCount: 0,
      satisfiedCount: 0,
      actions,
      catalogue,
    });
    return {
      run_root: runRoot,
      run_id: runRoot.split("/").pop() ?? runRoot,
      assurance: "unverified",
      gate_evidence: trustedHostEvidence(),
      gate_evidence_limitations: trustedHostLimitations(),
      prompt_sha256: null,
      revision: 0,
      graph_revision: null,
      counts: {},
      requirement_counts: {},
      integrity_issues: issues,
      catalogue,
      next_actions: actions,
      next_argv: actions.argv,
      markdown,
      recent_events: [],
    };
  }

  const tasks = Object.values((loaded.state.tasks ?? {}) as Record<string, unknown>);
  const requirementDocument = loaded.state.requirements as Record<string, unknown> | undefined;
  const requirements = Array.isArray(requirementDocument?.requirements)
    ? requirementDocument.requirements
    : [];
  const graph = loaded.state.graph as Record<string, unknown> | undefined;
  const view = graph === undefined || issues.length > 0 ? {} : workflowView(runRoot);
  const agents = readAgentLedger(loaded.state);
  const actions =
    graph === undefined || issues.length > 0
      ? { argv: [], unavailable: [] }
      : nextActions(loaded.runRoot, entrypoint, view as JsonObject, agents);

  const phase = loaded.state.completion_result
    ? "Completed"
    : graph
      ? "Executing"
      : "Planning";

  const catalogue = capsuleCatalogue(loaded.runRoot);
  const satisfiedCount = tasks.filter(
    (t) => typeof t === "object" && t !== null && (t as { status?: string }).status === "done",
  ).length;

  const markdown = formatStatusBrief({
    runId: loaded.manifest.run_id,
    runRoot: loaded.runRoot,
    phase,
    tasksCount: tasks.length,
    satisfiedCount,
    actions,
    catalogue,
  });

  return {
    run_root: loaded.runRoot,
    run_id: loaded.manifest.run_id,
    assurance: loaded.manifest.assurance,
    gate_evidence: trustedHostEvidence(),
    gate_evidence_limitations: trustedHostLimitations(),
    prompt_sha256: loaded.manifest.prompt_sha256,
    revision: loaded.state.revision,
    graph_revision: graph?.revision ?? null,
    counts: counts(tasks, "status"),
    requirement_counts: counts(requirements, "status"),
    integrity_issues: issues,
    catalogue,
    next_actions: actions,
    next_argv: actions.argv,
    markdown,
    ...view,
    recent_events: loaded.events.slice(-10).map(({ sequence, timestamp, actor, kind, hash }) => ({
      sequence,
      timestamp,
      actor,
      kind,
      hash,
    })),
  };
}
