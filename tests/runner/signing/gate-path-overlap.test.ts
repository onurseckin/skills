import { describe, expect, test } from "bun:test";
import type { CommandPathBinding } from "../../../../olt/scripts/src/core/contracts/index.ts";
import {
  gateControlBindingScopeIssues,
  gateControlBindingsOverlapWriteScopes,
} from "../../../../olt/scripts/src/engine/runner/signing/gate-path-overlap.ts";

function binding(overrides: Partial<CommandPathBinding>): CommandPathBinding {
  return {
    argv_index: 0,
    argument: "src/file.ts",
    operand: "src/file.ts",
    role: "config",
    scope: "repository",
    canonical_path: "/repo/src/file.ts",
    relative_path: "src/file.ts",
    kind: "file",
    executable: false,
    device: "1",
    inode: "2",
    mode: 0o644,
    ...overrides,
  };
}

describe("gateControlBindingsOverlapWriteScopes", () => {
  test("flags overlap when a control-input path sits under a mutable write scope", () => {
    const bindings = [binding({ relative_path: "src/feature/module.ts" })];
    const overlap = gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]]);
    expect(overlap).toBe(true);
  });

  test("ignores target-role bindings even when they sit under a write scope", () => {
    const bindings = [binding({ relative_path: "src/feature/module.ts", role: "target" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("ignores bindings outside the repository scope", () => {
    const bindings = [binding({ relative_path: "src/feature/module.ts", scope: "system" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("returns false when no write scope overlaps any control-input path", () => {
    const bindings = [binding({ relative_path: "src/other/module.ts" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("matches a wildcard write scope against its parent directory", () => {
    const bindings = [binding({ relative_path: "src/feature/module.ts" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature/*"]])).toBe(true);
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature/**"]])).toBe(true);
  });
});

describe("gateControlBindingScopeIssues", () => {
  test("returns an issue when bindings overlap a write scope", () => {
    const bindings = [binding({ relative_path: "src/feature/module.ts" })];
    expect(gateControlBindingScopeIssues(bindings, [["src/feature"]])).toEqual([
      "gate control input overlaps a current task mutable write scope",
    ]);
  });

  test("returns no issues when nothing overlaps", () => {
    const bindings = [binding({ relative_path: "src/other/module.ts" })];
    expect(gateControlBindingScopeIssues(bindings, [["src/feature"]])).toEqual([]);
  });
});
