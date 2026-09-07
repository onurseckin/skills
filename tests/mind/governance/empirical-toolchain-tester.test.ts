import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { testToolchainEmpirically } from "../../../olt/scripts/src/mind/governance/empirical-tester.ts";
import type { DiscoveredToolchainDetails } from "../../../olt/scripts/src/mind/governance/toolchain-inspector.ts";
import {
  createVirtualFSSession,
  type VirtualFSSession,
  VirtualMemoryFS,
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

describe("Empirical Toolchain Governance Suite", () => {
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
