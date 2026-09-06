import { HarnessError } from "../../../core/errors/index.ts";
import {
  classifyDomain,
  generateClusterId,
  generatePlanPath,
} from "../../preplanning/backlog-clusterer.ts";
import { dispatchMultiOrchestratorClusters } from "../../preplanning/multi-orchestrator-dispatch.ts";
import type {
  DomainCategory,
  MultiOrchestratorDispatchPlan,
  ThematicCluster,
} from "../../preplanning/types.ts";
import type { GroundedFeatureProposal, MindProductManagerOptions } from "./types.ts";

export function resolveDomainForProposal(proposal: GroundedFeatureProposal): DomainCategory {
  const scopeJoined = proposal.writeScope.join(" ");
  return classifyDomain(proposal.title, `${proposal.statement} ${scopeJoined}`);
}

export function buildClustersFromProposals(
  proposals: readonly GroundedFeatureProposal[],
  timestamp?: string,
): readonly ThematicCluster[] {
  const domainMap = new Map<DomainCategory, GroundedFeatureProposal[]>();

  for (const p of proposals) {
    const domain = resolveDomainForProposal(p);
    const existing = domainMap.get(domain);
    if (existing !== undefined) {
      existing.push(p);
    } else {
      domainMap.set(domain, [p]);
    }
  }

  const clusters: ThematicCluster[] = [];
  const plannedAt = timestamp !== undefined ? timestamp : new Date().toISOString();

  for (const [domain, domainProps] of domainMap.entries()) {
    const propIds = domainProps.map((p) => p.id);
    const clusterId = generateClusterId(domain, propIds, [], timestamp);
    const planPath = generatePlanPath(clusterId);
    const domainCap = domain.charAt(0).toUpperCase() + domain.slice(1);

    clusters.push({
      cluster_id: clusterId,
      domain,
      title: `${domainCap} Feature Cluster`,
      plan_path: planPath,
      backlog_item_ids: Object.freeze(propIds),
      defect_ids: Object.freeze([]),
      planned_at: plannedAt,
      description: `Synthesized feature cluster for domain ${domain}`,
    });
  }

  return Object.freeze(clusters);
}

export function buildProductManagerMultiOrchDispatch(
  proposals: readonly GroundedFeatureProposal[],
  options: MindProductManagerOptions,
): MultiOrchestratorDispatchPlan {
  const clusters = buildClustersFromProposals(proposals);

  if (clusters.length >= 2 && options.orchestratorCount === 1) {
    throw new HarnessError(
      "INTEGRITY",
      `SINGLE_ORCHESTRATOR_BOTTLENECK_VIOLATION: Multiple disjoint clusters/domains detected (count=${clusters.length}) but orchestrator count is restricted to 1. Multi-orchestrator scaling mandated.`,
    );
  }

  const root =
    options.repoRoot !== undefined
      ? options.repoRoot
      : options.workspaceRoot !== undefined
        ? options.workspaceRoot
        : process.cwd();

  return dispatchMultiOrchestratorClusters(clusters, {
    rootDir: root,
  });
}
