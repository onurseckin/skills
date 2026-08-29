import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot } from "../../../core/shared/paths.ts";
import { safeWriteFileSync } from "../../../core/shared/safe-fs/index.ts";
import type {
  AdversarialCheckOptions,
  AdversarialCheckResult,
  CounterfactualMutation,
  MutateScopeResult,
  MutationKind,
  MutationOptions,
} from "./types.ts";

export function compareSemver(actual: string, minimum: string): boolean {
  const left = actual.split(".").map((part) => Number.parseInt(part, 10));
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const leftVal = left[i];
    const rightVal = right[i];
    const l = typeof leftVal === "number" && !Number.isNaN(leftVal) ? leftVal : 0;
    const r = typeof rightVal === "number" && !Number.isNaN(rightVal) ? rightVal : 0;
    if (l !== r) {
      return l > r;
    }
  }
  return true;
}

export function parseIsoTimestamp(input?: string | number | Date): string {
  if (typeof input === "number") {
    return new Date(input).toISOString();
  }
  if (input instanceof Date) {
    return input.toISOString();
  }
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) {
      return new Date(parsed).toISOString();
    }
  }
  return new Date().toISOString();
}

/**
 * Applies a counterfactual mutation to a file within write scope and provides a deterministic revert mechanism.
 */
export function mutateWriteScopeForCounterfactual(
  filePath: string,
  options: MutationOptions = {},
): MutateScopeResult {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.trim().length === 0) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "File path for counterfactual mutation must be a non-empty string",
    );
  }

  const resolvedPath = resolve(filePath);
  if (!existsSync(resolvedPath)) {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `Target file for counterfactual mutation does not exist: "${resolvedPath}"`,
    );
  }

  try {
    const stats = statSync(resolvedPath);
    if (!stats.isFile()) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Target path for counterfactual mutation is not a regular file: "${resolvedPath}"`,
      );
    }
  } catch (err: unknown) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to inspect target file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let originalContent: string;
  try {
    originalContent = readFileSync(resolvedPath, "utf-8");
  } catch (err: unknown) {
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to read target file "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const kind: MutationKind = options.kind !== undefined ? options.kind : "syntax_error";
  let mutatedContent: string;

  switch (kind) {
    case "syntax_error":
      mutatedContent = `${originalContent}\n\n/* HARNESS ADVERSARIAL SYNTAX ERROR INJECTION */\n>>> INJECTED_ADVERSARIAL_SYNTAX_ERROR <<<\n`;
      break;

    case "assertion_flip": {
      let replaced = false;
      const patterns: Record<string, string> = {
        "toBe(true)": "toBe(false)",
        "toBe(false)": "toBe(true)",
        "toBeTrue()": "toBeFalse()",
        "toBeFalse()": "toBeTrue()",
        "=== true": "=== false",
        "=== false": "=== true",
        "!== true": "!== false",
        "!== false": "!== true",
      };
      const regex =
        /toBe\(true\)|toBe\(false\)|toBeTrue\(\)|toBeFalse\(\)|=== true|=== false|!== true|!== false/g;
      let temp = originalContent.replace(regex, (match) => {
        replaced = true;
        const mapped = patterns[match];
        return typeof mapped === "string" ? mapped : match;
      });

      if (!replaced) {
        temp = `${originalContent}\n\n/* HARNESS ADVERSARIAL ASSERTION FLIP */\nthrow new Error("HARNESS_ADVERSARIAL_ASSERTION_FLIP: Test assertion failure injected");\n`;
      }
      mutatedContent = temp;
      break;
    }

    case "return_override":
      mutatedContent = `/* HARNESS ADVERSARIAL RETURN OVERRIDE */\nthrow new Error("HARNESS_ADVERSARIAL_RETURN_OVERRIDE: Function execution halted");\n${originalContent}`;
      break;

    case "empty_file":
      mutatedContent = "";
      break;

    case "exception_injection":
      mutatedContent = `/* HARNESS ADVERSARIAL EXCEPTION INJECTION */\nthrow new Error("HARNESS_ADVERSARIAL_EXCEPTION: Diagnostic probe failure");\n${originalContent}`;
      break;

    case "custom":
      if (typeof options.customMutator !== "function") {
        throw new HarnessError(
          "INVALID_ARGUMENT",
          "Custom mutator function required when mutation kind is 'custom'",
        );
      }
      mutatedContent = options.customMutator(originalContent);
      break;

    default: {
      const exhaustiveCheck: never = kind;
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `Unsupported mutation kind: ${String(exhaustiveCheck)}`,
      );
    }
  }

  const allowedRoots = options.allowedRoots ?? [findRepoRoot(), resolve(tmpdir())];

  try {
    safeWriteFileSync(resolvedPath, mutatedContent, { allowedRoots });
  } catch (err: unknown) {
    if (err instanceof HarnessError) throw err;
    throw new HarnessError(
      "INVALID_STATE",
      `Failed to write mutated content to "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const mutationId = `mut-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const appliedAt = parseIsoTimestamp(options.now);
  const description =
    typeof options.description === "string" && options.description.length > 0
      ? options.description
      : `Counterfactual mutation (${kind}) applied to ${basename(resolvedPath)}`;

  const mutation: CounterfactualMutation = {
    id: mutationId,
    filePath: resolvedPath,
    mutationKind: kind,
    originalContent,
    mutatedContent,
    appliedAt,
    description,
  };

  const revert = (): void => {
    try {
      safeWriteFileSync(resolvedPath, originalContent, { allowedRoots });
    } catch (err: unknown) {
      if (err instanceof HarnessError) throw err;
      throw new HarnessError(
        "INVALID_STATE",
        `Failed to revert counterfactual mutation on "${resolvedPath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return { mutation, revert };
}

/**
 * Alias for mutateWriteScopeForCounterfactual
 */
export const mutateScopeCounterfactual = mutateWriteScopeForCounterfactual;

/**
 * Runs an adversarial counterfactual check against a target file or gate test.
 * Confirms that the test suite passes on original code (baseline) AND fails when mutated (falsifiable).
 */
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
        if (!cmd) {
          return { success: false, output: "Empty test command", exitCode: 1 };
        }
        const proc = spawnSync(cmd, args, {
          cwd,
          encoding: "utf-8",
        });
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

    // Default test execution: if file is a test file, run bun test
    if (path.endsWith(".test.ts") || path.endsWith(".spec.ts")) {
      try {
        const proc = spawnSync("bun", ["test", path], {
          cwd,
          encoding: "utf-8",
        });
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

  // Step 1: Run baseline test runner on pristine code
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

  // Step 2: Apply counterfactual mutation and assert falsifiability
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

/**
 * Alias for runAdversarialCounterfactualCheck
 */
export const runAdversarialDoctorCheck = runAdversarialCounterfactualCheck;
