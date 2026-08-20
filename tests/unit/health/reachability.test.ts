import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildModules } from "../../../orchestrating-long-tasks/scripts/src/health/modules.ts";
import { checkUnusedCode } from "../../../orchestrating-long-tasks/scripts/src/health/reachability.ts";
import type { HealthFinding } from "../../../orchestrating-long-tasks/scripts/src/health/types.ts";
import { cleanupTempRoots, loadTree } from "./fixture.ts";

afterAll(cleanupTempRoots);

const PRODUCTION = {
  "entry.ts": [
    'import { called } from "./called.ts";',
    'import { forwarded } from "./barrel.ts";',
    "export function main(): number {",
    "  return called() + forwarded();",
    "}",
  ].join("\n"),
  "called.ts": "export function called(): number {\n  return 1;\n}",
  "barrel.ts": [
    'export * from "./forwarding.ts";',
    'export * from "./test-only.ts";',
    'export * from "./types.ts";',
    'export * from "./silent.ts";',
  ].join("\n"),
  "forwarding.ts": "export function forwarded(): number {\n  return 2;\n}",
  "test-only.ts": [
    "export function neverCalled(): number {",
    "  return helper();",
    "}",
    "export function helper(): number {",
    "  return 3;",
    "}",
  ].join("\n"),
  "orphan.ts": "export function orphaned(): number {\n  return 4;\n}",
  "types.ts": "export interface NeverImported {\n  id: string;\n}",
  "silent.ts": "export function unreferenced(): number {\n  return 5;\n}",
};

function run(): readonly HealthFinding[] {
  const tree = loadTree("reach", PRODUCTION);
  const tests = loadTree("reach-tests", {
    "test-only.test.ts": `import { neverCalled } from "${join(tree.root, "test-only.ts")}";\nneverCalled();`,
  });
  return checkUnusedCode({
    production: tree.modules,
    entryPoints: [join(tree.root, "entry.ts")],
    tests: buildModules(tests.files),
  }).findings;
}

describe("unused code is reported by what reaches it, not by what mentions it", () => {
  const findings = run();
  const keys = findings.map((entry) => entry.key);
  const severityOf = (key: string): string | undefined =>
    findings.find((entry) => entry.key === key)?.severity;

  test("a module no entry point reaches is a failure", () => {
    expect(keys).toContain("module-unreachable:orphan.ts");
    expect(severityOf("module-unreachable:orphan.ts")).toBe("failure");
  });

  test("a module only tests import is reported even though a barrel re-exports it", () => {
    expect(keys).toContain("module-test-only:test-only.ts");
    expect(severityOf("module-test-only:test-only.ts")).toBe("failure");
  });

  test("an export only tests import is a failure, and names the tests that import it", () => {
    const entry = findings.find((item) => item.key === "unused-export:test-only.ts#neverCalled");
    expect(entry?.severity).toBe("failure");
    expect(entry?.detail).toContain("imported only by tests");
    expect(entry?.detail).toContain("no production code calls it");
  });

  test("an export its own module still calls is an advisory, not a failure", () => {
    const entry = findings.find((item) => item.key === "unused-export:test-only.ts#helper");
    expect(entry?.severity).toBe("advisory");
    expect(entry?.detail).toContain("referenced only inside its own module");
  });

  test("an exported type nobody imports is an advisory: it carries no behaviour", () => {
    expect(severityOf("unused-export:types.ts#NeverImported")).toBe("advisory");
  });

  test("an export with no importer and no local reference is a failure", () => {
    const entry = findings.find((item) => item.key === "unused-export:silent.ts#unreferenced");
    expect(entry?.detail).toContain("no importer anywhere");
  });

  test("a symbol the entry point actually calls is not reported at all", () => {
    expect(keys).not.toContain("unused-export:called.ts#called");
    expect(keys).not.toContain("unused-export:forwarding.ts#forwarded");
    expect(keys).not.toContain("module-unreachable:forwarding.ts");
  });

  test("the check states what it cannot see", () => {
    const result = checkUnusedCode({
      production: buildModules([]),
      entryPoints: [],
      tests: buildModules([]),
    });
    expect(result.limitations.length).toBeGreaterThan(0);
    expect(result.findings).toEqual([]);
  });
});

describe("a namespace import hides which member was used, and the check says so", () => {
  test("every export of a namespace-imported module is left alone", () => {
    const tree = loadTree("namespace", {
      "entry.ts": 'import * as wide from "./wide.ts";\nexport const total = wide.a;',
      "wide.ts": "export const a = 1;\nexport const b = 2;",
    });
    const findings = checkUnusedCode({
      production: tree.modules,
      entryPoints: [join(tree.root, "entry.ts")],
      tests: buildModules([]),
    }).findings;
    expect(findings.map((entry) => entry.key)).not.toContain("unused-export:wide.ts#b");
  });
});
