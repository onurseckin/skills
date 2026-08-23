import { describe, expect, test } from "bun:test";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { canonicalCommandFingerprint } from "../../../olt/scripts/src/runner/command-id.ts";
import { captureGateEnvironment } from "../../../olt/scripts/src/runner/gate-environment.ts";
import { restrictedGateGitArgv } from "../../../olt/scripts/src/runner/restricted-git-gate.ts";
import { createInternalCommandRunner } from "../../../olt/scripts/src/runner/internal-command-runner.ts";
import { verifyCommandRecord } from "../../../olt/scripts/src/runner/verify-command.ts";
import {
  createRepositoryGitCommand,
  repositoryGitEnvironment,
} from "../../../olt/scripts/src/packets/repository-git-command.ts";

const restrictedEnvironment = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_NO_REPLACE_OBJECTS: "1",
  GIT_OPTIONAL_LOCKS: "0",
  GIT_PAGER: "cat",
  GIT_TERMINAL_PROMPT: "0",
  PAGER: "cat",
};

const restrictedPrefix = [
  "-c",
  "core.hooksPath=/dev/null",
  "-c",
  "core.fsmonitor=false",
  "-c",
  "diff.external=",
  "-c",
  "pager.diff=false",
  "--no-pager",
];

describe("restricted Git policy", () => {
  test("builds an exact packet Git environment without ambient helper injection", () => {
    expect(
      repositoryGitEnvironment({
        PATH: "/usr/bin:/bin",
        LANG: "C",
        GIT_DIR: "/poison",
        GIT_EXTERNAL_DIFF: "/poison/diff",
        GIT_PAGER: "/poison/pager",
        GIT_CONFIG_COUNT: "1",
        GIT_NO_REPLACE_OBJECTS: "0",
        GIT_REPLACE_REF_BASE: "refs/poison/",
      }),
    ).toEqual({ ...restrictedEnvironment, LANG: "C", PATH: "/usr/bin:/bin" });
  });

  test("uses exact restricted argv and environment at the packet Git spawn seam", () => {
    const calls: unknown[] = [];
    const command = createRepositoryGitCommand(
      { PATH: "/usr/bin:/bin", LANG: "C" },
      (executable, argv, options) => {
        calls.push({ executable, argv, options });
        return { status: 0, stdout: Buffer.from("ok\n"), stderr: Buffer.alloc(0) };
      },
      { preflight: () => true },
    );
    expect(command("/repo", ["status", "--porcelain=v2"], 64)).toEqual({
      status: 0,
      bytes: Buffer.from("ok\n"),
    });
    expect(calls).toEqual([
      {
        executable: "git",
        argv: [...restrictedPrefix, "-C", "/repo", "status", "--porcelain=v2"],
        options: {
          encoding: "buffer",
          env: { ...restrictedEnvironment, LANG: "C", PATH: "/usr/bin:/bin" },
          shell: false,
          stdio: ["ignore", "pipe", "pipe"],
          maxBuffer: 65,
          timeout: 15_000,
          killSignal: "SIGKILL",
        },
      },
    ]);
  });

  test("executes both accepted Git gates with canonical diff restrictions", () => {
    expect(restrictedGateGitArgv(["/usr/bin/git", "diff", "--check"])).toEqual([
      "/usr/bin/git",
      ...restrictedPrefix,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--check",
    ]);
    expect(restrictedGateGitArgv(["/usr/bin/git", "diff", "--cached", "--check"])).toEqual([
      "/usr/bin/git",
      ...restrictedPrefix,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--check",
    ]);
    expect(restrictedGateGitArgv(["Env.EXE", "Git", "diff", "--check"])).toEqual([
      "Env.EXE",
      "Git",
      ...restrictedPrefix,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--check",
    ]);
    expect(
      restrictedGateGitArgv(["COMMAND.EXE", "git.EXE", "diff", "--cached", "--check"]),
    ).toEqual([
      "COMMAND.EXE",
      "git.EXE",
      ...restrictedPrefix,
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--cached",
      "--check",
    ]);
  });

  test("keeps the declared Git gate argv as the fingerprint authority", () => {
    const declared = ["git", "diff", "--check"];
    const before = canonicalCommandFingerprint("/repo", declared);
    restrictedGateGitArgv(["/usr/bin/git", ...declared.slice(1)]);
    expect(declared).toEqual(["git", "diff", "--check"]);
    expect(canonicalCommandFingerprint("/repo", declared)).toBe(before);
  });

  test("adds exact noninteractive Git restrictions to every gate environment", () => {
    const environment = captureGateEnvironment(
      {
        PATH: "/usr/bin:/bin",
        GIT_NO_REPLACE_OBJECTS: "0",
        GIT_PAGER: "/poison/pager",
        PAGER: "less",
      },
      "12345678-1234-4123-8123-123456789abc",
    );
    expect(environment).toMatchObject(restrictedEnvironment);
  });

  test("persists bounded Git execution argv and rejects record drift", async () => {
    const root = mkdtempSync(join(tmpdir(), "restricted-git-record-"));
    const repo = join(root, "repo"),
      tools = join(root, "tools");
    mkdirSync(repo);
    mkdirSync(tools);
    mkdirSync(join(repo, ".olt", "capsules", "commands"), { recursive: true });
    const git = join(tools, "git");
    writeFileSync(git, "not executed\n");
    chmodSync(git, 0o700);
    const previousPath = process.env.PATH;
    process.env.PATH = tools;
    try {
      const binding = {
        schema: "harness.repository-binding" as const,
        version: 1 as const,
        inspection_sha256: "a".repeat(64),
        git_identity_sha256: "b".repeat(64),
        content_sha256: "c".repeat(64),
        file_count: 0,
        total_bytes: 0,
      };
      const runner = createInternalCommandRunner({
        inspectRepository: () => binding,
        attempt: async () => {
          throw new Error("not executed");
        },
      });
      const prepared = await runner.prepareCommand({
        argv: ["git", "diff", "--check"],
        cwd: repo,
        runRoot: join(repo, ".olt", "capsules"),
        commandDir: join(repo, ".olt", "capsules", "commands"),
        actor: "validator",
        gateId: "G-diff",
      });
      expect(prepared.record.execution_argv).toEqual([
        realpathSync(git),
        ...restrictedPrefix,
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--check",
      ]);
      expect(verifyCommandRecord(join(repo, ".olt", "capsules"), prepared.record)).toEqual([]);
      const forged = structuredClone(prepared.record);
      forged.execution_argv!.splice(-2, 1);
      expect(verifyCommandRecord(join(repo, ".olt", "capsules"), forged)).toContain(
        "Git gate execution argv does not match its restricted policy",
      );
      const noncanonical = structuredClone(prepared.record);
      noncanonical.argv = ["./scripts/env", "git", "diff", "--check"];
      noncanonical.fingerprint = canonicalCommandFingerprint(noncanonical.cwd, noncanonical.argv);
      delete noncanonical.execution_argv;
      expect(verifyCommandRecord(join(repo, ".olt", "capsules"), noncanonical)).toContain(
        "Git gate command is not an accepted restricted diff check",
      );
    } finally {
      if (previousPath === undefined) delete process.env.PATH;
      else process.env.PATH = previousPath;
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("rejects non-grammar Git gates before publishing or attempting them", async () => {
    const root = mkdtempSync(join(tmpdir(), "restricted-git-classifier-"));
    const runRoot = join(root, ".olt", "capsules");
    mkdirSync(join(runRoot, "commands"), { recursive: true });
    try {
      let attempted = false;
      const runner = createInternalCommandRunner({
        inspectRepository: () => ({
          schema: "harness.repository-binding",
          version: 1,
          inspection_sha256: "a".repeat(64),
          git_identity_sha256: "b".repeat(64),
          content_sha256: "c".repeat(64),
          file_count: 0,
          total_bytes: 0,
        }),
        attempt: async () => {
          attempted = true;
          throw new Error("must not execute");
        },
      });
      for (const argv of [
        ["git", "status"],
        ["git", "diff", "--check", "HEAD"],
        ["git", "-c", "core.fsmonitor=/poison", "status"],
        ["env", "git", "status"],
        ["command", "git", "status"],
        ["Git", "status"],
        ["env", "GIT", "diff", "--check", "HEAD"],
        ["command", "git.EXE", "status"],
        ["./scripts/git", "diff", "--check"],
        ["./scripts/env", "git", "diff", "--check"],
        ["./scripts/command", "git", "diff", "--cached", "--check"],
      ]) {
        await expect(
          runner.prepareCommand({
            argv,
            cwd: root,
            runRoot,
            commandDir: join(runRoot, "commands"),
            actor: "validator",
            gateId: "G-reject",
          }),
        ).rejects.toThrow("gate command is not an accepted verification command");
      }
      expect(attempted).toBeFalse();
      expect(readdirSync(join(runRoot, "commands"))).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
