import { advisory, finding, type HealthCheckResult, type HealthFinding } from "./types.ts";
import { resolveOrigin, type ModuleRecord } from "./modules.ts";

export interface ReachabilityInput {
  readonly production: ReadonlyMap<string, ModuleRecord>;
  readonly entryPoints: readonly string[];
  readonly tests: ReadonlyMap<string, ModuleRecord>;
}

const LIMITATIONS: readonly string[] = [
  "Resolution is lexical: a symbol reached only through a computed property, `eval`, or a dynamic `import()` reads as unused.",
  "A namespace import (`import * as ns`) marks every export of the imported module used, because the member accessed is not tracked.",
  "Type-only symbols consumed through structural inference rather than by name are not detected as used.",
];

interface Usage {
  readonly consumers: Map<string, Set<string>>;
  readonly importedModules: Set<string>;
  readonly namespaces: Set<string>;
}

function emptyUsage(): Usage {
  return { consumers: new Map(), importedModules: new Set(), namespaces: new Set() };
}

function usageIndex(
  modules: ReadonlyMap<string, ModuleRecord>,
  production: ReadonlyMap<string, ModuleRecord>,
  usage: Usage,
): void {
  const { consumers, namespaces } = usage;
  for (const record of modules.values()) {
    for (const binding of record.imports) {
      if (!production.has(binding.from)) continue;
      usage.importedModules.add(binding.from);
      if (binding.imported === "*") {
        namespaces.add(binding.from);
        continue;
      }
      const origin = resolveOrigin(production, { module: binding.from, name: binding.imported });
      if (origin.module === record.path) continue;
      usage.importedModules.add(origin.module);
      const key = `${origin.module}#${origin.name}`;
      const existing = consumers.get(key);
      if (existing === undefined) consumers.set(key, new Set([record.relative]));
      else existing.add(record.relative);
    }
    for (const entry of record.exports) {
      if (entry.origin === undefined) continue;
      const origin = resolveOrigin(production, entry.origin);
      const key = `${origin.module}#${origin.name}`;
      if (!consumers.has(key)) consumers.set(key, new Set());
    }
  }
}

function reachableModules(
  production: ReadonlyMap<string, ModuleRecord>,
  entryPoints: readonly string[],
): Set<string> {
  const reached = new Set<string>();
  const queue = entryPoints.filter((path) => production.has(path));
  while (queue.length > 0) {
    const path = queue.pop();
    if (path === undefined || reached.has(path)) continue;
    reached.add(path);
    const record = production.get(path);
    if (record === undefined) continue;
    for (const next of [
      ...record.imports.map((binding) => binding.from),
      ...record.starReexports,
      ...record.exports.flatMap((entry) =>
        entry.origin === undefined ? [] : [entry.origin.module],
      ),
    ]) {
      if (production.has(next) && !reached.has(next)) queue.push(next);
    }
  }
  return reached;
}

const TYPE_ONLY_KINDS: ReadonlySet<string> = new Set(["interface", "type"]);

function referencedLocally(record: ModuleRecord, name: string): boolean {
  const pattern = new RegExp(`\\b${name.replace(/[$]/gu, "\\$")}\\b`, "gu");
  return [...record.source.scan.identifiers.matchAll(pattern)].length > 1;
}

export function checkUnusedCode(input: ReachabilityInput): HealthCheckResult {
  const production = emptyUsage();
  usageIndex(input.production, input.production, production);
  const tests = emptyUsage();
  usageIndex(input.tests, input.production, tests);

  const reached = reachableModules(input.production, input.entryPoints);
  const entries = new Set(input.entryPoints);
  const findings: HealthFinding[] = [];

  for (const record of input.production.values()) {
    if (!reached.has(record.path)) {
      findings.push(
        finding(
          "unused-code",
          `module-unreachable:${record.relative}`,
          record.relative,
          "the module is not reachable from any entry point; nothing it exports can ever run",
        ),
      );
      continue;
    }
    if (production.namespaces.has(record.path)) continue;
    if (
      !entries.has(record.path) &&
      !production.importedModules.has(record.path) &&
      tests.importedModules.has(record.path)
    ) {
      findings.push(
        finding(
          "unused-code",
          `module-test-only:${record.relative}`,
          record.relative,
          "no production module imports anything from it; only tests do, so the subsystem it implements never runs",
        ),
      );
    }
    for (const entry of record.exports) {
      if (entry.origin !== undefined) continue;
      const key = `${record.path}#${entry.name}`;
      if ((production.consumers.get(key)?.size ?? 0) > 0) continue;
      const testers = [...(tests.consumers.get(key) ?? [])].sort();
      const local = referencedLocally(record, entry.name);
      const detail =
        testers.length > 0
          ? `exported ${entry.kind} imported only by tests (${testers.slice(0, 3).join(", ")})${local ? "; its only production callers are inside its own module" : "; no production code calls it"}`
          : local
            ? `exported ${entry.kind} referenced only inside its own module; the export surface is unused`
            : `exported ${entry.kind} has no importer anywhere`;
      const build = TYPE_ONLY_KINDS.has(entry.kind) || local ? advisory : finding;
      findings.push(
        build(
          "unused-code",
          `unused-export:${record.relative}#${entry.name}`,
          record.relative,
          detail,
          entry.line,
        ),
      );
    }
  }

  return {
    check: "unused-code",
    title: "Unused code: exported symbols with no caller, modules with no entry path",
    findings,
    scanned: input.production.size,
    limitations: LIMITATIONS,
  };
}
