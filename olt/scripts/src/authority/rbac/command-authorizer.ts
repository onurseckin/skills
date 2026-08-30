import { spawn } from "node:child_process";

export interface CommandAuthResult {
  readonly authorized: boolean;
  readonly reason?: string | undefined;
  readonly actorRole: string;
  readonly cmd: readonly string[];
}

export interface CommandExecResult {
  readonly success: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
  readonly authorized: boolean;
  readonly reason?: string | undefined;
}

export interface ShieldedCommandOptions {
  readonly cwd?: string | undefined;
  readonly env?: Record<string, string> | undefined;
  readonly actorRole?: string | undefined;
}

function isTestFileArgument(arg: string): boolean {
  if (arg.startsWith("-")) return false;
  return arg.includes(".test.") || arg.includes(".spec.") || /\.(test|spec)\.[tj]sx?$/u.test(arg);
}

function isWholeSuiteTestRun(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  const second = (cmd[1] ?? "").toLowerCase();

  if (first === "vitest" || first === "jest") return true;
  if (first === "npx" && (second === "vitest" || second === "jest")) return true;
  if (["npm", "pnpm", "yarn"].includes(first)) {
    if (
      second === "test" ||
      second === "t" ||
      (second === "run" && (cmd[2] ?? "").toLowerCase() === "test")
    ) {
      return true;
    }
  }
  if (first === "bun") {
    if (second === "test") return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
    if (second === "run" && (cmd[2] ?? "").toLowerCase() === "test") {
      return !cmd.slice(3).some((arg) => isTestFileArgument(arg));
    }
  }
  if (first === "bun-test") {
    return !cmd.slice(1).some((arg) => isTestFileArgument(arg));
  }
  return false;
}

function isUnauthorizedGitMutation(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  if (first !== "git") return false;
  const sub = (cmd[1] ?? "").toLowerCase();

  if (sub === "checkout" || sub === "reset") return true;
  if (sub === "push") {
    const pushArgs = cmd.slice(2);
    return (
      pushArgs.includes("--force") ||
      pushArgs.includes("-f") ||
      pushArgs.includes("--force-with-lease")
    );
  }
  if (sub === "clean") {
    const cleanArgs = cmd.slice(2);
    const forbidden = new Set(["-f", "-fd", "-fx", "-fxd", "-df", "--force"]);
    return cleanArgs.some((a) => forbidden.has(a) || (a.startsWith("-") && a.includes("f")));
  }
  return false;
}

const FILE_MUTATION_COMMANDS = new Set([
  "rm",
  "touch",
  "mv",
  "cp",
  "mkdir",
  "tee",
  "truncate",
  "patch",
  "chmod",
  "chown",
  "write_to_file",
  "replace_file_content",
  "edit_file",
  "apply_diff",
  "create_file",
  "delete_file",
  "file_writer",
  "code_editor",
  "write",
  "edit",
  "notebookedit",
  "apply_patch",
]);

function isFileMutationCommand(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  const base = first.split(/[\\/]/).pop() ?? "";
  if (FILE_MUTATION_COMMANDS.has(base)) return true;
  if (
    base === "sed" &&
    cmd.slice(1).some((arg) => arg === "-i" || arg.startsWith("-i") || arg.startsWith("--in-place"))
  ) {
    return true;
  }
  return false;
}

function isAnyTestRun(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  const second = (cmd[1] ?? "").toLowerCase();

  if (first === "vitest" || first === "jest" || first === "pytest") return true;
  if (first === "npx" && (second === "vitest" || second === "jest" || second === "pytest")) {
    return true;
  }
  if (["npm", "pnpm", "yarn", "cargo"].includes(first)) {
    if (
      second === "test" ||
      second === "t" ||
      (second === "run" && (cmd[2] ?? "").toLowerCase() === "test")
    ) {
      return true;
    }
  }
  if (
    first === "bun" &&
    (second === "test" || (second === "run" && (cmd[2] ?? "").toLowerCase() === "test"))
  ) {
    return true;
  }
  if (first === "bun-test") return true;
  return cmd.some((arg) => isTestFileArgument(arg));
}

