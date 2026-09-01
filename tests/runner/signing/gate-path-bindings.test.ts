import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CommandPathBinding } from "../../../olt/scripts/src/core/contracts/index.ts";
import { captureGatePathBindings } from "../../../olt/scripts/src/engine/runner/signing/gate-path-bindings.ts";
import {
  gateControlBindingScopeIssues,
  gateControlBindingsOverlapWriteScopes,
} from "../../../olt/scripts/src/engine/runner/signing/gate-path-overlap.ts";
import { tempRoot, cleanupTempRoots } from "../command/fixture.ts";

afterEach(cleanupTempRoots);

function createBinding(overrides: Partial<CommandPathBinding>): CommandPathBinding {
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

describe("gate-path-bindings", () => {
  test("rejects repo-local gate executable when file is not executable", () => {
    const repoRoot = tempRoot("gate-bind");
    const scriptPath = join(repoRoot, "run.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho hi\n");
    chmodSync(scriptPath, 0o644);

    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["./run.sh"])).toThrow(
      "repo-local gate executable is not executable: run.sh",
    );
  });

  test("rejects bare executable resolved inside repositoryRoot", () => {
    const repoRoot = tempRoot("gate-bind");
    const binDir = join(repoRoot, "bin");
    mkdirSync(binDir);
    const execPath = join(binDir, "mycmd");
    writeFileSync(execPath, "#!/bin/sh\necho hi\n");
    chmodSync(execPath, 0o755);

    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["mycmd"], binDir)).toThrow(
      "bare gate executable resolved inside repositoryRoot",
    );
  });

  test("rejects invalid command wrappers and nonexistent paths", () => {
    const repoRoot = tempRoot("gate-bind");
    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["command", "-invalid"])).toThrow(
      "gate command wrapper is invalid",
    );

    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["./nonexistent.sh"])).toThrow(
      "gate path must exist without symbolic links",
    );
  });

  test("rejects repeated canonical path operands", () => {
    const repoRoot = tempRoot("gate-bind");
    const file1 = join(repoRoot, "file1.txt");
    writeFileSync(file1, "content");
    const script = join(repoRoot, "test.sh");
    writeFileSync(script, "#!/bin/sh\n");
    chmodSync(script, 0o755);

    expect(() =>
      captureGatePathBindings(repoRoot, repoRoot, ["./test.sh", "./file1.txt", "file1.txt"]),
    ).toThrow("gate command repeats canonical path operand");
  });

  test("successfully captures valid repo and system path bindings", () => {
    const repoRoot = tempRoot("gate-bind");
    const sysDir = tempRoot("gate-sys");
    const sysExec = join(sysDir, "tool");
    writeFileSync(sysExec, "#!/bin/sh\nexit 0\n");
    chmodSync(sysExec, 0o755);

    const repoFile = join(repoRoot, "input.json");
    writeFileSync(repoFile, "{}");

    const bindings = captureGatePathBindings(repoRoot, repoRoot, ["tool", "./input.json"], sysDir);

    expect(bindings.length).toBe(2);
    expect(bindings[0].scope).toBe("system");
    expect(bindings[0].role).toBe("executable");
    expect(bindings[1].scope).toBe("repository");
    expect(bindings[1].role).toBe("target");
  });
});

describe("gateControlBindingsOverlapWriteScopes", () => {
  test("flags overlap when a control-input path sits under a mutable write scope", () => {
    const bindings = [createBinding({ relative_path: "src/feature/module.ts" })];
    const overlap = gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]]);
    expect(overlap).toBe(true);
  });

  test("ignores target-role bindings even when they sit under a write scope", () => {
    const bindings = [createBinding({ relative_path: "src/feature/module.ts", role: "target" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("ignores bindings outside the repository scope", () => {
    const bindings = [createBinding({ relative_path: "src/feature/module.ts", scope: "system" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("returns false when no write scope overlaps any control-input path", () => {
    const bindings = [createBinding({ relative_path: "src/other/module.ts" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature"]])).toBe(false);
  });

  test("matches a wildcard write scope against its parent directory", () => {
    const bindings = [createBinding({ relative_path: "src/feature/module.ts" })];
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature/*"]])).toBe(true);
    expect(gateControlBindingsOverlapWriteScopes(bindings, [["src/feature/**"]])).toBe(true);
  });
});

describe("gateControlBindingScopeIssues", () => {
  test("returns an issue when bindings overlap a write scope", () => {
    const bindings = [createBinding({ relative_path: "src/feature/module.ts" })];
    expect(gateControlBindingScopeIssues(bindings, [["src/feature"]])).toEqual([
      "gate control input overlaps a current task mutable write scope",
    ]);
  });

  test("returns no issues when nothing overlaps", () => {
    const bindings = [createBinding({ relative_path: "src/other/module.ts" })];
    expect(gateControlBindingScopeIssues(bindings, [["src/feature"]])).toEqual([]);
  });
});
