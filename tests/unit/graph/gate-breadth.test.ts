import { describe, expect, test } from "bun:test";
import {
  gateBreadthWarning,
  looksWholeSuite,
  scopeIsNarrow,
} from "../../../orchestrating-long-tasks/scripts/src/graph/gate-breadth.ts";

describe("gate breadth", () => {
  test("a runner with no path argument discovers everything", () => {
    expect(looksWholeSuite("bun test")).toBe(true);
    expect(looksWholeSuite("bun run test:unit")).toBe(true);
    expect(looksWholeSuite("cargo test")).toBe(true);
    expect(looksWholeSuite("pytest")).toBe(true);
  });

  test("a runner pointed at a target is scoped", () => {
    expect(looksWholeSuite("bun test tests/db.test.ts")).toBe(false);
    expect(looksWholeSuite("bun test tests/unit/cli")).toBe(false);
    expect(looksWholeSuite("pytest src/api/test_auth.py")).toBe(false);
  });

  test("flags alone do not make a gate scoped", () => {
    expect(looksWholeSuite("bun test --timeout 30000")).toBe(true);
  });

  test("a command that runs no tests is not a suite", () => {
    expect(looksWholeSuite("bun run typecheck")).toBe(false);
    expect(looksWholeSuite("./deploy.sh")).toBe(false);
  });

  test("a scope naming concrete paths is narrow; the repository root is not", () => {
    expect(scopeIsNarrow(["src/db"])).toBe(true);
    expect(scopeIsNarrow(["src/db", "src/api"])).toBe(true);
    expect(scopeIsNarrow(["."])).toBe(false);
    expect(scopeIsNarrow(["**"])).toBe(false);
    expect(scopeIsNarrow([])).toBe(false);
  });

  test("warns only when a broad gate meets a narrow scope", () => {
    const warning = gateBreadthWarning("bun test", ["src/db"]);
    expect(warning).toContain("whole-suite");
    expect(warning).toContain("src/db");
    expect(warning).toContain("--completion-gate");
  });

  test("stays silent when the gate is already scoped", () => {
    expect(gateBreadthWarning("bun test tests/db.test.ts", ["src/db"])).toBeUndefined();
  });

  test("stays silent when the scope really is the whole repository", () => {
    expect(gateBreadthWarning("bun test", ["."])).toBeUndefined();
  });
});
