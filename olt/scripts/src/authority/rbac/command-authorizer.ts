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
  return (
    arg.includes(".test.") ||
    arg.includes(".spec.") ||
    arg.endsWith(".test.ts") ||
    arg.endsWith(".spec.ts") ||
    arg.endsWith(".test.js") ||
    arg.endsWith(".spec.js") ||
    arg.endsWith(".test.tsx") ||
    arg.endsWith(".spec.tsx")
  );
}

function isWholeSuiteTestRun(cmd: readonly string[]): boolean {
  if (cmd.length === 0) return false;
  const first = (cmd[0] ?? "").toLowerCase();
  const second = (cmd[1] ?? "").toLowerCase();

  if (first === "vitest" || first === "jest") return true;
  if (first === "npx" && (second === "vitest" || second === "jest")) return true;

  if (first === "npm" || first === "pnpm" || first === "yarn") {
    if (
      second === "test" ||
      second === "t" ||
      (second === "run" && (cmd[2] ?? "").toLowerCase() === "test")
    ) {
      return true;
    }
  }

  if (first === "bun") {
    if (second === "test") {
      return !cmd.slice(2).some((arg) => isTestFileArgument(arg));
    }
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
    return (
      cleanArgs.includes("-f") ||
      cleanArgs.includes("-fd") ||
      cleanArgs.includes("-fx") ||
      cleanArgs.includes("-fxd") ||
      cleanArgs.includes("-df") ||
      cleanArgs.includes("--force") ||
      cleanArgs.some((a) => a.startsWith("-") && a.includes("f"))
    );
  }
  return false;
}

function isCognitiveValidatorRole(role: string): boolean {
  const norm = role.trim().toLowerCase().replace(/_/gu, "-");
  return (
    norm === "validator" ||
    norm === "critic" ||
    norm === "cognitive-validator" ||
    norm === "completeness-critic" ||
    norm === "socratic-validator" ||
    norm === "plan-validator" ||
    norm === "ui-validator" ||
    norm === "mechanic-validator" ||
    norm === "ui-mechanic-validator" ||
    norm === "sub-validator" ||
    norm.includes("validator") ||
    norm.includes("critic")
  );
}

function inferActorRole(actorId: string): string {
  const norm = actorId.toLowerCase();
  if (
    norm.startsWith("validator") ||
    norm.includes("-validator-") ||
    norm.includes("_validator_") ||
    norm.endsWith("validator")
  )
    return "validator";
  if (
    norm.startsWith("critic") ||
    norm.includes("-critic-") ||
    norm.includes("_critic_") ||
    norm.endsWith("critic")
  )
    return "critic";
  if (
    norm.startsWith("implementer") ||
    norm.includes("-implementer-") ||
    norm.includes("_implementer_") ||
    norm.endsWith("implementer")
  )
    return "implementer";
  if (
    norm.startsWith("worker") ||
    norm.includes("-worker-") ||
    norm.includes("_worker_") ||
    norm.endsWith("worker")
  )
    return "worker";
  if (
    norm.startsWith("coordinator") ||
    norm.includes("-coordinator-") ||
    norm.includes("_coordinator_") ||
    norm.endsWith("coordinator")
  )
    return "coordinator";
  if (
    norm.startsWith("orchestrator") ||
    norm.includes("-orchestrator-") ||
    norm.includes("_orchestrator_") ||
    norm.endsWith("orchestrator")
  )
    return "orchestrator";
  if (
    norm.startsWith("mind") ||
    norm.includes("-mind-") ||
    norm.includes("_mind_") ||
    norm.endsWith("mind")
  )
    return "mind";
  return "implementer";
}

export function verifyCommandAuthorization(
  actorRole: string,
  cmd: readonly string[],
): CommandAuthResult {
  if (cmd.length === 0) return { authorized: false, reason: "EMPTY_COMMAND", actorRole, cmd };
  if (isCognitiveValidatorRole(actorRole))
    return { authorized: false, reason: "COGNITIVE_VALIDATOR_COMMAND_LOCK", actorRole, cmd };
  if (isWholeSuiteTestRun(cmd))
    return { authorized: false, reason: "WHOLE_SUITE_TEST_RUN_DENIED", actorRole, cmd };
  if (isUnauthorizedGitMutation(cmd))
    return { authorized: false, reason: "UNAUTHORIZED_GIT_MUTATION", actorRole, cmd };
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
