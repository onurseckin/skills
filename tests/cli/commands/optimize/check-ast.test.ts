import { describe, expect, test } from "bun:test";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
} from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  checkAstInvariants,
  normalizeSignature,
  optimizeCheckAstCommand,
  AstInvariantError,
} from "../../../../olt/scripts/src/cli/commands/optimize/check-ast.ts";
import { HarnessError } from "../../../../olt/scripts/src/core/errors/index.ts";
import type { Flags } from "../../../../olt/scripts/src/cli/index.ts";

describe("optimize:check-ast Gate Suite", () => {
  describe("normalizeSignature", () => {
    test("normalizes whitespace and punctuation consistently", () => {
      const s1 = `(
        a: number,
        b: string
      ): Promise<void>`;
      const s2 = `(a: number, b: string): Promise<void>`;
      expect(normalizeSignature(s1)).toBe(normalizeSignature(s2));
    });
  });

  describe("checkAstInvariants - Passing Invariants", () => {
    test("identical exports and signatures pass", () => {
      const code = `
        export function compute(x: number, y: number): number { return x + y; }
        export const MAX_SIZE: number = 100;
        export interface User<T> { id: T; name: string; }
        export type Status = "active" | "inactive";
        export enum Role { Admin = 1, Guest = 2 }
        export class Engine {
          public start(): void {}
          protected ready: boolean = true;
          private key: string = "secret";
        }
        export * from "./barrel";
        export * as helpers from "./helpers";
        export { tool as renamedTool } from "./tools";
        const localA = 1;
        export { localA };
        export default function main(): void {}
      `;
      const result = checkAstInvariants(code, code);
      expect(result.valid).toBe(true);
      expect(result.passed).toBe(true);
      expect(result.breaches.length).toBe(0);
      expect(result.preExports.length).toBeGreaterThan(0);
      expect(result.summary).toContain("AST invariants satisfied");
    });

    test("refactoring implementation while preserving signatures passes", () => {
      const pre = `
        export function calculate(n: number): number {
          let sum = 0;
          for (let i = 0; i < n; i++) sum += i;
          return sum;
        }
      `;
      const post = `
        function helper(n: number): number { return (n * (n - 1)) / 2; }
        export function calculate(n: number): number {
          return helper(n);
        }
      `;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(true);
      expect(result.breaches.length).toBe(0);
    });

    test("modifying private members in exported classes passes", () => {
      const pre = `
        export class Cache {
          public get(key: string): string | undefined { return undefined; }
          private entries = new Map();
        }
      `;
      const post = `
        export class Cache {
          public get(key: string): string | undefined { return undefined; }
          #privateStore = new Set();
          private cleanup(): void {}
        }
      `;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(true);
      expect(result.breaches.length).toBe(0);
    });
  });

  describe("checkAstInvariants - Added / Removed Symbols", () => {
    test("adding an exported function fails with FEATURE_INVENTION_BLUNDER", () => {
      const pre = `export function existing(): void {}`;
      const post = `
        export function existing(): void {}
        export function newFeature(): void {}
      `;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "FEATURE_INVENTION_BLUNDER")).toBe(true);
      expect(result.addedSymbols).toContain("newFeature");
      expect(result.summary).toContain("FEATURE_INVENTION_BLUNDER");
    });

    test("adding an exported const or class fails with FEATURE_INVENTION_BLUNDER", () => {
      const pre = `export const A: number = 1;`;
      const post = `
        export const A: number = 1;
        export const B: number = 2;
        export class NewSvc {}
      `;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "FEATURE_INVENTION_BLUNDER")).toBe(true);
      expect(result.addedSymbols).toEqual(["B", "NewSvc"]);
    });

    test("removing an exported symbol fails with PUBLIC_API_EXPANSION", () => {
      const pre = `
        export function keep(): void {}
        export function drop(): void {}
      `;
      const post = `export function keep(): void {}`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "PUBLIC_API_EXPANSION")).toBe(true);
      expect(result.removedSymbols).toContain("drop");
    });

    test("throwOnBreach or strict throws AstInvariantError on failure", () => {
      const pre = `export function a(): void {}`;
      const post = `export function a(): void {} export function b(): void {}`;
      expect(() => checkAstInvariants(pre, post, { strict: true })).toThrow(AstInvariantError);
      expect(() => checkAstInvariants(pre, post, { throwOnBreach: true })).toThrow(
        AstInvariantError,
      );
    });
  });

  describe("checkAstInvariants - Mutated Signatures", () => {
    test("mutating return type fails with SIGNATURE_MUTATION_BREACH", () => {
      const pre = `export function fn(): Promise<void> { return Promise.resolve(); }`;
      const post = `export function fn(): void {}`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      const breach = result.breaches.find((b) => b.code === "SIGNATURE_MUTATION_BREACH");
      expect(breach).toBeDefined();
      expect(breach?.symbol).toBe("fn");
      expect(result.mutatedSymbols).toContain("fn");
    });

    test("mutating parameters fails with SIGNATURE_MUTATION_BREACH", () => {
      const pre = `export function fn(a: string): void {}`;
      const post = `export function fn(a: string, b?: number): void {}`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "SIGNATURE_MUTATION_BREACH")).toBe(true);
    });

    test("mutating interface property type fails with SIGNATURE_MUTATION_BREACH", () => {
      const pre = `export interface Config { timeout: number; }`;
      const post = `export interface Config { timeout: string; }`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "SIGNATURE_MUTATION_BREACH")).toBe(true);
    });

    test("mutating class public method signature fails with SIGNATURE_MUTATION_BREACH", () => {
      const pre = `export class Api { public exec(cmd: string): boolean { return true; } }`;
      const post = `export class Api { public exec(cmd: string, force?: boolean): boolean { return true; } }`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "SIGNATURE_MUTATION_BREACH")).toBe(true);
    });
  });

  describe("checkAstInvariants - Type Safety Evasion", () => {
    test("as unknown as double-cast fails with TYPE_SAFETY_EVASION_BREACH", () => {
      const pre = `export function safe(x: unknown): string { return String(x); }`;
      const post = `export function safe(x: unknown): string { return x as unknown as string; }`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      const breach = result.breaches.find((b) => b.code === "TYPE_SAFETY_EVASION_BREACH");
      expect(breach).toBeDefined();
      expect(breach?.message).toContain("TYPE_SAFETY_EVASION_BREACH");
      expect(result.evasionBreaches.length).toBeGreaterThan(0);
    });

    test("parenthesized (x as unknown) as Target fails with TYPE_SAFETY_EVASION_BREACH", () => {
      const pre = `export const val: number = 1;`;
      const post = `
        export const val: number = 1;
        const forged = (val as unknown) as string;
      `;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "TYPE_SAFETY_EVASION_BREACH")).toBe(true);
    });

    test("as any as double-cast fails with TYPE_SAFETY_EVASION_BREACH", () => {
      const pre = `export function f(): void {}`;
      const post = `export function f(): void { const bad = 123 as any as string; }`;
      const result = checkAstInvariants(pre, post);
      expect(result.valid).toBe(false);
      expect(result.breaches.some((b) => b.code === "TYPE_SAFETY_EVASION_BREACH")).toBe(true);
    });
  });

  describe("checkAstInvariants - Extended Export Forms", () => {
    test("arrow functions, literals, and default expressions pass", () => {
      const code = `
        export const fn1 = (a: number): string => String(a);
        export const fn2 = function(x: string) { return x; };
        export const flag = true;
        export const disabled = false;
        export const num = 42;
        export const str = "hello";
        export const inferredVar = Symbol("test");
        export interface BaseIface {}
        export interface SubIface extends BaseIface {}
        export class BaseClass {}
        export class MyClass extends BaseClass implements SubIface {
          static readonly VERSION: string = "1.0.0";
          count = 0;
          get size(): number { return this.count; }
          set size(v: number) { this.count = v; }
          [key: string]: unknown;
          constructor(public tag: string) { super(); }
        }
        export type { SomeType } from "./module";
        const localVal = "abc";
        export { localVal as aliasedVal };
        export { externalSymbol };
        export default 999;
      `;
      const result = checkAstInvariants(code, code);
      expect(result.valid).toBe(true);
      expect(result.breaches.length).toBe(0);
    });

    test("function overloads pass when identical", () => {
      const code = `
        export function parse(x: string): string;
        export function parse(x: number): number;
        export function parse(x: string | number): string | number { return x; }
      `;
      const result = checkAstInvariants(code, code);
      expect(result.valid).toBe(true);
      expect(result.breaches.length).toBe(0);
    });
  });

  describe("optimizeCheckAstCommand CLI Integration", () => {
    test("in-memory valid execution returns passing record", async () => {
      const code = `export function greet(name: string): string { return "hi " + name; }`;
      const res = await optimizeCheckAstCommand({ pre: code, post: code });
      expect(res.valid).toBe(true);
      expect(res.passed).toBe(true);
      expect(Array.isArray(res.pre_exports)).toBe(true);
    });

    test("in-memory execution with --json returns json property", async () => {
      const code = `export const ID: string = "abc";`;
      const res = await optimizeCheckAstCommand({ pre: code, post: code, json: true });
      expect(res.valid).toBe(true);
      expect(res.json).toBe(true);
    });

    test("reads from physical file paths when given existing file targets", async () => {
      const filePath = "package.json";
      const res = await optimizeCheckAstCommand({
        target: filePath,
        pre: filePath,
      });
      expect(res.valid).toBe(true);
      expect(res.passed).toBe(true);
      expect(Array.isArray(res.pre_exports)).toBe(true);
    });

    test("resolves git HEAD pre-content when target is tracked and pre is omitted", async () => {
      const res = await optimizeCheckAstCommand({ target: "package.json" });
      expect(res.valid).toBe(true);
      expect(res.passed).toBe(true);
    });

    test("throws INVALID_ARGUMENT when target is untracked in git and pre is omitted", async () => {
      const vfs = new VirtualMemoryFS();
      const session = createVirtualFSSession(vfs);
      const tempUntracked = "/virtual/temp-untracked.ts";
      vfs.mkdirSync("/virtual", { recursive: true });
      vfs.writeFileSync(tempUntracked, "export const temp = 1;");
      try {
        await expect(optimizeCheckAstCommand({ target: tempUntracked })).rejects.toThrow(
          HarnessError,
        );
      } finally {
        session.cleanup();
      }
    });

    test("feature invention throws AstInvariantError with FEATURE_INVENTION_BLUNDER", async () => {
      const pre = `export function a(): void {}`;
      const post = `export function a(): void {} export function b(): void {}`;
      await expect(optimizeCheckAstCommand({ pre, post })).rejects.toThrow(AstInvariantError);
      try {
        await optimizeCheckAstCommand({ pre, post });
      } catch (err) {
        expect(err).toBeInstanceOf(AstInvariantError);
        const invErr = err as AstInvariantError;
        expect(invErr.code).toBe("FEATURE_INVENTION_BLUNDER");
      }
    });

    test("signature mutation throws AstInvariantError with SIGNATURE_MUTATION_BREACH", async () => {
      const pre = `export function a(): Promise<void> {}`;
      const post = `export function a(): void {}`;
      try {
        await optimizeCheckAstCommand({ pre, post });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AstInvariantError);
        const invErr = err as AstInvariantError;
        expect(invErr.code).toBe("SIGNATURE_MUTATION_BREACH");
      }
    });

    test("type evasion throws AstInvariantError with TYPE_SAFETY_EVASION_BREACH", async () => {
      const pre = `export function a(): void {}`;
      const post = `export function a(): void { const x = 1 as unknown as boolean; }`;
      try {
        await optimizeCheckAstCommand({ pre, post });
        expect.unreachable();
      } catch (err) {
        expect(err).toBeInstanceOf(AstInvariantError);
        const invErr = err as AstInvariantError;
        expect(invErr.code).toBe("TYPE_SAFETY_EVASION_BREACH");
      }
    });

    test("missing required flags throws INVALID_ARGUMENT HarnessError", async () => {
      await expect(optimizeCheckAstCommand({})).rejects.toThrow(HarnessError);
      await expect(optimizeCheckAstCommand({ pre: "export const x = 1;" })).rejects.toThrow(
        HarnessError,
      );
    });

    test("non-existent target file throws NOT_FOUND HarnessError", async () => {
      await expect(
        optimizeCheckAstCommand({ target: "/non/existent/path/to/target.ts" }),
      ).rejects.toThrow(HarnessError);
    });

    test("unknown flag throws INVALID_ARGUMENT HarnessError", async () => {
      await expect(
        optimizeCheckAstCommand({ pre: "a", post: "a", bogus: "yes" } as Flags),
      ).rejects.toThrow(HarnessError);
    });
  });
});
