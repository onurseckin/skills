import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { applyAllowances } from "./allowlist.ts";
import { checkDeadCode } from "./dead-code.ts";
import { checkLiteralFallbacks } from "./fallbacks.ts";
import { checkIntentDrift, type IntentDocument } from "./intent.ts";
import { buildModules } from "./modules.ts";
import { scanUnreadParameters } from "./parameters.ts";
import { checkUnusedCode } from "./reachability.ts";
import { listFiles, loadSources, type SourceFile } from "./sources.ts";
import { checkDeclarations } from "./unenforced.ts";
import {
  checkUnqualifiedDispatch,
  checkVendorIdentifiers,
  PRODUCT_GRAMMAR_MODULES,
} from "./vendors.ts";
import type { HealthCheckId, HealthCheckResult, HealthReport } from "./types.ts";

export const ALL_CHECKS: readonly HealthCheckId[] = [
  "unused-code",
  "dead-code",
  "unenforced-declarations",
  "intent-drift",
  "literal-fallbacks",
  "vendor-identifiers",
  "vendor-prose",
];

export interface HealthLayout {
  readonly repoRoot: string;
  readonly skillRoot: string;
  readonly scriptsRoot: string;
  readonly testsRoot?: string;
  readonly documents: readonly IntentDocument[];
  readonly consumerRoot?: string;
}

const PLANNING_DIRECTORY = "docs/planning/orchestration-overhaul";
const REQUIREMENT_DOCUMENTS = ["SPEC.md", "BACKLOG.md"];

function selfScriptsRoot(): string {
  return resolve(dirname(new URL(import.meta.url).pathname), "..", "..");
}

export function defaultLayout(scriptsRoot: string = selfScriptsRoot()): HealthLayout {
  const skillRoot = resolve(scriptsRoot, "..");
  const repoRoot = resolve(skillRoot, "..");
  const testsRoot = join(repoRoot, "tests");
  const documents = REQUIREMENT_DOCUMENTS.map((name) => ({
    relative: `${PLANNING_DIRECTORY}/${name}`,
    absolute: join(repoRoot, PLANNING_DIRECTORY, name),
    headingLevel: 2,
  })).filter((document) => existsSync(document.absolute));
  return {
    repoRoot,
    skillRoot,
    scriptsRoot,
    documents,
    ...(existsSync(testsRoot) ? { testsRoot } : {}),
  };
}

function isModule(file: SourceFile): boolean {
  return !file.path.endsWith(".d.ts");
}

function entryPoints(scriptsRoot: string): string[] {
  return listFiles(scriptsRoot, [".ts"]).filter(
    (path) => dirname(path) === resolve(scriptsRoot) && !path.endsWith(".d.ts"),
  );
}

interface Skip {
  readonly check: HealthCheckId;
  readonly reason: string;
}

export function runHealthCheck(
  layout: HealthLayout,
  requested: readonly HealthCheckId[] = ALL_CHECKS,
): HealthReport {
  const production = loadSources(layout.scriptsRoot, [".ts"], layout.repoRoot).filter(isModule);
  const modules = buildModules(production);
  const consumer =
    layout.consumerRoot === undefined
      ? []
      : loadSources(join(layout.consumerRoot, "src"), [".ts", ".tsx"], layout.consumerRoot);
  const tests =
    layout.testsRoot === undefined
      ? []
      : loadSources(layout.testsRoot, [".ts"], layout.repoRoot).filter(isModule);

  const results: HealthCheckResult[] = [];
  const skipped: Skip[] = [];
  const wants = (check: HealthCheckId): boolean => requested.includes(check);
  const ownTree = resolve(layout.scriptsRoot) === selfScriptsRoot();

  if (wants("unused-code")) {
    if (layout.testsRoot === undefined) {
      skipped.push({
        check: "unused-code",
        reason:
          "no tests directory in this checkout; without it a test-only export cannot be told from an export nobody imports, and the check would report the wrong reason",
      });
    } else {
      const reach = checkUnusedCode({
        production: modules,
        entryPoints: entryPoints(layout.scriptsRoot),
        tests: buildModules(tests),
      });
      results.push({
        ...reach,
        findings: [...reach.findings, ...production.flatMap(scanUnreadParameters)],
        limitations: [
          ...reach.limitations,
          "Parameters are read from `function` declarations only; a parameter of an arrow function or a class method is not inspected.",
        ],
      });
    }
  }
  if (wants("dead-code")) results.push(checkDeadCode(production, modules));
  if (wants("unenforced-declarations")) {
    results.push(
      checkDeclarations({
        production: modules,
        skillRoot: layout.skillRoot,
        registryApplies: ownTree,
      }),
    );
  }
  if (wants("intent-drift")) {
    if (layout.documents.length === 0) {
      skipped.push({
        check: "intent-drift",
        reason: `no requirement documents found under ${PLANNING_DIRECTORY}; there is nothing to map the code against`,
      });
    } else {
      results.push(
        checkIntentDrift({
          documents: layout.documents,
          production: [...production, ...consumer],
          tests,
          registryApplies: ownTree,
          paths: [
            ...listFiles(layout.repoRoot, [".ts", ".tsx", ".md"]),
            ...(layout.consumerRoot === undefined
              ? []
              : listFiles(layout.consumerRoot, [".ts", ".tsx", ".md"])),
          ],
        }),
      );
    }
  }
  if (wants("literal-fallbacks")) {
    const fallbacks = checkLiteralFallbacks(production);
    results.push({
      ...fallbacks,
      limitations: [
        ...fallbacks.limitations,
        ...(layout.consumerRoot === undefined
          ? []
          : ["The consumer repository was not swept for fallbacks; only the harness source was."]),
      ],
    });
  }
  if (wants("vendor-identifiers")) {
    const vendor = checkVendorIdentifiers([
      { label: "producer", root: layout.scriptsRoot, exempt: PRODUCT_GRAMMAR_MODULES },
      ...(layout.consumerRoot === undefined
        ? []
        : [{ label: "consumer", root: join(layout.consumerRoot, "src") }]),
    ]);
    results.push({
      ...vendor,
      limitations:
        layout.consumerRoot === undefined
          ? [
              ...vendor.limitations,
              "The consumer repository was NOT scanned. B19.4 covers both repos, and this run covered one.",
            ]
          : vendor.limitations,
    });
  }
  if (wants("vendor-prose")) {
    results.push(checkUnqualifiedDispatch([{ label: "skill", root: layout.skillRoot }]));
  }

  const { checks, stale } = applyAllowances(results);
  const withStale = checks.map((result) =>
    result.check === "unused-code"
      ? {
          ...result,
          findings: ownTree ? [...result.findings, ...stale] : result.findings,
          limitations: ownTree
            ? result.limitations
            : [
                ...result.limitations,
                "The allowance list belongs to the harness's own tree; scanning another tree cannot tell whether an entry has gone stale.",
              ],
        }
      : result,
  );
  const all = withStale.flatMap((result) => result.findings);
  const failures = all.filter(
    (entry) => entry.severity === "failure" && entry.acknowledged === undefined,
  );
  return {
    healthy: failures.length === 0,
    checks: withStale,
    failure_count: failures.length,
    advisory_count: all.filter((entry) => entry.severity === "advisory").length,
    acknowledged_count: all.filter((entry) => entry.acknowledged !== undefined).length,
    skipped,
  };
}
