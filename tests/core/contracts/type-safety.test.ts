import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import {
  assertZeroAny,
  collectTsFiles,
  isTypeSafetyScanResult,
  isTypeSafetyViolation,
  scanDirectoryForAny,
  scanFileForAny,
  scanSourceCodeForAny,
} from "../../../olt/scripts/src/core/type-safety/index.ts";

function createTempDir(prefix: string): string {
  return realpathSync(mkdtempSync(join(tmpdir(), prefix)));
}

describe("assertZeroAny and type-safety scanner", () => {
  describe("inline source code scanning", () => {
    it("passes for strictly typed code without any", () => {
      const code = `
        export interface User {
          readonly id: string;
          readonly age: number;
        }
        export function getUser(id: string): User {
          return { id, age: 30 };
        }
      `;
      expect(() => assertZeroAny(code)).not.toThrow();
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.totalViolations).toBe(0);
      expect(result.violations.length).toBe(0);
    });

    it("detects explicit any type annotations", () => {
      const code = "const value: any = 123;";
      let caught: unknown;
      try {
        assertZeroAny(code);
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(HarnessError);
      const error = caught as HarnessError;
      expect(error.code).toBe("INTEGRITY");
      expect(error.message).toContain("Zero TypeScript 'any' compliance check failed");

      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(1);
      expect(result.violations[0]?.rule).toBe("any_type");
    });

    it("detects as any type casts and <any> casts", () => {
      const code = `
        const x = (data as any).field;
        const y = (<any>data).field;
      `;
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(2);
      expect(result.violations.every((v) => v.rule === "any_type")).toBe(true);
    });

    it("detects generic arguments with any", () => {
      const code = `
        const list: Array<any> = [];
        const record: Record<string, any> = {};
      `;
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(2);
    });

    it("detects compiler suppression comments", () => {
      const sup1 = ["/", "/", " ", "@", "ts-ignore"].join("");
      const sup2 = ["/", "*", " ", "@", "ts-expect-error", " ", "*", "/"].join("");
      const code = [sup1, "const x = 10;", sup2, "const y = 20;"].join("\n");
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(2);
      expect(result.violations.every((v) => v.rule === "compiler_suppression")).toBe(true);
    });

    it("allows ignoring compiler suppressions when option is disabled", () => {
      const sup = ["/", "/", " ", "@", "ts-ignore"].join("");
      const code = [sup, "const x: number = 10;"].join("\n");
      const result = scanSourceCodeForAny(code, "test.ts", {
        checkCompilerSuppressions: false,
      });
      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
    });
  });

  describe("file and directory scanning", () => {
    it("scans files and throws on violations", () => {
      const tempDir = createTempDir("type-safety-file-");
      try {
        const cleanFile = join(tempDir, "clean.ts");
        const dirtyFile = join(tempDir, "dirty.ts");
        writeFileSync(cleanFile, "export const PI: number = 3.14;");
        writeFileSync(dirtyFile, "export const bad: any = true;");

        expect(() => assertZeroAny(cleanFile)).not.toThrow();

        let caught: unknown;
        try {
          assertZeroAny(dirtyFile);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(HarnessError);
        const error = caught as HarnessError;
        expect(error.code).toBe("INTEGRITY");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("scans entire directories and enforces zero any", () => {
      const tempDir = createTempDir("type-safety-dir-");
      try {
        const subDir = join(tempDir, "nested");
        mkdirSync(subDir, { recursive: true });
        writeFileSync(join(tempDir, "a.ts"), "export const a: string = 'ok';");
        writeFileSync(join(subDir, "b.tsx"), "export const b = 42;");

        expect(() => assertZeroAny(tempDir)).not.toThrow();

        writeFileSync(join(subDir, "c.ts"), "export function fail(x: any): void {}");

        let caught: unknown;
        try {
          assertZeroAny(tempDir);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(HarnessError);
        const error = caught as HarnessError;
        expect(error.code).toBe("INTEGRITY");
        expect(error.message).toContain("Zero TypeScript 'any' compliance check failed");
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it("throws PATH_SAFETY error for non-existent file or directory in scan helpers", () => {
      const bogusPath = "/non/existent/path/file.ts";
      let caughtFile: unknown;
      try {
        scanFileForAny(bogusPath);
      } catch (err) {
        caughtFile = err;
      }
      expect(caughtFile).toBeInstanceOf(HarnessError);
      expect((caughtFile as HarnessError).code).toBe("PATH_SAFETY");

      let caughtDir: unknown;
      try {
        scanDirectoryForAny(bogusPath);
      } catch (err) {
        caughtDir = err;
      }
      expect(caughtDir).toBeInstanceOf(HarnessError);
      expect((caughtDir as HarnessError).code).toBe("PATH_SAFETY");
    });
  });

  describe("type guards and file collection", () => {
    it("validates isTypeSafetyViolation and isTypeSafetyScanResult", () => {
      const violation = {
        rule: "any_type" as const,
        message: "Any prohibited",
        file: "foo.ts",
        line: 1,
        column: 1,
        snippet: "any",
      };
      expect(isTypeSafetyViolation(violation)).toBe(true);
      expect(isTypeSafetyViolation(null)).toBe(false);
      expect(isTypeSafetyViolation({ rule: "invalid" })).toBe(false);

      const result = {
        valid: true,
        passed: true,
        filePath: "foo.ts",
        violations: [violation],
        totalViolations: 1,
      };
      expect(isTypeSafetyScanResult(result)).toBe(true);
      expect(isTypeSafetyScanResult({})).toBe(false);
    });

    it("collects typescript files excluding node_modules and dot folders", () => {
      const tempDir = createTempDir("type-safety-collect-");
      try {
        const nodeModules = join(tempDir, "node_modules");
        mkdirSync(nodeModules, { recursive: true });
        writeFileSync(join(nodeModules, "ignored.ts"), "const x: any = 1;");
        writeFileSync(join(tempDir, "valid.ts"), "const x = 1;");
        writeFileSync(join(tempDir, "valid.tsx"), "const x = 1;");
        writeFileSync(join(tempDir, "ignored.txt"), "some text");

        const collected = collectTsFiles(tempDir);
        expect(collected.length).toBe(2);
        expect(collected.some((f) => f.endsWith("valid.ts"))).toBe(true);
        expect(collected.some((f) => f.endsWith("valid.tsx"))).toBe(true);
        expect(collected.some((f) => f.includes("node_modules"))).toBe(false);
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });
});
