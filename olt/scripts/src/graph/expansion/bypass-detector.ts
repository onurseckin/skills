import { isRecord } from "../../requirements/predicates.ts";
import type { BypassViolation, CognitiveGuidance, TransitiveBypassCheckResult } from "./types.ts";

export function detectTransitiveBypasses(
  nodes: readonly Record<string, unknown>[],
  edges: readonly Record<string, unknown>[],
): TransitiveBypassCheckResult {
  const taskMap = new Map<string, Record<string, unknown>>();
  const nodeIds = new Set<string>();

  for (const node of nodes) {
    if (isRecord(node) && typeof node.id === "string") {
      nodeIds.add(node.id);
      if (node.type === "task") {
        taskMap.set(node.id, node);
      }
    }
  }

  const adj = new Map<string, string[]>();
  for (const id of nodeIds) {
    adj.set(id, []);
  }

  const depEdges: { source: string; target: string; type: string }[] = [];
  for (const edge of edges) {
    if (
      isRecord(edge) &&
      typeof edge.source === "string" &&
      typeof edge.target === "string" &&
      edge.type === "depends_on"
    ) {
      depEdges.push({ source: edge.source, target: edge.target, type: edge.type });
      adj.get(edge.source)?.push(edge.target);
    }
  }

  function findAllPaths(start: string, target: string, maxDepth = 6): string[][] {
    const paths: string[][] = [];
    function dfs(curr: string, currentPath: string[]): void {
      if (currentPath.length > maxDepth) return;
      if (curr === target) {
        if (currentPath.length > 2) {
          paths.push([...currentPath]);
        }
        return;
      }
      const neighbors = adj.get(curr) ?? [];
      for (const next of neighbors) {
        if (!currentPath.includes(next)) {
          currentPath.push(next);
          dfs(next, currentPath);
          currentPath.pop();
        }
      }
    }
    dfs(start, [start]);
    return paths;
  }

  const violations: BypassViolation[] = [];
  const warnings: string[] = [];

  for (const edge of depEdges) {
    const longerPaths = findAllPaths(edge.source, edge.target);
    if (longerPaths.length > 0) {
      for (const path of longerPaths) {
        const intermediate = path.slice(1, -1);
        const bypassedStage = intermediate[0]!;
        const bypassedTask = taskMap.get(bypassedStage);
        const isValidatorStage =
          bypassedStage.startsWith("val-") || (bypassedTask && bypassedTask.role === "validator");

        const invariantName = isValidatorStage
          ? "A3-gate-discrimination / Validator Bypass Invariant"
          : "Transitive Graph Integrity Invariant";

        const reason = isValidatorStage
          ? `Direct dependency edge [${edge.source} -> ${edge.target}] bypasses mandatory validator stage '${bypassedStage}' in intermediate path (${path.join(" -> ")})`
          : `Direct dependency edge [${edge.source} -> ${edge.target}] creates redundant transitive bypass over intermediate stage (${intermediate.join(" -> ")})`;

        const guidance: CognitiveGuidance = {
          summary: `Direct edge ${edge.source} -> ${edge.target} bypasses intermediate stage ${bypassedStage}.`,
          invariant: invariantName,
          rationale:
            `In a high-leverage execution topology, downstream consumers must depend on verified validation outcomes ` +
            `or intermediate milestones rather than short-circuiting around them. Bypassing stage '${bypassedStage}' violates graph monotonicity.`,
          remediationAction: `Remove direct bypass edge [${edge.source} -> ${edge.target}] and ensure dependency is routed through the intermediate stage '${bypassedStage}' ([${edge.source} -> ${bypassedStage}]).`,
          suggestedRemediationEdges: [
            { source: edge.source, target: bypassedStage, type: "depends_on" },
          ],
        };

        violations.push({
          code: "TRANSITIVE_BYPASS_VIOLATION",
          edge: { source: edge.source, target: edge.target },
          bypassedPath: path,
          bypassedStage,
          reason,
          guidance,
        });

        warnings.push(`[TRANSITIVE BYPASS]: ${reason}`);
      }
    }
  }

  for (const edge of depEdges) {
    const targetTask = taskMap.get(edge.target);
    if (targetTask && typeof targetTask.paired_validator_id === "string") {
      const valId = targetTask.paired_validator_id;
      if (edge.source !== valId && taskMap.has(valId)) {
        const sourceDeps = adj.get(edge.source) ?? [];
        if (!sourceDeps.includes(valId)) {
          const reason = `Task ${edge.source} directly depends on implementer ${edge.target} instead of its paired validator ${valId}.`;
          const guidance: CognitiveGuidance = {
            summary: `Downstream consumer ${edge.source} bypasses paired validator ${valId} for ${edge.target}.`,
            invariant: "Validator-First Downstream Consumption Invariant",
            rationale:
              `Downstream tasks must consume validated artifacts produced by the paired validator stage '${valId}' ` +
              `to guarantee that unverified implementations never cascade downstream.`,
            remediationAction: `Rewire dependency: make ${edge.source} depend on ${valId} instead of raw ${edge.target}.`,
            suggestedRemediationEdges: [{ source: edge.source, target: valId, type: "depends_on" }],
          };

          violations.push({
            code: "TRANSITIVE_BYPASS_VIOLATION",
            edge: { source: edge.source, target: edge.target },
            bypassedPath: [edge.source, edge.target, valId],
            bypassedStage: valId,
            reason,
            guidance,
          });

          warnings.push(`[VALIDATOR BYPASS]: ${reason}`);
        }
      }
    }
  }

  return {
    hasBypass: violations.length > 0,
    violations,
    warnings,
  };
}
