import { loadRun, verifyIntegrity } from "../store/index.ts";
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
