import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { mutateWriteScopeForCounterfactual } from "./mutation.ts";
import type {
  AdversarialCheckOptions,
  AdversarialCheckResult,
  CounterfactualMutation,
  MutationKind,
} from "./types.ts";

export async function runAdversarialCounterfactualCheck(
  targetPath: string,
  options: AdversarialCheckOptions = {},
): Promise<AdversarialCheckResult> {
  const checkId = `adv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const resolvedPath = resolve(targetPath);
  const name =
    typeof options.checkName === "string" && options.checkName.length > 0
      ? options.checkName
      : `adversarial-falsifiability-${basename(resolvedPath)}`;
  const startTime = Date.now();

  if (!existsSync(resolvedPath)) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      message: `Target path does not exist: "${resolvedPath}"`,
      error: `File not found: ${resolvedPath}`,
      durationMs: Date.now() - startTime,
    };
  }

  const cwd =
    typeof options.cwd === "string" && options.cwd.length > 0 ? options.cwd : process.cwd();

  const executeTest = async (
    path: string,
  ): Promise<{ success: boolean; output?: string; exitCode?: number }> => {
    if (typeof options.testRunner === "function") {
      return await options.testRunner(path);
    }

    if (Array.isArray(options.testCommand) && options.testCommand.length > 0) {
      try {
        const cmd = options.testCommand[0];
        const args = options.testCommand.slice(1);
        if (!cmd) return { success: false, output: "Empty test command", exitCode: 1 };
        const proc = spawnSync(cmd, args, { cwd, encoding: "utf-8" });
        const stdoutText = proc.stdout ? String(proc.stdout) : "";
        const stderrText = proc.stderr ? String(proc.stderr) : "";
        const combinedOutput = `${stdoutText}\n${stderrText}`.trim();
        return {
          success: proc.status === 0,
          output: combinedOutput,
          exitCode: proc.status ?? (proc.error ? 1 : 0),
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    }

    if (path.endsWith(".test.ts") || path.endsWith(".spec.ts")) {
      try {
        const proc = spawnSync("bun", ["test", path], { cwd, encoding: "utf-8" });
        const stdoutText = proc.stdout ? String(proc.stdout) : "";
        const stderrText = proc.stderr ? String(proc.stderr) : "";
        const combinedOutput = `${stdoutText}\n${stderrText}`.trim();
        return {
          success: proc.status === 0,
          output: combinedOutput,
          exitCode: proc.status ?? (proc.error ? 1 : 0),
        };
      } catch (err: unknown) {
        return {
          success: false,
          output: err instanceof Error ? err.message : String(err),
          exitCode: 1,
        };
      }
    }

    return {
      success: true,
      output: "No test runner configured; baseline assumed clean",
      exitCode: 0,
    };
  };

  let baselineResult: { success: boolean; output?: string; exitCode?: number };
  try {
    baselineResult = await executeTest(resolvedPath);
  } catch (err: unknown) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      message: `Baseline test execution threw an error before mutation: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  }

  if (!baselineResult.success) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: false,
      output: baselineResult.output,
      exitCode: baselineResult.exitCode,
      message:
        "Baseline test failed before adversarial mutation was applied; target is currently failing",
      durationMs: Date.now() - startTime,
    };
  }

  let mutation: CounterfactualMutation | undefined;
  let revertFn: (() => void) | undefined;
  let revertError: unknown;
  let mutatedTestResult: { success: boolean; output?: string; exitCode?: number };

  try {
    const mutationKind: MutationKind =
      options.mutationKind !== undefined ? options.mutationKind : "syntax_error";
    const mutResult = mutateWriteScopeForCounterfactual(resolvedPath, {
      kind: mutationKind,
      ...(options.customMutator !== undefined ? { customMutator: options.customMutator } : {}),
      ...(options.allowedRoots !== undefined ? { allowedRoots: options.allowedRoots } : {}),
    });
    mutation = mutResult.mutation;
    revertFn = mutResult.revert;
    mutatedTestResult = await executeTest(resolvedPath);
  } catch (err: unknown) {
    return {
      checkId,
      name,
      targetPath: resolvedPath,
      passed: false,
      falsified: false,
      baselinePassed: true,
      mutation,
      message: `Error occurred while executing adversarial mutation test: ${err instanceof Error ? err.message : String(err)}`,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - startTime,
    };
  } finally {
    if (revertFn) {
      try {
        revertFn();
      } catch (err: unknown) {
        revertError = err;
      }
    }
  }

  if (revertError) {
    throw new HarnessError(
      "INVALID_STATE",
      `CRITICAL: Failed to revert counterfactual mutation on "${resolvedPath}": ${revertError instanceof Error ? revertError.message : String(revertError)}`,
    );
  }

  const falsified = !mutatedTestResult.success;
  const passed = baselineResult.success && falsified;
  const message = falsified
    ? `Adversarial counterfactual check passed: Test gate detected injected defect (${mutation.mutationKind}) and failed as expected`
    : `Adversarial counterfactual check failed: Test gate passed despite injected defect (${mutation.mutationKind}); gate is not falsifiable`;

  return {
    checkId,
    name,
    targetPath: resolvedPath,
    passed,
    falsified,
    baselinePassed: true,
    mutation,
    output: mutatedTestResult.output,
    exitCode: mutatedTestResult.exitCode,
    message,
    durationMs: Date.now() - startTime,
  };
}

export const runAdversarialDoctorCheck = runAdversarialCounterfactualCheck;
