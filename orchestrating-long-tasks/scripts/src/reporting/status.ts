import { indexFreshness, loadIndex, loadRun, verifyIntegrity } from "../store/index.ts";
import type { IndexFreshness } from "../store/capsule-index.ts";
import { workflowView } from "./workflow-view.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../contracts/trusted-host.ts";

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
  /** False when the catalogue could not be read at all, in which case it counts nothing. */
  available: boolean;
  freshness: IndexFreshness;
  index_of_event?: { sequence: number; head: string | null } | undefined;
  counts?: CatalogueCounts | undefined;
  stored_bytes?: number | undefined;
}

/**
 * The catalogue as an operator sees it: what the capsule holds, and whether the catalogue still
 * describes where the run stands. A catalogue that might be stale is reported as unknown rather
 * than presented as current, and one that cannot be read counts nothing rather than counting zero.
 */
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

export function runStatus(runRoot: string): Record<string, unknown> {
  const issues = verifyIntegrity(runRoot);
  const loaded = loadRun(runRoot, issues.length === 0);
  const tasks = Object.values((loaded.state.tasks ?? {}) as Record<string, unknown>);
  const requirementDocument = loaded.state.requirements as Record<string, unknown> | undefined;
  const requirements = Array.isArray(requirementDocument?.requirements)
    ? requirementDocument.requirements
    : [];
  const graph = loaded.state.graph as Record<string, unknown> | undefined;
  const view = graph === undefined || issues.length > 0 ? {} : workflowView(runRoot);
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
    catalogue: capsuleCatalogue(loaded.runRoot),
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
