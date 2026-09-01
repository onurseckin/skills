import { describe, expect, it, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import { dirname, join, basename } from "node:path";
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

describe("assertZeroAny and type-safety scanner", () => {
  const mockFiles = new Map<string, string>();
  const mockDirs = new Set<string>();
  const spies: { mockRestore: () => void }[] = [];

  beforeEach(() => {
    mockFiles.clear();
    mockDirs.clear();
    spies.push(
      spyOn(fs, "existsSync").mockImplementation((p: fs.PathLike) => {
        const s = String(p);
        return mockFiles.has(s) || mockDirs.has(s);
      }),
      spyOn(fs, "realpathSync").mockImplementation(((p: fs.PathLike) =>
        String(p)) as unknown as typeof fs.realpathSync),
      spyOn(fs, "statSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (mockDirs.has(s))
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        throw new Error(`ENOENT: no such file or directory, stat '${s}'`);
      }) as unknown as typeof fs.statSync),
      spyOn(fs, "lstatSync").mockImplementation(((p: fs.PathLike) => {
        const s = String(p);
        if (mockDirs.has(s))
          return {
            isDirectory: () => true,
            isFile: () => false,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        if (mockFiles.has(s))
          return {
            isDirectory: () => false,
            isFile: () => true,
            isSymbolicLink: () => false,
          } as unknown as fs.Stats;
        throw new Error(`ENOENT: no such file or directory, lstat '${s}'`);
      }) as unknown as typeof fs.lstatSync),
      spyOn(fs, "readFileSync").mockImplementation(((p: fs.PathOrFileDescriptor) => {
        const s = String(p);
        const val = mockFiles.get(s);
        if (val !== undefined) return val;
        throw new Error(`ENOENT: no such file or directory, open '${s}'`);
      }) as unknown as typeof fs.readFileSync),
      spyOn(fs, "mkdirSync").mockImplementation(((p: fs.PathLike) => {
        mockDirs.add(String(p));
        return undefined as unknown as string;
      }) as unknown as typeof fs.mkdirSync),
      spyOn(fs, "writeFileSync").mockImplementation(((
        p: fs.PathOrFileDescriptor,
        data: string | NodeJS.ArrayBufferView,
      ) => {
        const s = String(p);
        mockFiles.set(
          s,
          typeof data === "string" ? data : Buffer.from(data as Uint8Array).toString("utf-8"),
        );
      }) as unknown as typeof fs.writeFileSync),
      spyOn(fs, "readdirSync").mockImplementation(((
        p: fs.PathLike,
        options?: fs.ObjectEncodingOptions & { withFileTypes?: boolean },
      ) => {
        const s = String(p);
        const childNames = new Set<string>();
        const childDirents: {
          name: string;
          isFile: () => boolean;
          isDirectory: () => boolean;
          isSymbolicLink: () => boolean;
        }[] = [];

        for (const dir of mockDirs) {
          if (dirname(dir) === s && dir !== s) {
            const name = basename(dir);
            if (!childNames.has(name)) {
              childNames.add(name);
              childDirents.push({
                name,
                isFile: () => false,
                isDirectory: () => true,
                isSymbolicLink: () => false,
              });
            }
          }
        }
        for (const file of mockFiles.keys()) {
          if (dirname(file) === s) {
            const name = basename(file);
            if (!childNames.has(name)) {
              childNames.add(name);
              childDirents.push({
                name,
                isFile: () => true,
                isDirectory: () => false,
                isSymbolicLink: () => false,
              });
            }
          }
        }
        if (options && typeof options === "object" && options.withFileTypes) {
          return childDirents as unknown as string[];
        }
        return Array.from(childNames) as unknown as string[];
      }) as unknown as typeof fs.readdirSync),
    );
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
      mockDirs.add(tempDir);
      const cleanFile = join(tempDir, "clean.ts");
      const dirtyFile = join(tempDir, "dirty.ts");
      mockFiles.set(cleanFile, "export const PI: number = 3.14;");
      mockFiles.set(dirtyFile, "export const bad: any = true;");

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
      mockDirs.add(tempDir);
      const subDir = join(tempDir, "nested");
      mockDirs.add(subDir);
      mockFiles.set(join(tempDir, "a.ts"), "export const a: string = 'ok';");
      mockFiles.set(join(subDir, "b.tsx"), "export const b = 42;");

      expect(() => assertZeroAny(tempDir)).not.toThrow();

      mockFiles.set(join(subDir, "c.ts"), "export function fail(x: any): void {}");

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
      mockDirs.add(tempDir);
      const nodeModules = join(tempDir, "node_modules");
      mockDirs.add(nodeModules);
      mockFiles.set(join(nodeModules, "ignored.ts"), "const x: any = 1;");
      mockFiles.set(join(tempDir, "valid.ts"), "const x = 1;");
      mockFiles.set(join(tempDir, "valid.tsx"), "const x = 1;");
      mockFiles.set(join(tempDir, "ignored.txt"), "some text");

      const collected = collectTsFiles(tempDir);
      expect(collected.length).toBe(2);
      expect(collected.some((f) => f.endsWith("valid.ts"))).toBe(true);
      expect(collected.some((f) => f.endsWith("valid.tsx"))).toBe(true);
      expect(collected.some((f) => f.includes("node_modules"))).toBe(false);
    });
  });
});
