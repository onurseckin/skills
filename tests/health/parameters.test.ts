import { afterAll, describe, expect, test } from "bun:test";
import { scanUnreadParameters } from "../../olt/scripts/src/health/parameters.ts";
import { cleanupTempRoots, sourceOf } from "./fixture.ts";

afterAll(cleanupTempRoots);

function keys(text: string): string[] {
  return scanUnreadParameters(sourceOf("sample.ts", text)).map((entry) => entry.key);
}

describe("a parameter the body never reads is reported", () => {
  test("the discarded argument is named", () => {
    const findings = scanUnreadParameters(
      sourceOf(
        "telemetry.ts",
        [
          "export function detect(agentId: string, host: string): string {",
          "  return host;",
          "}",
        ].join("\n"),
      ),
    );
    expect(findings).toHaveLength(1);
    expect(findings[0]?.key).toBe("unread-parameter:telemetry.ts:detect:agentId");
    expect(findings[0]?.detail).toContain("agentId");
    expect(findings[0]?.line).toBe(1);
  });

  test("a leading underscore is the language's own way of saying the slot is positional", () => {
    expect(
      keys("export function f(_ignored: string, used: string): string {\n  return used;\n}"),
    ).toEqual([]);
  });

  test("each name a destructured parameter binds is checked on its own", () => {
    expect(
      keys(
        [
          "export function f({ read, dropped }: { read: number; dropped: number }): number {",
          "  return read;",
          "}",
        ].join("\n"),
      ),
    ).toEqual(["unread-parameter:sample.ts:f:dropped"]);
  });

  test("a renamed destructured binding is checked under the name the body would use", () => {
    expect(
      keys("export function f({ outer: inner }: { outer: number }): number {\n  return inner;\n}"),
    ).toEqual([]);
  });
});

describe("the shapes that used to make every parameter look unread", () => {
  test("a generic return type is not mistaken for the body", () => {
    expect(
      keys(
        "export function f(items: number[]): Array<{ id: number }> {\n  return items.map((id) => ({ id }));\n}",
      ),
    ).toEqual([]);
  });

  test("a promise return type is not mistaken for the body", () => {
    expect(
      keys(
        "export async function f(value: string): Promise<Record<string, unknown>> {\n  return { value };\n}",
      ),
    ).toEqual([]);
  });

  test("a callback parameter type does not unbalance the parameter list", () => {
    expect(
      keys(
        [
          "export function f(compare: (left: number, right: number) => number, seed: number): number {",
          "  return compare(seed, seed);",
          "}",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("an object return type annotation is skipped before the body is read", () => {
    expect(
      keys("export function f(value: number): { total: number } {\n  return { total: value };\n}"),
    ).toEqual([]);
  });

  test("a defaulted parameter is read like any other", () => {
    expect(keys("export function f(limit = 10): number {\n  return limit;\n}")).toEqual([]);
    expect(keys("export function f(limit = 10): number {\n  return 1;\n}")).toEqual([
      "unread-parameter:sample.ts:f:limit",
    ]);
  });

  test("a rest parameter is read like any other", () => {
    expect(
      keys("export function f(...rest: string[]): number {\n  return rest.length;\n}"),
    ).toEqual([]);
  });

  test("a declaration with no body is skipped rather than guessed at", () => {
    expect(keys("declare function f(value: string): void;")).toEqual([]);
  });

  test("an unbalanced parameter list is skipped rather than reported", () => {
    expect(keys("export function f(value: string")).toEqual([]);
  });

  test("an unbalanced destructuring pattern is salvaged rather than thrown on", () => {
    expect(keys("export function f({ read: number): void {\n  return;\n}")).toEqual([
      "unread-parameter:sample.ts:f:number",
    ]);
  });

  test("an unterminated body is skipped rather than reported", () => {
    expect(keys("export function f(value: string): void {\n  const x = 1;")).toEqual([]);
  });
});
