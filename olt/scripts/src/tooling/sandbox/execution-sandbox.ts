import {
  assertPathWithinBoundaries,
  isCommandSafe,
  sanitizeEnvironmentVariables,
} from "./boundary-guard.ts";
import { IsolatedChildProcessManager } from "./child-process.ts";
import { resolveSandboxPolicy } from "./policy.ts";
import type {
  ChildProcessResult,
  IsolationViolation,
  SandboxExecutionOptions,
  SandboxExecutionResult,
  SandboxPolicyConfig,
} from "./types.ts";

export class DynamicExecutionSandbox {
  private readonly childProcessManager = new IsolatedChildProcessManager();
  private readonly violations: IsolationViolation[] = [];

  public async executeFunction<T>(
    fn: () => Promise<T> | T,
    options: SandboxExecutionOptions = {},
  ): Promise<SandboxExecutionResult<T>> {
    const start = performance.now();
    const policy: SandboxPolicyConfig =
      options.policy ?? resolveSandboxPolicy(options.isolationLevel ?? "restricted");
    const timeoutMs = options.timeoutMs ?? policy.maxExecutionTimeMs ?? 30000;
    const recordedViolations: IsolationViolation[] = [];

    if (options.workingDir) {
      try {
        assertPathWithinBoundaries(options.workingDir, policy, false);
      } catch (err) {
        const violation: IsolationViolation = {
          rule: "PATH_BOUNDARY_VIOLATION",
          details: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        };
        recordedViolations.push(violation);
        this.violations.push(violation);
        return {
          success: false,
          error: violation.details,
          durationMs: performance.now() - start,
          timedOut: false,
          violations: recordedViolations,
        };
      }
    }

    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    try {
      const executionPromise = Promise.resolve().then(() => fn());
      const timeoutPromise = new Promise<never>((_, reject) => {
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error(`Execution timed out after ${timeoutMs}ms`));
          }, timeoutMs);
        }
      });

      const result = await Promise.race([executionPromise, timeoutPromise]);
      if (timer) clearTimeout(timer);

      return {
        success: true,
        result,
        durationMs: performance.now() - start,
        timedOut: false,
        violations: recordedViolations,
      };
    } catch (err) {
      if (timer) clearTimeout(timer);
      const errorMsg = err instanceof Error ? err.message : String(err);
      return {
        success: false,
        error: errorMsg,
        durationMs: performance.now() - start,
        timedOut,
        violations: recordedViolations,
      };
    }
  }

  public async executeCommand(
    command: string,
    args: readonly string[] = [],
    options: SandboxExecutionOptions = {},
  ): Promise<ChildProcessResult> {
    const start = performance.now();
    const policy: SandboxPolicyConfig =
      options.policy ?? resolveSandboxPolicy(options.isolationLevel ?? "restricted");
    const timeoutMs = options.timeoutMs ?? policy.maxExecutionTimeMs ?? 30000;
    const maxBufferBytes = options.maxBufferBytes ?? policy.maxOutputSizeBytes ?? 5242880;

    if (!isCommandSafe(command, args, policy)) {
      const violation: IsolationViolation = {
        rule: "FORBIDDEN_COMMAND_VIOLATION",
        details: `Command '${command}' is prohibited under ${policy.isolationLevel} policy`,
        timestamp: new Date().toISOString(),
      };
      this.violations.push(violation);
      return {
        exitCode: 126,
        signal: null,
        stdout: "",
        stderr: violation.details,
        durationMs: performance.now() - start,
        timedOut: false,
        killed: false,
      };
    }

    if (options.workingDir) {
      try {
        assertPathWithinBoundaries(options.workingDir, policy, false);
      } catch (err) {
        const violation: IsolationViolation = {
          rule: "PATH_BOUNDARY_VIOLATION",
          details: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        };
        this.violations.push(violation);
        return {
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: violation.details,
          durationMs: performance.now() - start,
          timedOut: false,
          killed: false,
        };
      }
    }

    const sanitizedEnv = sanitizeEnvironmentVariables(
      options.environment ?? (process.env as Record<string, string | undefined>),
      policy,
    );

    return this.childProcessManager.runIsolated(command, args, {
      cwd: options.workingDir,
      env: sanitizedEnv,
      timeoutMs,
      maxBufferBytes,
      abortSignal: options.abortSignal,
    });
  }

  public getViolations(): readonly IsolationViolation[] {
    return [...this.violations];
  }

  public clearViolations(): void {
    this.violations.length = 0;
  }

  public killActiveProcesses(): void {
    this.childProcessManager.killAll();
  }
}

let globalSandboxInstance: DynamicExecutionSandbox | null = null;

export function getGlobalExecutionSandbox(): DynamicExecutionSandbox {
  if (!globalSandboxInstance) {
    globalSandboxInstance = new DynamicExecutionSandbox();
  }
  return globalSandboxInstance;
}

export function resetGlobalExecutionSandbox(): void {
  if (globalSandboxInstance) {
    globalSandboxInstance.killActiveProcesses();
    globalSandboxInstance.clearViolations();
  }
  globalSandboxInstance = null;
}
