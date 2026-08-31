import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { inspectToolchainDetails, type DiscoveredToolchainDetails } from "./toolchain-inspector.ts";

export type CommandExecutionStatus = "passed" | "failed" | "not_found" | "timeout" | "syntax_error";

export interface EmpiricalCommandTestResult {
  readonly command: string;
  readonly available: boolean;
  readonly exitCode: number | null;
  readonly output?: string | undefined;
  readonly executionTimeMs: number;
  readonly status?: CommandExecutionStatus | undefined;
  readonly resolvedPath?: string | undefined;
}

export interface EmpiricalToolchainReport {
  readonly repoRoot: string;
  readonly verifiedCommands: readonly EmpiricalCommandTestResult[];
  readonly passed: boolean;
  readonly requiredSuccess?: boolean | undefined;
  readonly quorumAchieved?: boolean | undefined;
  readonly failureReasons?: readonly string[] | undefined;
}

export function tokenizeCommandArgs(command: string): { exe: string; args: string[] } {
  const trimmed = command.trim();
  if (trimmed.length === 0) {
    return { exe: "", args: [] };
  }

  const tokens: string[] = [];
  let current = "";
  let inDouble = false;
  let inSingle = false;
  let isEscaped = false;

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === undefined) {
      continue;
    }

    if (isEscaped) {
      current += char;
      isEscaped = false;
      continue;
    }

    if (char === "\\") {
      isEscaped = true;
      continue;
    }

    if (char === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (char === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (/\s/.test(char) && !inDouble && !inSingle) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  const exe = tokens[0] ?? "";
  const args = tokens.slice(1);
  return { exe, args };
}

function resolveLocalBinary(exe: string, cwd: string): { exePath: string; isLocal: boolean } {
  if (exe.length === 0) return { exePath: "", isLocal: false };

  const localNodeBin = join(cwd, "node_modules", ".bin", exe);
  if (existsSync(localNodeBin)) {
    return { exePath: localNodeBin, isLocal: true };
  }

  return { exePath: exe, isLocal: false };
}

export function testCommandEmpirically(
  command: string,
  cwd: string,
  timeoutMs = 2500,
): EmpiricalCommandTestResult {
  const startTime = Date.now();
  const { exe, args } = tokenizeCommandArgs(command);

  if (exe.length === 0) {
    return {
      command,
      available: false,
      exitCode: 1,
      executionTimeMs: 0,
      status: "syntax_error",
    };
  }

  try {
    const { exePath, isLocal } = resolveLocalBinary(exe, cwd);
    const nodeBinDir = join(cwd, "node_modules", ".bin");
    const augmentedPath = process.env.PATH
      ? `${nodeBinDir}${delimiter}${process.env.PATH}`
      : nodeBinDir;

    const res = spawnSync(exePath, args, {
      cwd,
      timeout: timeoutMs,
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf-8",
      env: {
        ...process.env,
        PATH: augmentedPath,
      },
    });

    const executionTimeMs = Date.now() - startTime;
    const isTimeout =
      res.error !== undefined && "code" in res.error && res.error.code === "ETIMEDOUT";
    const isNotFound =
      (res.error !== undefined && "code" in res.error && res.error.code === "ENOENT") ||
      res.status === 127;
    const isSuccess = res.status === 0;

    let status: CommandExecutionStatus;
    if (isTimeout) {
      status = "timeout";
    } else if (isNotFound) {
      status = "not_found";
    } else if (isSuccess) {
      status = "passed";
    } else {
      status = "failed";
    }

    const available = status !== "not_found";

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
      status,
      ...(isLocal ? { resolvedPath: exePath } : {}),
    };
  } catch {
    return {
      command,
      available: false,
      exitCode: 1,
      executionTimeMs: Date.now() - startTime,
      status: "failed",
    };
  }
}

export function testToolchainEmpirically(
  repoRoot: string,
  details?: DiscoveredToolchainDetails,
  options?: { timeoutMs?: number | undefined },
): EmpiricalToolchainReport {
  const root = resolve(repoRoot);
  const discovered = details !== undefined ? details : inspectToolchainDetails(root);
  const commandsToTest: string[] = [];
  const timeoutMs = options?.timeoutMs ?? 2500;

  const runnerCmd = discovered.testRunner.default_command;
  let testRunnerBinary: string | undefined = undefined;
  if (typeof runnerCmd === "string" && runnerCmd.length > 0) {
    const { exe } = tokenizeCommandArgs(runnerCmd);
    if (exe.length > 0) {
      testRunnerBinary = exe;
      commandsToTest.push(`${exe} --version`);
    }
  }

  const tcCmd = discovered.typecheckCommand;
  if (typeof tcCmd === "string" && tcCmd.length > 0) {
    const { exe } = tokenizeCommandArgs(tcCmd);
    if (exe.length > 0 && !commandsToTest.includes(`${exe} --version`)) {
      commandsToTest.push(`${exe} --version`);
    }
  }

  const lintCmd = discovered.lintCommand;
  if (typeof lintCmd === "string" && lintCmd.length > 0) {
    const { exe } = tokenizeCommandArgs(lintCmd);
    if (exe.length > 0 && !commandsToTest.includes(`${exe} --version`)) {
      commandsToTest.push(`${exe} --version`);
    }
  }

  const fmtCmd = discovered.formatCommand;
  if (typeof fmtCmd === "string" && fmtCmd.length > 0) {
    const { exe } = tokenizeCommandArgs(fmtCmd);
    if (exe.length > 0 && !commandsToTest.includes(`${exe} --version`)) {
      commandsToTest.push(`${exe} --version`);
    }
  }

  const verifiedCommands = commandsToTest.map((cmd) => {
    return testCommandEmpirically(cmd, root, timeoutMs);
  });

  const failureReasons: string[] = [];
  let requiredSuccess = true;

  if (testRunnerBinary !== undefined) {
    const runnerResult = verifiedCommands.find((c) => c.command.startsWith(`${testRunnerBinary} `));
    if (runnerResult === undefined || !runnerResult.available) {
      requiredSuccess = false;
      failureReasons.push(`Critical test runner '${testRunnerBinary}' is not available`);
    } else if (runnerResult.exitCode !== 0 || runnerResult.status !== "passed") {
      requiredSuccess = false;
      failureReasons.push(
        `Critical test runner '${testRunnerBinary}' probe failed with status '${runnerResult.status}' (exit code: ${runnerResult.exitCode})`,
      );
    }
  }

  const hasAnyPassed = verifiedCommands.some((c) => c.status === "passed" && c.exitCode === 0);
  const hasAnyAvailable = verifiedCommands.some((c) => c.available);
  const quorumAchieved =
    verifiedCommands.length === 0
      ? true
      : requiredSuccess && (testRunnerBinary !== undefined ? true : hasAnyPassed);
  const passed = verifiedCommands.length === 0 ? true : hasAnyAvailable;

  return {
    repoRoot: root,
    verifiedCommands,
    passed,
    requiredSuccess,
    quorumAchieved,
    ...(failureReasons.length > 0 ? { failureReasons } : {}),
  };
}
