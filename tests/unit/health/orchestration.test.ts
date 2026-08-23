import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runHealthCheck, type HealthLayout } from "../../../olt/scripts/src/health/index.ts";
import { scratchRoot } from "../../support/scratch-root.ts";

/**
 * A tiny synthetic tree, distinct from the real skill tree runHealthCheck normally scans (see
 * structural.test.ts for that). This file exists to exercise runHealthCheck's OWN orchestration —
 * which checks run, which skip and why, how consumerRoot/testsRoot/ownTree presence changes the
 * limitations text — not the individual checkers, which already have their own dedicated 100%
 * suites. Since `scriptsRoot` here can never equal the real self-scripts-root, `ownTree` is always
 * false, which keeps `unenforced-declarations` cheap (it never touches the real roles/checklists).
 */
function syntheticLayout(label: string, overrides: Partial<HealthLayout> = {}): HealthLayout {
  const root = scratchRoot(import.meta.path, label);
  const skillRoot = join(root, "skill");
  const scriptsRoot = join(skillRoot, "scripts");
  mkdirSync(scriptsRoot, { recursive: true });
  writeFileSync(join(scriptsRoot, "index.ts"), "export function main(): void {}\n");

  return {
    repoRoot: root,
    skillRoot,
    scriptsRoot,
    documents: [],
    ...overrides,
  };
}

function withTestsRoot(root: string): string {
  const testsRoot = join(root, "tests");
  mkdirSync(testsRoot, { recursive: true });
  writeFileSync(join(testsRoot, "index.test.ts"), "export {};\n");
  return testsRoot;
}

function withDocument(root: string): HealthLayout["documents"] {
  const docsDir = join(root, "docs");
  mkdirSync(docsDir, { recursive: true });
  const absolute = join(docsDir, "SPEC.md");
  writeFileSync(absolute, "# Spec\n\nNothing checkable in here.\n");
  return [{ relative: "docs/SPEC.md", absolute, headingLevel: 2 }];
}

describe("runHealthCheck — orchestration branches", () => {
  test("skips unused-code with a named reason when there is no tests directory", () => {
    const layout = syntheticLayout("no-tests-root");
    const report = runHealthCheck(layout, ["unused-code"]);
    expect(report.skipped).toEqual([
      {
        check: "unused-code",
        reason:
          "no tests directory in this checkout; without it a test-only export cannot be told from an export nobody imports, and the check would report the wrong reason",
      },
    ]);
    expect(report.checks).toEqual([]);
  });

  test("runs unused-code (and merges the parameter-scan limitation) once a tests directory exists", () => {
    const layout = syntheticLayout("with-tests-root");
    const testsRoot = withTestsRoot(layout.repoRoot);
    const report = runHealthCheck({ ...layout, testsRoot }, ["unused-code"]);
    expect(report.skipped).toEqual([]);
    const check = report.checks.find((c) => c.check === "unused-code");
    expect(check).toBeDefined();
    expect(check?.limitations.some((line) => line.includes("Parameters are read from"))).toBeTrue();
  });

  test("runs unenforced-declarations", () => {
    const layout = syntheticLayout("unenforced-declarations");
    const report = runHealthCheck(layout, ["unenforced-declarations"]);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.check).toBe("unenforced-declarations");
  });

  test("skips intent-drift with a named reason when there are no requirement documents", () => {
    const layout = syntheticLayout("no-documents");
    const report = runHealthCheck(layout, ["intent-drift"]);
    expect(report.skipped).toEqual([
      {
        check: "intent-drift",
        reason:
          "no requirement documents found under docs/planning/orchestration-overhaul; there is nothing to map the code against",
      },
    ]);
  });

  test("runs intent-drift, folding a consumer's sources into the production set, once documents exist", () => {
    const layout = syntheticLayout("with-documents");
    const documents = withDocument(layout.repoRoot);
    const report = runHealthCheck({ ...layout, documents }, ["intent-drift"]);
    expect(report.skipped).toEqual([]);
    expect(report.checks[0]?.check).toBe("intent-drift");
  });

  test("vendor-identifiers notes the consumer repo was NOT scanned when none is given", () => {
    const layout = syntheticLayout("vendor-no-consumer");
    const report = runHealthCheck(layout, ["vendor-identifiers"]);
    const limitations = report.checks[0]?.limitations ?? [];
    expect(limitations.some((line) => line.includes("was NOT scanned"))).toBeTrue();
  });

  test("vendor-identifiers omits that caveat once a consumer repo is actually scanned", () => {
    const layout = syntheticLayout("vendor-with-consumer");
    const consumerRoot = join(layout.repoRoot, "consumer");
    mkdirSync(join(consumerRoot, "src"), { recursive: true });
    writeFileSync(join(consumerRoot, "src", "app.ts"), "export const ok = true;\n");
    const report = runHealthCheck({ ...layout, consumerRoot }, ["vendor-identifiers"]);
    const limitations = report.checks[0]?.limitations ?? [];
    expect(limitations.some((line) => line.includes("was NOT scanned"))).toBeFalse();
  });

  test("runs vendor-prose", () => {
    const layout = syntheticLayout("vendor-prose");
    const report = runHealthCheck(layout, ["vendor-prose"]);
    expect(report.checks).toHaveLength(1);
    expect(report.checks[0]?.check).toBe("vendor-prose");
  });

  test("literal-fallbacks notes the consumer repo was not swept only when a consumer root is given", () => {
    const withoutConsumer = syntheticLayout("fallbacks-no-consumer");
    const withoutReport = runHealthCheck(withoutConsumer, ["literal-fallbacks"]);
    expect(
      withoutReport.checks[0]?.limitations.some((line) => line.includes("was not swept")),
    ).toBeFalse();

    const layout = syntheticLayout("fallbacks-with-consumer");
    const consumerRoot = join(layout.repoRoot, "consumer");
    mkdirSync(join(consumerRoot, "src"), { recursive: true });
    const withReport = runHealthCheck({ ...layout, consumerRoot }, ["literal-fallbacks"]);
    expect(
      withReport.checks[0]?.limitations.some((line) => line.includes("was not swept")),
    ).toBeTrue();
  });

  test("outside its own tree, unused-code's stale-allowance findings are withheld and callers are told why", () => {
    // ownTree is always false here since scriptsRoot is a synthetic scratch directory, never the
    // real self-scripts-root — this is the withStale/unused-code branch's "not my tree" path.
    const layout = syntheticLayout("not-own-tree");
    const testsRoot = withTestsRoot(layout.repoRoot);
    const report = runHealthCheck({ ...layout, testsRoot }, ["unused-code"]);
    const check = report.checks.find((c) => c.check === "unused-code")!;
    expect(
      check.limitations.some((line) => line.includes("allowance list belongs to the harness")),
    ).toBeTrue();
  });
});
