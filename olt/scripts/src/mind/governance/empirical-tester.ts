import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import {
  inspectToolchainDetails,
  type DiscoveredToolchainDetails,
} from "./toolchain-inspector.ts";

export interface EmpiricalCommandTestResult {
  readonly command: string;
  readonly available: boolean;
  readonly exitCode: number | null;
  readonly output?: string | undefined;
  readonly executionTimeMs: number;
}

export interface EmpiricalToolchainReport {
  readonly repoRoot: string;
  readonly verifiedCommands: readonly EmpiricalCommandTestResult[];
  readonly passed: boolean;
}

export function testCommandEmpirically(
  command: string,
  cwd: string,
  timeoutMs = 5000,
): EmpiricalCommandTestResult {
  const startTime = Date.now();
  try {
    const parts = command.trim().split(/\s+/);
    const exe = parts[0];
    if (exe === undefined) {
      return {
        command,
        available: false,
        exitCode: 1,
        executionTimeMs: 0,
      };
    }
    if (exe.length === 0) {
      return {
        command,
        available: false,
        exitCode: 1,
        executionTimeMs: 0,
      };
    }
    const testArgs = parts.slice(1);
    const res = spawnSync(exe, testArgs, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
    });
    const executionTimeMs = Date.now() - startTime;
    const isSuccessStatus = res.status !== null && res.status !== undefined && res.status === 0;
    const isSpawnSuccess = res.error === undefined && res.status !== null && res.status !== 127;
    const available = isSpawnSuccess ? true : isSuccessStatus;

    let exitCode: number | null = 0;
    if (res.status !== null && res.status !== undefined) {
      exitCode = res.status;
    } else if (res.error !== undefined) {
      exitCode = 1;
    }

    let output: string | undefined = undefined;
    if (typeof res.stdout === "string" && res.stdout.length > 0) {
      output = res.stdout.slice(0, 500);
    } else if (typeof res.stderr === "string" && res.stderr.length > 0) {
      output = res.stderr.slice(0, 500);
    }

    return {
      command,
      available,
      exitCode,
      ...(output !== undefined ? { output } : {}),
      executionTimeMs,
    };
  } catch {
    return {
      command,
      available: false,
      exitCode: 1,
      executionTimeMs: Date.now() - startTime,
    };
  }
}

export function testToolchainEmpirically(
  repoRoot: string,
  details?: DiscoveredToolchainDetails,
): EmpiricalToolchainReport {
  const root = resolve(repoRoot);
  const discovered = details !== undefined ? details : inspectToolchainDetails(root);
  const commandsToTest: string[] = [];

  const runnerCmd = discovered.testRunner.default_command;
  if (typeof runnerCmd === "string" && runnerCmd.length > 0) {
    const baseRunner = runnerCmd.split(" ")[0];
    if (baseRunner !== undefined && baseRunner.length > 0) {
      commandsToTest.push(`${baseRunner} --version`);
    }
  }

  const tcCmd = discovered.typecheckCommand;
  if (typeof tcCmd === "string" && tcCmd.length > 0) {
    const baseTc = tcCmd.split(" ")[0];
    if (baseTc !== undefined && baseTc.length > 0) {
      commandsToTest.push(`${baseTc} --version`);
    }
  }

  const lintCmd = discovered.lintCommand;
  if (typeof lintCmd === "string" && lintCmd.length > 0) {
    const baseLint = lintCmd.split(" ")[0];
    if (baseLint !== undefined && baseLint.length > 0) {
      commandsToTest.push(`${baseLint} --version`);
    }
  }

  const fmtCmd = discovered.formatCommand;
  if (typeof fmtCmd === "string" && fmtCmd.length > 0) {
    const baseFmt = fmtCmd.split(" ")[0];
    if (baseFmt !== undefined && baseFmt.length > 0) {
      commandsToTest.push(`${baseFmt} --version`);
    }
  }

  const verifiedCommands = commandsToTest.map((cmd) => {
    return testCommandEmpirically(cmd, root);
  });

  const hasAnyAvailable = verifiedCommands.some((c) => c.available);
  const passed = verifiedCommands.length === 0 ? true : hasAnyAvailable;

  return {
    repoRoot: root,
    verifiedCommands,
    passed,
  };
}
