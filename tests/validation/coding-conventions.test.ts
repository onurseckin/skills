import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  validateCapsuleDiskHygiene,
  validateDensityBudgets,
  validateFacadeExports,
  validateNoBackwardsCompatibilityShims,
  validateRepositoryCodingConventions,
  validateZeroCommentsInCode,
} from "../../olt/scripts/src/validation/coding-conventions.ts";

describe("Coding Conventions Validation", () => {
  describe("validateZeroCommentsInCode", () => {
    it("detects single-line, multi-line, and docblock comments", () => {
      const singleLine = "const a = 1;\n// single line comment\nconst b = 2;";
      const res1 = validateZeroCommentsInCode(singleLine, "src/a.ts");
      expect(res1.valid).toBe(false);
      expect(res1.violations.length).toBe(1);
      expect(res1.violations[0]?.type).toBe("single-line");
      expect(res1.violations[0]?.line).toBe(2);

      const multiLine = "const a = 1;\n/* block comment */\nconst b = 2;";
      const res2 = validateZeroCommentsInCode(multiLine, "src/b.ts");
      expect(res2.valid).toBe(false);
      expect(res2.violations.length).toBe(1);
      expect(res2.violations[0]?.type).toBe("multi-line");

      const docBlock = "/**\n * Doc comment\n */\nfunction foo(): void {}";
      const res3 = validateZeroCommentsInCode(docBlock, "src/c.ts");
      expect(res3.valid).toBe(false);
      expect(res3.violations.length).toBe(1);
      expect(res3.violations[0]?.type).toBe("docblock");
    });

    it("does not flag comments inside strings, template literals, or regexes", () => {
      const urlCode = 'const url = "https://example.com/api/v1";';
      expect(validateZeroCommentsInCode(urlCode).valid).toBe(true);

      const strCode = "const s = '// this is just a string'; const s2 = '/* neither */';";
      expect(validateZeroCommentsInCode(strCode).valid).toBe(true);

      const tplCode = "const t = `prefix https://test.org /* not a comment */ ${1 + 2}`;";
      expect(validateZeroCommentsInCode(tplCode).valid).toBe(true);

      const regexCode = "const re = /https:\\/\\/[a-z]+/; const div = 10 / 2 / 1;";
      expect(validateZeroCommentsInCode(regexCode).valid).toBe(true);
    });

    it("exempts non-code files like markdown and yaml", () => {
      const mdCode = "# Title\n// not code\n/* markdown */";
      const resMd = validateZeroCommentsInCode(mdCode, "docs/README.md");
      expect(resMd.valid).toBe(true);
      expect(resMd.violations.length).toBe(0);

      const yamlCode = "key: value\n# comment\n// note";
      const resYaml = validateZeroCommentsInCode(yamlCode, "config/app.yaml");
      expect(resYaml.valid).toBe(true);
    });
  });

  describe("validateDensityBudgets", () => {
    it("validates line count budgets per file", () => {
      const shortContent = Array.from({ length: 50 }, (_, i) => `const x${i} = ${i};`).join("\n");
      const longContent = Array.from({ length: 350 }, (_, i) => `const y${i} = ${i};`).join("\n");

      const resValid = validateDensityBudgets({
        files: [{ path: "src/short.ts", content: shortContent }],
      });
      expect(resValid.valid).toBe(true);
      expect(resValid.fileViolations.length).toBe(0);

      const resInvalid = validateDensityBudgets({
        files: [{ path: "src/long.ts", content: longContent }],
      });
      expect(resInvalid.valid).toBe(false);
      expect(resInvalid.fileViolations.length).toBe(1);
      expect(resInvalid.fileViolations[0]?.lineCount).toBe(350);
      expect(resInvalid.fileViolations[0]?.limit).toBe(300);
    });

    it("validates directory file count limits", () => {
      const resValidDir = validateDensityBudgets({
        directories: [{ path: "src/modular", fileCount: 8 }],
      });
      expect(resValidDir.valid).toBe(true);

      const resInvalidDir = validateDensityBudgets({
        directories: [{ path: "src/crowded", fileCount: 15 }],
      });
      expect(resInvalidDir.valid).toBe(false);
      expect(resInvalidDir.directoryViolations.length).toBe(1);
      expect(resInvalidDir.directoryViolations[0]?.fileCount).toBe(15);
      expect(resInvalidDir.directoryViolations[0]?.limit).toBe(10);
    });

    it("respects custom density limits", () => {
      const content = Array.from({ length: 40 }, (_, i) => `const z${i} = ${i};`).join("\n");
      const res = validateDensityBudgets({
        files: [{ path: "src/custom.ts", content }],
        directories: [{ path: "src/custom-dir", fileCount: 6 }],
        maxLinesPerFile: 30,
        maxFilesPerDirectory: 5,
      });
      expect(res.valid).toBe(false);
      expect(res.fileViolations.length).toBe(1);
      expect(res.directoryViolations.length).toBe(1);
    });
  });

  describe("validateFacadeExports", () => {
    it("flags wildcard exports as violations", () => {
      const wildcardCode = 'export * from "./sub-module.ts";';
      const res = validateFacadeExports(wildcardCode, "src/index.ts");
      expect(res.valid).toBe(false);
      expect(res.hasWildcardExport).toBe(true);
      expect(res.violations.length).toBe(1);
    });

    it("flags default exports in facades", () => {
      const defaultCode = "export default function main() {}";
      const res = validateFacadeExports(defaultCode, "src/index.ts");
      expect(res.valid).toBe(false);
      expect(res.violations.length).toBe(1);
    });

    it("accepts explicit named exports and extracts identifiers", () => {
      const validCode =
        'export { alpha, beta as renamedBeta, type Gamma } from "./sub.ts";\nexport const DELTA = 100;\nexport function executeRun(): void {}';
      const res = validateFacadeExports(validCode, "src/index.ts");
      expect(res.valid).toBe(true);
      expect(res.hasWildcardExport).toBe(false);
      expect(res.namedExports).toContain("alpha");
      expect(res.namedExports).toContain("renamedBeta");
      expect(res.namedExports).toContain("Gamma");
      expect(res.namedExports).toContain("DELTA");
      expect(res.namedExports).toContain("executeRun");
    });

    it("verifies key subsystem facades have zero wildcard exports", () => {
      const facades = [
        "olt/scripts/src/mind/preplanning/index.ts",
        "olt/scripts/src/graph/index.ts",
        "olt/scripts/src/telemetry/index.ts",
        "olt/scripts/src/telemetry/collectors/index.ts",
      ];
      for (const relPath of facades) {
        const fullPath = join(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");
        const res = validateFacadeExports(content, relPath);
        expect(res.valid).toBe(true);
        expect(res.hasWildcardExport).toBe(false);
        expect(res.violations.length).toBe(0);
      }
    });
  });

  describe("validateNoBackwardsCompatibilityShims", () => {
    it("detects deprecation annotations and shim identifiers", () => {
      const tagSource = "@" + "deprecated\nexport function oldMethod(): void {}";
      const res1 = validateNoBackwardsCompatibilityShims(tagSource);
      expect(res1.valid).toBe(false);
      expect(res1.violations.length).toBe(1);

      const namedSource = "export const " + "legacyConfig = { enabled: true };";
      const res2 = validateNoBackwardsCompatibilityShims(namedSource);
      expect(res2.valid).toBe(false);
      expect(res2.violations.length).toBe(1);
      expect(res2.violations[0]?.identifier).toBe("legacyConfig");

      const aliasSource = "export { newHandler as " + 'legacyHandler } from "./handler.ts";';
      const res3 = validateNoBackwardsCompatibilityShims(aliasSource);
      expect(res3.valid).toBe(false);
      expect(res3.violations.length).toBe(1);
    });

    it("passes cleanly on modern code with zero shims", () => {
      const cleanCode =
        "export function processData(input: string): string {\n  return input.trim();\n}";
      const res = validateNoBackwardsCompatibilityShims(cleanCode);
      expect(res.valid).toBe(true);
      expect(res.violations.length).toBe(0);
    });
  });

  describe("validateCapsuleDiskHygiene", () => {
    it("passes for clean capsule paths", () => {
      const cleanPaths = [
        ".olt/capsules/cap-1/manifest.json",
        ".olt/capsules/cap-1/index.ts",
        ".olt/capsules/cap-1/state.json",
      ];
      const res = validateCapsuleDiskHygiene(cleanPaths);
      expect(res.valid).toBe(true);
      expect(res.violations.length).toBe(0);
    });

    it("detects scratch and temporary files in capsules", () => {
      const dirtyPaths = [
        ".olt/capsules/cap-1/manifest.json",
        ".olt/capsules/cap-1/scratch.tmp",
        ".olt/capsules/cap-1/temp-dump.log",
        ".olt/capsules/cap-1/.DS_Store",
        ".olt/capsules/cap-1/backup.bak",
      ];
      const res = validateCapsuleDiskHygiene(dirtyPaths);
      expect(res.valid).toBe(false);
      expect(res.violations.length).toBe(4);
    });
  });

  describe("validateRepositoryCodingConventions", () => {
    it("validates compliant repository state with all passing sub-checks", () => {
      const result = validateRepositoryCodingConventions({
        targetFiles: [
          {
            path: "src/core/runner.ts",
            content: "export function run(): boolean {\n  return true;\n}",
          },
          {
            path: "src/core/index.ts",
            content: 'export { run } from "./runner.ts";',
          },
        ],
        directories: [{ path: "src/core", fileCount: 2 }],
        capsulesDir: [".olt/capsules/task-1/manifest.json"],
      });
      expect(result.valid).toBe(true);
      expect(result.allViolations.length).toBe(0);
    });

    it("aggregates violations from multiple convention failures", () => {
      const result = validateRepositoryCodingConventions({
        targetFiles: [
          {
            path: "src/bad/index.ts",
            content:
              '// comment here\nexport * from "./sub.ts";\nexport const ' + "legacyHelper = 1;",
          },
        ],
        directories: [{ path: "src/bad", fileCount: 15 }],
        capsulesDir: [".olt/capsules/task-2/scratch.tmp"],
      });
      expect(result.valid).toBe(false);
      expect(result.allViolations.length).toBeGreaterThanOrEqual(4);
      expect(result.commentsResult.valid).toBe(false);
      expect(result.densityResult.valid).toBe(false);
      expect(result.facadeResults[0]?.valid).toBe(false);
      expect(result.shimResults[0]?.valid).toBe(false);
      expect(result.capsuleHygieneResult.valid).toBe(false);
    });
  });

  describe("Mind Purge & Deduplication Invariants", () => {
    it("verifies zero backwards compatibility shims in consolidated packages", () => {
      const keyFiles = [
        "olt/scripts/src/health/hygiene/index.ts",
        "olt/scripts/src/health/hygiene/scanner.ts",
        "olt/scripts/src/health/hygiene/quarantine.ts",
        "olt/scripts/src/core/scheduling/index.ts",
        "olt/scripts/src/core/scheduling/backoff.ts",
        "olt/scripts/src/core/scheduling/duration.ts",
        "olt/scripts/src/logging/defects/index.ts",
        "olt/scripts/src/engine/store/recovery/defect-store.ts",
      ];
      for (const relPath of keyFiles) {
        const fullPath = join(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");
        const res = validateNoBackwardsCompatibilityShims(content, relPath);
        expect(res.valid).toBe(true);
        expect(res.violations).toHaveLength(0);
      }
    });

    it("verifies zero code comments across consolidated package files", () => {
      const files = [
        "olt/scripts/src/health/hygiene/scanner.ts",
        "olt/scripts/src/core/scheduling/backoff.ts",
        "olt/scripts/src/core/scheduling/duration.ts",
        "olt/scripts/src/engine/store/recovery/defect-store.ts",
        "olt/scripts/src/reporting/doctor/hygiene-engine.ts",
      ];
      for (const relPath of files) {
        const fullPath = join(process.cwd(), relPath);
        const content = readFileSync(fullPath, "utf8");
        const res = validateZeroCommentsInCode(content, relPath);
        expect(res.valid).toBe(true);
        expect(res.violations).toHaveLength(0);
      }
    });
  });
});
