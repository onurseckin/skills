import { describe, expect, test } from "bun:test";
import {
  hasUnshieldedSubshellOrChaining,
  verifyCommandAuthorization,
} from "../../../olt/scripts/src/policy/rbac/index.ts";
import { createActor, samplePolicy } from "./fixtures.ts";

// VirtualMemoryFS in-memory pure logic tests
describe("RBAC Subshell, Evaluator & Command Defenses", () => {
  test("hasUnshieldedSubshellOrChaining detects subshells, evaluators, and chaining", () => {
    const binaries = ["dash", "fish", "ksh", "csh", "tcsh", "sh.exe", "bash.exe", "zsh.exe"];
    for (const bin of binaries)
      expect(hasUnshieldedSubshellOrChaining(bin, [bin]).detected).toBe(true);

    const evaluators = [
      ["node.exe", "-e", "1"],
      ["bun.exe", "--eval", "1"],
      ["deno", "-e", "1"],
      ["node", "-e=console.log(1)"],
      ["bun", "--eval=console.log(1)"],
      ["python", "-c", "1"],
      ["python", "-c=1"],
      ["perl", "-c=1"],
      ["perl", "-e", "1"],
      ["ruby", "-e=1"],
      ["eval", "1"],
      ["exec", "script.sh"],
    ];
    for (const argv of evaluators)
      expect(hasUnshieldedSubshellOrChaining(argv[0]!, argv).detected).toBe(true);

    expect(hasUnshieldedSubshellOrChaining("ls", ["ls", "&"]).detected).toBe(true);
    expect(hasUnshieldedSubshellOrChaining("ls", ["ls", "||", "true"]).detected).toBe(true);
    expect(hasUnshieldedSubshellOrChaining("git", ["git", "status"]).detected).toBe(false);
    expect(hasUnshieldedSubshellOrChaining("eval", ["custom_token"]).detected).toBe(false);
  });

  test("blocks subshells, evaluators, and chaining with UNSHIELDED_COMMAND_DEFECT", () => {
    const actor = createActor("implementer");
    const defects = [
      "sh -c 'bun test'",
      "bash -c 'git push'",
      ["node", "-e", "process.exit(1)"],
      ["bun", "-e", "console.log(1)"],
      ["python3", "-c", "import os"],
      ["perl", "-e", "print 1"],
      ["ruby", "-e", "puts 1"],
      ["echo", "foo", "&&", "git", "push"],
      ["ls", "|", "grep", "foo"],
      ["git", "status", ";", "rm", "-rf", "/"],
      "eval 'console.log(1)'",
      "exec ./script.sh",
    ];
    for (const cmd of defects) {
      const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
      expect(res.authorized).toBe(false);
      expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    }
  });

  test("blocks ambiguous wrappers and unsafe git options", () => {
    const actor = createActor("implementer");
    for (const wrapper of ["command", "nohup", "nice", "timeout", "xargs", "find"]) {
      const res = verifyCommandAuthorization(actor, [wrapper, "git", "push"], samplePolicy);
      expect(res.authorized).toBe(false);
      expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    }
    const gitDefects = [
      ["git", "-c", "alias.status=!git push", "status"],
      ["git", "unknown-extension", "status"],
      ["git", "diff", "--output=outside.patch"],
      ["git", "diff", "--output", "outside.patch"],
      ["git", "show", "--output=outside.patch", "HEAD"],
      ["git", "archive", "--output=archive.tar", "HEAD"],
    ];
    for (const cmd of gitDefects) {
      const res = verifyCommandAuthorization(actor, cmd, samplePolicy);
      expect(res.authorized).toBe(false);
      expect(res.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");
    }
  });

  test("allows safe read-only git operations and normalized absolute paths", () => {
    const actor = createActor("implementer");
    const safe = [
      ["git", "status"],
      ["git", "diff"],
      ["git", "diff", "HEAD"],
      ["git", "-C", "packages/olt", "status"],
      ["git", "show", "HEAD"],
      ["git", "log", "-p"],
      ["git", "grep", "commit", "--", "README.md"],
      ["git", "ls-files"],
      ["git", "rev-parse", "--show-toplevel"],
    ];
    for (const cmd of safe)
      expect(verifyCommandAuthorization(actor, cmd, samplePolicy).authorized).toBe(true);

    const normRes = verifyCommandAuthorization(
      actor,
      ["/usr/bin/env", "CI=1", "/usr/bin/bun", "test"],
      samplePolicy,
    );
    expect(normRes.error_code).toBe("UNBOUNDED_TEST_RUNNER_FORBIDDEN");
    const envRes = verifyCommandAuthorization(
      actor,
      ["/usr/bin/env", "-S", "git status"],
      samplePolicy,
    );
    expect(envRes.error_code).toBe("UNSHIELDED_COMMAND_DEFECT");

    // Env variants
    expect(
      verifyCommandAuthorization(actor, ["env", "--", "git", "status"], samplePolicy).authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(actor, ["env", "-i", "git", "status"], samplePolicy).authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(
        actor,
        ["env", "--ignore-environment", "git", "status"],
        samplePolicy,
      ).authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(actor, ["env", "-u", "FOO", "git", "status"], samplePolicy)
        .authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(actor, ["env", "--unset=FOO", "git", "status"], samplePolicy)
        .authorized,
    ).toBe(true);

    expect(verifyCommandAuthorization(actor, ["env", "-u"], samplePolicy).error_code).toBe(
      "UNSHIELDED_COMMAND_DEFECT",
    );
    expect(
      verifyCommandAuthorization(actor, ["env", "-u", "-invalid", "git", "status"], samplePolicy)
        .error_code,
    ).toBe("UNSHIELDED_COMMAND_DEFECT");
    expect(
      verifyCommandAuthorization(actor, ["env", "-X", "git", "status"], samplePolicy).error_code,
    ).toBe("UNSHIELDED_COMMAND_DEFECT");
    expect(verifyCommandAuthorization(actor, ["env", "VAR=1"], samplePolicy).error_code).toBe(
      "UNSHIELDED_COMMAND_DEFECT",
    );

    // Git global option variants
    expect(
      verifyCommandAuthorization(actor, ["git", "-C/tmp", "status"], samplePolicy).authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(actor, ["git", "--git-dir=/tmp/.git", "status"], samplePolicy)
        .authorized,
    ).toBe(true);
    expect(
      verifyCommandAuthorization(actor, ["git", "--work-tree=/tmp", "status"], samplePolicy)
        .authorized,
    ).toBe(true);
    expect(verifyCommandAuthorization(actor, ["git", "-C"], samplePolicy).error_code).toBe(
      "UNSHIELDED_COMMAND_DEFECT",
    );
    expect(
      verifyCommandAuthorization(actor, ["git", "-C", "-invalid", "status"], samplePolicy)
        .error_code,
    ).toBe("UNSHIELDED_COMMAND_DEFECT");
    expect(
      verifyCommandAuthorization(actor, ["git", "--unknown-global-opt", "status"], samplePolicy)
        .error_code,
    ).toBe("UNSHIELDED_COMMAND_DEFECT");

    // Prefixed roles
    const valSecurity = createActor("validator-security");
    expect(
      verifyCommandAuthorization(valSecurity, ["git", "status"], samplePolicy).authorized,
    ).toBe(true);
    const implBackend = createActor("implementer_backend");
    expect(
      verifyCommandAuthorization(implBackend, ["git", "status"], samplePolicy).authorized,
    ).toBe(true);
  });
});
