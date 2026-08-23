import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureGatePathBindings } from "../../../olt/scripts/src/engine/runner/gate-path-bindings.ts";

describe("gate-path-bindings", () => {
  test("rejects repo-local gate executable when file is not executable", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-bind-")));
    const scriptPath = join(repoRoot, "run.sh");
    writeFileSync(scriptPath, "#!/bin/sh\necho hi\n");
    chmodSync(scriptPath, 0o644); // Not executable

    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["./run.sh"])).toThrow(
      "repo-local gate executable is not executable: run.sh",
    );
  });

  test("rejects bare executable resolved inside repositoryRoot", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-bind-")));
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
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-bind-")));
    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["command", "-invalid"])).toThrow(
      "gate command wrapper is invalid",
    );

    expect(() => captureGatePathBindings(repoRoot, repoRoot, ["./nonexistent.sh"])).toThrow(
      "gate path must exist without symbolic links",
    );
  });

  test("rejects repeated canonical path operands", () => {
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-bind-")));
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
    const repoRoot = realpathSync(mkdtempSync(join(tmpdir(), "gate-bind-")));
    const sysDir = realpathSync(mkdtempSync(join(tmpdir(), "gate-sys-")));
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
