import {
  defectKey,
  type EngineDeclaration,
  type EngineInvocation,
  type EngineWiringReport,
  type SourceDocument,
  type WiringDefect,
} from "./engine-wiring-contracts.ts";
import { collectEngineDeclarations, collectEngineInvocations } from "./engine-wiring-inventory.ts";
import { analyzeInertness } from "./engine-wiring-inertness.ts";
import { ACCEPTED_ENGINE_WIRING_DEFECTS } from "./engine-wiring-baseline.ts";

function siteLabel(invocation: EngineInvocation): string {
  return `${invocation.path}:${invocation.line}`;
}

export function classifyNeverInvoked(
  declaration: EngineDeclaration,
  sites: readonly EngineInvocation[],
): WiringDefect | undefined {
  if (sites.length > 0) return undefined;
  return {
    engine: declaration.name,
    condition: "exported-but-never-invoked",
    declaredAt: `${declaration.path}:${declaration.line}`,
    evidence: "exported from the doctor tree with zero call sites in non-test source",
  };
}

export function classifyCannotFail(
  declaration: EngineDeclaration,
  sites: readonly EngineInvocation[],
  document: SourceDocument | undefined,
): WiringDefect | undefined {
  if (sites.length === 0) return undefined;
  if (!sites.every((site) => site.argumentCount === 0)) return undefined;
  if (declaration.parameterCount !== 1) return undefined;
  if (!declaration.emptyObjectDefault) return undefined;
  if (document === undefined) return undefined;
  const verdict = analyzeInertness(document, declaration.name);
  if (!verdict.inert) return undefined;
  return {
    engine: declaration.name,
    condition: "invoked-but-cannot-fail",
    declaredAt: `${declaration.path}:${declaration.line}`,
    evidence: `every call site passes zero arguments (${sites.map(siteLabel).join(", ")}) and the engine is a ${verdict.reason}`,
  };
}

export function auditEngineWiring(documents: readonly SourceDocument[]): EngineWiringReport {
  const declarations = collectEngineDeclarations(documents);
  const names = [...new Set(declarations.map((declaration) => declaration.name))];
  const invocations = collectEngineInvocations(documents, names);
  const byPath = new Map(documents.map((document) => [document.path, document]));

  const defects: WiringDefect[] = [];
  for (const declaration of declarations) {
    const sites = invocations.filter((invocation) => invocation.name === declaration.name);
    const document = byPath.get(declaration.path);
    const orphaned = classifyNeverInvoked(declaration, sites);
    if (orphaned !== undefined) defects.push(orphaned);
    const inert = classifyCannotFail(declaration, sites, document);
    if (inert !== undefined) defects.push(inert);
  }

  const accepted = new Set(ACCEPTED_ENGINE_WIRING_DEFECTS);
  const observed = new Set(defects.map(defectKey));
  const introduced = defects.filter((defect) => !accepted.has(defectKey(defect)));
  const stillAccepted = defects.filter((defect) => accepted.has(defectKey(defect)));
  const resolved = [...accepted].filter((key) => !observed.has(key)).sort();

  return {
    exportedEngines: names.sort(),
    invokedEngines: [...new Set(invocations.map((invocation) => invocation.name))].sort(),
    declarations,
    invocations,
    defects,
    introduced,
    accepted: stillAccepted,
    resolved,
    passed: introduced.length === 0,
  };
}

export function formatEngineWiringReport(report: EngineWiringReport): string {
  const lines: string[] = [];
  lines.push("# Doctor engine wiring report");
  lines.push("");
  lines.push(`Status: ${report.passed ? "passed" : "failed"}`);
  lines.push(`Exported engines: ${report.exportedEngines.length}`);
  lines.push(`Invoked engines: ${report.invokedEngines.length}`);
  lines.push(`Defects: ${report.defects.length}`);
  lines.push(`Accepted by baseline: ${report.accepted.length}`);
  lines.push(`Newly introduced: ${report.introduced.length}`);
  lines.push("");
  for (const defect of report.defects) {
    const status = report.introduced.includes(defect) ? "INTRODUCED" : "accepted";
    lines.push(`- [${status}] ${defect.engine} [${defect.condition}] at ${defect.declaredAt}`);
    lines.push(`    ${defect.evidence}`);
  }
  if (report.resolved.length > 0) {
    lines.push("");
    lines.push("Resolved baseline entries (safe to delete):");
    for (const key of report.resolved) lines.push(`  - ${key}`);
  }
  return `${lines.join("\n")}\n`;
}