const SUPERVISOR_OR_VALIDATOR_ROLES = new Set([
  "mind",
  "mind-supervisor",
  "mind-auditor",
  "skill-auditor",
  "meta-auditor",
  "orchestrator",
  "coordinator",
  "autonomic-watchdog",
  "watchdog",
  "planner",
  "independent-planner",
  "validator",
  "critic",
  "cognitive-validator",
  "completeness-critic",
  "socratic-validator",
  "plan-validator",
  "ui-validator",
  "mechanic-validator",
  "ui-mechanic-validator",
  "sub-validator",
  "sub-investigator",
]);

function isSupervisorOrValidatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    SUPERVISOR_OR_VALIDATOR_ROLES.has(norm) || norm.includes("validator") || norm.includes("critic")
  );
}

function inferActorRole(actorId: string): string {
  const norm = actorId.toLowerCase();
  for (const prefix of [
    "validator",
    "critic",
    "implementer",
    "worker",
    "coordinator",
    "orchestrator",
    "mind",
  ]) {
    if (
      norm.startsWith(prefix) ||
      norm.includes(`-${prefix}-`) ||
      norm.includes(`_${prefix}_`) ||
      norm.endsWith(prefix)
    ) {
      return prefix;
    }
  }
  return "implementer";
}

export function verifyCommandAuthorization(
  actorRole: string,
  cmd: readonly string[],
): CommandAuthResult {
  if (cmd.length === 0) return { authorized: false, reason: "EMPTY_COMMAND", actorRole, cmd };
  if (isWholeSuiteTestRun(cmd)) {
    return { authorized: false, reason: "WHOLE_SUITE_TEST_RUN_DENIED", actorRole, cmd };
  }
  if (isUnauthorizedGitMutation(cmd)) {
    return { authorized: false, reason: "UNAUTHORIZED_GIT_MUTATION", actorRole, cmd };
  }
  if (isSupervisorOrValidatorRole(actorRole)) {
    if (isAnyTestRun(cmd)) {
      return { authorized: false, reason: "SUPERVISOR_ZERO_TEST_RUNS", actorRole, cmd };
    }
    if (isFileMutationCommand(cmd)) {
      return { authorized: false, reason: "SUPERVISOR_ZERO_CODE_EDITS", actorRole, cmd };
    }
  }
  return { authorized: true, actorRole, cmd };
}

export async function executeShieldedCommand(
  actorId: string,
  cmd: readonly string[],
  options: ShieldedCommandOptions = {},
): Promise<CommandExecResult> {
  const role = options.actorRole ?? inferActorRole(actorId);
  const auth = verifyCommandAuthorization(role, cmd);
  if (!auth.authorized) {
    const errText = auth.reason !== undefined ? auth.reason : "";
    return {
      success: false,
      stdout: "",
      stderr: errText,
      exitCode: 1,
      authorized: false,
      reason: auth.reason,
    };
  }

  return new Promise((resolvePromise) => {
    const firstArg = cmd[0] ?? "";
    const restArgs = cmd.slice(1);
    const proc = spawn(firstArg, restArgs, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      shell: false,
    });
    let stdout = "";
    let stderr = "";
    if (proc.stdout) {
      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString("utf8");
      });
    }
    if (proc.stderr) {
      proc.stderr.on("data", (d: Buffer) => {
        stderr += d.toString("utf8");
      });
    }
    proc.on("error", (err: Error) => {
      resolvePromise({
        success: false,
        stdout,
        stderr: err.message,
        exitCode: 1,
        authorized: true,
        reason: err.message,
      });
    });
    proc.on("close", (code: number | null) => {
      const exitCode = code !== null ? code : 1;
      resolvePromise({ success: exitCode === 0, stdout, stderr, exitCode, authorized: true });
    });
  });
}
