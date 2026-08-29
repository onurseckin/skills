import {
  assertRootConvention,
  type CheckOptions,
  type CheckReport,
  classifyPath,
  type Violation,
} from "./core/index.ts";
import {
  buildImportEdges,
  findExportStarViolations,
  findFacadeViolations,
  findMissingFacades,
  stronglyConnectedComponents,
} from "./graph/index.ts";
import {
  findFanoutViolations,
  findLineViolations,
  readIndexedBlobs,
  readTreeBlobs,
} from "./inventory/index.ts";
import {
  compareBaseline,
  findGeneratedCatalogViolations,
  loadBaseline,
  type ModularityBaseline,
} from "./policy/index.ts";

const DEFAULT_BASELINE = "scripts/modularity/baseline/index.json";

function cycleViolations(edges: ReturnType<typeof buildImportEdges>): readonly Violation[] {
  return stronglyConnectedComponents(edges).map((component) => ({
    rule: "dependency_cycle" as const,
    path: component[0],
    observed: component.join(","),
    detail: "Import graph contains a strongly connected component.",
  }));
}

function currentBaseline(violations: readonly Violation[]): ModularityBaseline {
  const unique = new Map<string, Violation>();
  for (const violation of violations) {
    unique.set(
      `${violation.rule}:${violation.path}:${violation.observed}:${violation.detail}`,
      violation,
    );
  }
  return {
    schema: "olt-modularity-baseline/v1",
    violations: [...unique.values()],
  };
}

export async function checkModularity(options: CheckOptions): Promise<CheckReport> {
  const baseline =
    options.mode === "ratchet"
      ? await loadBaseline(options.repoRoot, options.baselinePath ?? DEFAULT_BASELINE)
      : undefined;
  const blobs =
    options.source === "index"
      ? await readIndexedBlobs(options.repoRoot)
      : await readTreeBlobs(options.repoRoot);
  const typeScriptBlobs = blobs.filter((blob) => classifyPath(blob.path).importScanned);
  const edges = buildImportEdges(blobs);
  const productionEdges = edges.filter(
    (edge) => !edge.from.startsWith("tests/") && !edge.to.startsWith("tests/"),
  );
  const violations = [
    ...findLineViolations(blobs),
    ...findFanoutViolations(blobs),
    ...findMissingFacades(blobs),
    ...findExportStarViolations(typeScriptBlobs),
    ...findFacadeViolations(edges),
    ...cycleViolations(productionEdges),
    ...findGeneratedCatalogViolations(blobs),
    ...assertRootConvention(blobs.map((blob) => blob.path)),
  ];
  if (options.mode === "strict") {
    return {
      mode: options.mode,
      source: options.source,
      violations,
      baselineDelta: { added: [], worsened: [], resolved: [] },
      passed: violations.length === 0,
    };
  }
  const comparison = compareBaseline(baseline!, currentBaseline(violations));
  return {
    mode: options.mode,
    source: options.source,
    violations,
    ...comparison,
  };
}
