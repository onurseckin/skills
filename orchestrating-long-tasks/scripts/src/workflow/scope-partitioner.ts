import { posix } from "node:path";
import { checkScopeOverlap, normalizeScopePath } from "../graph/scope-analyzer.ts";

export interface FindingDetail {
  readonly id: string;
  readonly requirement_id?: string | undefined;
  readonly severity: "critical" | "important" | "suggestion" | "minor";
  readonly file_paths: readonly string[];
  readonly observation: string;
  readonly remediation: string;
  readonly revalidation_gate?: string | undefined;
}

export interface ScopedRepairCluster {
  readonly taskId: string;
  readonly label: string;
  readonly writeScope: readonly string[];
  readonly findings: readonly FindingDetail[];
  readonly gateCommand: readonly string[];
  readonly effort: number;
}

export function computeLcaDirectory(paths: readonly string[]): string {
  if (paths.length === 0) return ".";
  const normalized = paths.map(normalizeScopePath).filter(Boolean);
  if (normalized.length === 0) return ".";
  if (normalized.length === 1) {
    const single = normalized[0]!;
    const dir = posix.dirname(single);
    return dir === "." ? single : dir;
  }
  const splitPaths = normalized.map((p) => p.split("/"));
  const minLen = Math.min(...splitPaths.map((p) => p.length));
  const commonSegments: string[] = [];
  for (let i = 0; i < minLen; i++) {
    const segment = splitPaths[0]![i]!;
    if (splitPaths.every((p) => p[i] === segment)) {
      commonSegments.push(segment);
    } else {
      break;
    }
  }
  if (commonSegments.length === 0) return ".";
  const joined = commonSegments.join("/");
  return joined.includes(".") ? posix.dirname(joined) : joined;
}

export function partitionFindingsIntoScopes(
  findings: readonly FindingDetail[],
  repairRound = 1,
): readonly ScopedRepairCluster[] {
  if (findings.length === 0) return [];

  interface MutableCluster {
    scope: string;
    findings: FindingDetail[];
  }
  const rawClusters: MutableCluster[] = [];

  for (const finding of findings) {
    const lca = computeLcaDirectory(finding.file_paths);
    const existing = rawClusters.find((c) => c.scope === lca);
    if (existing) {
      existing.findings.push(finding);
    } else {
      rawClusters.push({ scope: lca, findings: [finding] });
    }
  }

  // Iterative merge for parent/child or overlapping scopes
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < rawClusters.length; i++) {
      for (let j = i + 1; j < rawClusters.length; j++) {
        const a = rawClusters[i]!;
        const b = rawClusters[j]!;
        const overlap = checkScopeOverlap([a.scope], [b.scope]);
        if (overlap.hasOverlap) {
          const mergedScope =
            a.scope === overlap.conflictingPath && overlap.relation === "parent_child"
              ? a.scope.length < b.scope.length
                ? a.scope
                : b.scope
              : posix.dirname(overlap.conflictingPath);

          a.scope = mergedScope === "" ? "." : mergedScope;
          a.findings.push(...b.findings);
          rawClusters.splice(j, 1);
          changed = true;
          break;
        }
      }
      if (changed) break;
    }
  }

  return rawClusters.map((cluster) => {
    const slug = cluster.scope.replace(/[^a-zA-Z0-9]/g, "-").replace(/^-+|-+$/g, "") || "root";
    const taskId = `repair-R${repairRound}-${slug}`;
    const label = `Repair Wave ${repairRound}: ${cluster.scope}`;
    const effort = Math.min(5, Math.max(1, cluster.findings.length + 1));
    const gateCommand = ["bun", "test", "tests"];

    return {
      taskId,
      label,
      writeScope: [cluster.scope],
      findings: cluster.findings,
      gateCommand,
      effort,
    };
  });
}
