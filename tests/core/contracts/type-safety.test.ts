import { afterEach, beforeEach, describe, expect, it } from "bun:test";
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
import {
  createTypeSafetyMockState,
  createTypeSafetyFsSpies,
  type TypeSafetyMockState,
} from "./fixtures.ts";

describe("assertZeroAny and type-safety scanner", () => {
  let state: TypeSafetyMockState;
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    state = createTypeSafetyMockState();
    spies.push(...createTypeSafetyFsSpies(state));
  });

  afterEach(() => {
    while (spies.length > 0) spies.pop()?.mockRestore();
  });

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
      const code = "const a = (1 as any);\nconst b = (<any>2);";
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(2);
    });

    it("detects any in function parameters and return types", () => {
      const code = "function doSomething(param: any): any { return param; }";
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(2);
    });

    it("detects any in type aliases, interfaces, and generics", () => {
      const code =
        "type AnyMap = Record<string, any>;\ninterface Container { item: any; items: Array<any>; }";
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(3);
    });

    it("detects any in type assertions and union/intersection members", () => {
      const code =
        "type Mixed = string | any;\ntype Intersection = object & any;\nconst x = ('hello' as any);";
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(false);
      expect(result.totalViolations).toBe(3);
    });

    it("allows standard identifiers that happen to contain the word any", () => {
      const code =
        "const company = 'Acme';\nconst anyway = true;\nfunction listMany(): string[] { return []; }\ninterface AnyCompany { name: string; }";
      expect(() => assertZeroAny(code)).not.toThrow();
      const result = scanSourceCodeForAny(code, "test.ts");
      expect(result.valid).toBe(true);
      expect(result.totalViolations).toBe(0);
    });
  });

  describe("file and directory scanning", () => {
    it("scans files and throws on violations", () => {
      const tempDir = "/virtual-type-safety-file";
      state.mockDirs.add(tempDir);
      const cleanFile = join(tempDir, "clean.ts");
      const dirtyFile = join(tempDir, "dirty.ts");
      state.mockFiles.set(cleanFile, "export const PI: number = 3.14;");
      state.mockFiles.set(dirtyFile, "export const bad: any = true;");

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
    });

    it("scans entire directories and enforces zero any", () => {
      const tempDir = "/virtual-type-safety-dir";
      state.mockDirs.add(tempDir);
      const subDir = join(tempDir, "nested");
      state.mockDirs.add(subDir);
      state.mockFiles.set(join(tempDir, "a.ts"), "export const a: string = 'ok';");
      state.mockFiles.set(join(subDir, "b.tsx"), "export const b = 42;");

      expect(() => assertZeroAny(tempDir)).not.toThrow();

      state.mockFiles.set(join(subDir, "c.ts"), "export function fail(x: any): void {}");

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
      const tempDir = "/virtual-type-safety-collect";
      state.mockDirs.add(tempDir);
      const nodeModules = join(tempDir, "node_modules");
      state.mockDirs.add(nodeModules);
      state.mockFiles.set(join(nodeModules, "ignored.ts"), "const x: any = 1;");
      state.mockFiles.set(join(tempDir, "valid.ts"), "const x = 1;");
      state.mockFiles.set(join(tempDir, "valid.tsx"), "const x = 1;");
      state.mockFiles.set(join(tempDir, "ignored.txt"), "some text");

      const collected = collectTsFiles(tempDir);
      expect(collected.length).toBe(2);
      expect(collected.some((f) => f.endsWith("valid.ts"))).toBe(true);
      expect(collected.some((f) => f.endsWith("valid.tsx"))).toBe(true);
      expect(collected.some((f) => f.includes("node_modules"))).toBe(false);
    });
  });
});
