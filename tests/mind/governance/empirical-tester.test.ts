import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import {
  testCommandEmpirically,
  testToolchainEmpirically,
  tokenizeCommandArgs,
} from "../../../olt/scripts/src/mind/governance/empirical-tester.ts";
import type { DiscoveredToolchainDetails } from "../../../olt/scripts/src/mind/governance/toolchain-inspector.ts";
import {
  createVirtualFSSession,
  VirtualMemoryFS,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";

type SpawnSyncResult = ReturnType<typeof childProcess.spawnSync>;

function mockSpawnSuccess(stdout = "", stderr = ""): SpawnSyncResult {
  return { pid: 1001, output: [null, stdout, stderr], stdout, stderr, status: 0, signal: null };
}

function mockSpawnFailure(status = 1, stderr = "error"): SpawnSyncResult {
  return { pid: 1001, output: [null, "", stderr], stdout: "", stderr, status, signal: null };
}

function mockSpawnError(code: string): SpawnSyncResult {
  const error = Object.assign(new Error(`Command error: ${code}`), { code });
  return {
    pid: 1001,
    output: [null, "", ""],
    stdout: "",
    stderr: "",
    status: null,
    signal: null,
    error,
  };
}

describe("Empirical Command & Toolchain Governance Suite", () => {
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let spawnSpy: { mockRestore: () => void } | undefined;
  const repoRoot = "/virtual/repo-empirical";

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(repoRoot, { recursive: true });
    session = createVirtualFSSession(vfs);
  });

  afterEach(() => {
    spawnSpy?.mockRestore();
    spawnSpy = undefined;
    session.cleanup();
  });

  describe("tokenizeCommandArgs", () => {
    it("handles empty or whitespace-only command strings", () => {
      expect(tokenizeCommandArgs("")).toEqual({ exe: "", args: [] });
      expect(tokenizeCommandArgs("   ")).toEqual({ exe: "", args: [] });
    });

    it("parses single binary and simple arguments", () => {
      expect(tokenizeCommandArgs("bun")).toEqual({ exe: "bun", args: [] });
      expect(tokenizeCommandArgs("bun test --coverage")).toEqual({
        exe: "bun",
        args: ["test", "--coverage"],
      });
    });

    it("handles escaped characters and multiple spaces", () => {
      const res = tokenizeCommandArgs("echo   hello\\ world   test\\;");
      expect(res.exe).toBe("echo");
      expect(res.args).toEqual(["hello world", "test;"]);
    });

    it("handles single and double quoted arguments with nesting", () => {
      expect(tokenizeCommandArgs("cmd \"quoted arg\" 'single arg'").args).toEqual([
        "quoted arg",
        "single arg",
      ]);
      expect(tokenizeCommandArgs("sh -c \"echo 'nested single'\"").args).toEqual([
        "-c",
        "echo 'nested single'",
      ]);
      expect(tokenizeCommandArgs("sh -c 'echo \"nested double\"'").args).toEqual([
        "-c",
        'echo "nested double"',
      ]);
    });
  });

  describe("testCommandEmpirically", () => {
    it("returns syntax_error for empty command", () => {
      const res = testCommandEmpirically("", repoRoot);
      expect(res.status).toBe("syntax_error");
      expect(res.available).toBe(false);
      expect(res.exitCode).toBe(1);
    });

    it("handles passed command with stdout and slices long output", () => {
      const longOut = "x".repeat(600);
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess(longOut),
      );
      const res = testCommandEmpirically("bun --version", repoRoot);
      expect(res.status).toBe("passed");
      expect(res.available).toBe(true);
      expect(res.exitCode).toBe(0);
      expect(res.output).toBe("x".repeat(500));
    });

    it("uses stderr when stdout is empty and sets output undefined when both empty", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess("", "warning on stderr"),
      );
      expect(testCommandEmpirically("bun --version", repoRoot).output).toBe("warning on stderr");

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess("", ""),
      );
      expect(testCommandEmpirically("bun --version", repoRoot).output).toBeUndefined();
    });

    it("handles timeout, ENOENT not_found, and exit status 127", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnError("ETIMEDOUT"),
      );
      const timeoutRes = testCommandEmpirically("bun test", repoRoot);
      expect(timeoutRes.status).toBe("timeout");
      expect(timeoutRes.available).toBe(true);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnError("ENOENT"),
      );
      const enoentRes = testCommandEmpirically("unknown-tool", repoRoot);
      expect(enoentRes.status).toBe("not_found");
      expect(enoentRes.available).toBe(false);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => mockSpawnFailure(127));
      const s127Res = testCommandEmpirically("missing-cmd", repoRoot);
      expect(s127Res.status).toBe("not_found");
      expect(s127Res.exitCode).toBe(127);
    });

    it("handles non-zero exit codes, null status with error, and null status without error", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => mockSpawnFailure(2));
      const failRes = testCommandEmpirically("tsc --noEmit", repoRoot);
      expect(failRes.status).toBe("failed");
      expect(failRes.exitCode).toBe(2);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnError("EOTHER"),
      );
      expect(testCommandEmpirically("tsc", repoRoot).exitCode).toBe(1);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => ({
        pid: 1001,
        output: [null, "", ""],
        stdout: "",
        stderr: "",
        status: null,
        signal: null,
      }));
      expect(testCommandEmpirically("cmd", repoRoot).exitCode).toBe(0);
    });

    it("resolves local binaries in node_modules/.bin and handles PATH env fallback", () => {
      const localBin = `${repoRoot}/node_modules/.bin/oxlint`;
      vfs.mkdirSync(`${repoRoot}/node_modules/.bin`, { recursive: true });
      vfs.writeFileSync(localBin, "#!/bin/sh\n");

      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) => {
        expect(String(cmd)).toBe(localBin);
        return mockSpawnSuccess("oxlint 1.0.0");
      });

      const origPath = process.env.PATH;
      delete process.env.PATH;
      const resNoPath = testCommandEmpirically("oxlint --version", repoRoot);
      expect(resNoPath.resolvedPath).toBe(localBin);
      expect(resNoPath.status).toBe("passed");

      process.env.PATH = origPath;
      const resWithPath = testCommandEmpirically("oxlint --version", repoRoot);
      expect(resWithPath.resolvedPath).toBe(localBin);
    });

    it("catches exceptions thrown during spawnSync execution", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => {
        throw new Error("Fatal process crash");
      });
      const res = testCommandEmpirically("crash-command", repoRoot);
      expect(res.status).toBe("failed");
      expect(res.available).toBe(false);
      expect(res.exitCode).toBe(1);
    });
  });

  describe("testToolchainEmpirically", () => {
    const baseDetails: DiscoveredToolchainDetails = {
      ecosystem: "node",
      testRunner: { default_command: "bun test", timeout_ms: 5000, parallel: true },
      typecheckCommand: "tsc --noEmit",
      lintCommand: "oxlint .",
      formatCommand: "oxlint --fix",
      detectedFormatters: ["oxlint"],
      detectedLinters: ["oxlint"],
      detectedTypecheckers: ["tsc"],
      detectedTestRunners: ["bun test"],
      detectedPackageManagers: ["bun"],
      allowedCommands: ["bun", "tsc", "oxlint"],
      forbiddenCommands: [],
      isMonorepo: false,
      isTypeScript: true,
    };

    it("passes when all toolchain commands succeed and deduplicates probes", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess("v1.0.0"),
      );
      const report = testToolchainEmpirically(repoRoot, baseDetails, { timeoutMs: 1000 });
      expect(report.passed).toBe(true);
      expect(report.requiredSuccess).toBe(true);
      expect(report.quorumAchieved).toBe(true);
      expect(report.verifiedCommands).toHaveLength(3);
    });

    it("records failure when critical test runner is not available", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) =>
        String(cmd).startsWith("bun") ? mockSpawnError("ENOENT") : mockSpawnSuccess("v1.0.0"),
      );
      const report = testToolchainEmpirically(repoRoot, baseDetails);
      expect(report.requiredSuccess).toBe(false);
      expect(report.quorumAchieved).toBe(false);
      expect(report.failureReasons?.[0]).toContain("Critical test runner 'bun' is not available");
    });

    it("records failure when critical test runner probe fails with non-zero exit code", () => {
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation((cmd) =>
        String(cmd).startsWith("bun")
          ? mockSpawnFailure(1, "probe error")
          : mockSpawnSuccess("v1.0.0"),
      );
      const report = testToolchainEmpirically(repoRoot, baseDetails);
      expect(report.requiredSuccess).toBe(false);
      expect(report.quorumAchieved).toBe(false);
      expect(report.failureReasons?.[0]).toContain("Critical test runner 'bun' probe failed");
    });

    it("evaluates quorum and passed status without test runner binary", () => {
      const detailsNoRunner: DiscoveredToolchainDetails = {
        ...baseDetails,
        testRunner: { default_command: "", timeout_ms: 1000, parallel: false },
        typecheckCommand: "tsc",
        lintCommand: undefined,
        formatCommand: undefined,
      };

      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess("v1.0.0"),
      );
      expect(testToolchainEmpirically(repoRoot, detailsNoRunner).quorumAchieved).toBe(true);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() => mockSpawnFailure(1));
      expect(testToolchainEmpirically(repoRoot, detailsNoRunner).quorumAchieved).toBe(false);

      spawnSpy.mockRestore();
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnError("ENOENT"),
      );
      const r = testToolchainEmpirically(repoRoot, detailsNoRunner);
      expect(r.quorumAchieved).toBe(false);
      expect(r.passed).toBe(false);
    });

    it("returns quorumAchieved and passed true when no commands exist to test", () => {
      const emptyDetails: DiscoveredToolchainDetails = {
        ...baseDetails,
        testRunner: { default_command: "", timeout_ms: 1000, parallel: false },
        typecheckCommand: undefined,
        lintCommand: undefined,
        formatCommand: undefined,
      };
      const report = testToolchainEmpirically(repoRoot, emptyDetails);
      expect(report.verifiedCommands).toHaveLength(0);
      expect(report.passed).toBe(true);
      expect(report.quorumAchieved).toBe(true);
    });

    it("discovers toolchain details when details argument is omitted", () => {
      vfs.writeFileSync(
        `${repoRoot}/package.json`,
        JSON.stringify({ name: "test-pkg", scripts: { test: "bun test" } }),
      );
      vfs.writeFileSync(`${repoRoot}/bun.lockb`, "");
      spawnSpy = spyOn(childProcess, "spawnSync").mockImplementation(() =>
        mockSpawnSuccess("v1.0.0"),
      );
      const report = testToolchainEmpirically(repoRoot);
      expect(report.repoRoot).toBeTruthy();
      expect(report.passed).toBe(true);
    });
  });
});
