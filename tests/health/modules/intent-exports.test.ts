import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { checkIntentDrift } from "../../../olt/scripts/src/health/intent.ts";
import { cleanupTempRoots, sourceOf, tempRoot, writeTree } from "../fixture.ts";

afterAll(cleanupTempRoots);

describe("Health Modules - Intent Drift & Test Path Verification", () => {
  describe("health/allowlist.ts quoting a path token is not evidence the repo uses it", () => {
    const result = (production: Parameters<typeof checkIntentDrift>[0]["production"]) => {
      const root = writeTree(tempRoot("allowlist-self-reference"), {
        "SPEC.md": ["## 1. R1 - a produced artifact", "", "- Produces `.tmp/scratch/build.ts`."].join(
          "\n",
        ),
      });
      return checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production,
        tests: [],
        paths: [],
        registryApplies: true,
      });
    };

    test("the token appearing only inside health/allowlist.ts still reads as missing", () => {
      const report = result([
        sourceOf("health/allowlist.ts", 'key: "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",'),
      ]);
      expect(report.findings.map((entry) => entry.key)).toContain(
        "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",
      );
    });

    test("the same token in any other production file still counts as written", () => {
      const report = result([sourceOf("core/paths.ts", 'const p = ".tmp/scratch/build.ts";')]);
      expect(report.findings.map((entry) => entry.key)).not.toContain(
        "intent-missing:SPEC.md:R1:.tmp/scratch/build.ts",
      );
    });
  });

  describe("a token naming a test file's own path is proven by existing, not by being quoted elsewhere", () => {
    test("a `.test.ts` token in the repo's own tests is not reported as untested", () => {
      const root = writeTree(tempRoot("self-proving-own-tests"), {
        "SPEC.md": [
          "## 1. R1 - completeness",
          "",
          "- Proven by `tests/health/modules/completeness.test.ts`.",
        ].join("\n"),
      });
      const testPath = join(root, "tests/health/modules/completeness.test.ts");
      const report = checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production: [],
        tests: [sourceOf("tests/health/modules/completeness.test.ts", "test('covers it', () => {});")],
        paths: [testPath],
        registryApplies: true,
      });
      expect(report.findings.map((entry) => entry.key)).not.toContain("intent-untested:SPEC.md:R1");
      expect(report.limitations.join(" ")).toContain("1 token(s) name a `.test.ts`/`.spec.ts` file");
    });

    test("a `.test.ts` token that lives only in a consumer repo is still proven", () => {
      const root = writeTree(tempRoot("self-proving-consumer"), {
        "SPEC.md": [
          "## 1. R1 - renderer tolerance",
          "",
          "- Proven by `consumer/src/schema.test.ts`.",
        ].join("\n"),
      });
      const testPath = join(root, "consumer/src/schema.test.ts");
      const report = checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production: [sourceOf("consumer/src/schema.test.ts", "test('ignores junk', () => {});")],
        tests: [],
        paths: [testPath],
        registryApplies: true,
      });
      expect(report.findings.map((entry) => entry.key)).not.toContain("intent-untested:SPEC.md:R1");
    });

    test("a non-test file token still requires a test to mention it", () => {
      const root = writeTree(tempRoot("still-checked"), {
        "SPEC.md": ["## 1. R1 - the ledger", "", "- Implemented in `src/ledger.ts`."].join("\n"),
      });
      const report = checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production: [sourceOf("src/ledger.ts", "export const x = 1;")],
        tests: [],
        paths: [join(root, "src/ledger.ts")],
        registryApplies: true,
      });
      expect(report.findings.map((entry) => entry.key)).toContain("intent-untested:SPEC.md:R1");
    });

    test("a .test.ts token that only appears as text in an unrelated file is not self-proven", () => {
      const root = writeTree(tempRoot("phantom-test-mention"), {
        "SPEC.md": [
          "## 1. R1 - a requirement citing a test file that does not exist",
          "",
          "- Proven by `tests/health/modules/phantom.test.ts`.",
        ].join("\n"),
      });
      const report = checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production: [sourceOf("some/generator.ts", "// see tests/health/modules/phantom.test.ts for context")],
        tests: [],
        paths: [join(root, "SPEC.md")],
        registryApplies: true,
      });
      expect(report.findings.map((entry) => entry.key)).toContain("intent-untested:SPEC.md:R1");
    });
  });

  describe("a command token is not judged against a registry that does not describe the tree", () => {
    const result = (): ReturnType<typeof checkIntentDrift> => {
      const root = writeTree(tempRoot("foreign-intent"), {
        "SPEC.md": ["## 1. R1 - recovery", "", "- Provides `run:invent`."].join("\n"),
      });
      return checkIntentDrift({
        documents: [{ relative: "SPEC.md", absolute: join(root, "SPEC.md"), headingLevel: 2 }],
        production: [sourceOf("recover.ts", "export function recover(): number {\n  return 1;\n}")],
        tests: [],
        paths: [],
        registryApplies: false,
      });
    };

    test("the command is counted as unclassifiable rather than declared missing", () => {
      const report = result();
      expect(report.findings.map((entry) => entry.key)).toEqual([]);
      expect(report.limitations.join(" ")).toContain("counted as unclassifiable");
    });
  });
});
