import { existsSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { HarnessError } from "../../../core/errors/index.ts";
import { findRepoRoot } from "../../../core/shared/paths.ts";
import { safeWriteFileSync } from "../../../core/shared/safe-fs/index.ts";
import type {
  CounterfactualMutation,
  MutateScopeResult,
  MutationKind,
  MutationOptions,
} from "./types.ts";

export {
  runAdversarialCounterfactualCheck,
  runAdversarialDoctorCheck,
} from "./check-runner.ts";

export function compareSemver(actual: string, minimum: string): boolean {
  const left = actual.split(".").map((part) => Number.parseInt(part, 10));
  const right = minimum.split(".").map((part) => Number.parseInt(part, 10));
  const len = Math.max(left.length, right.length);
  for (let i = 0; i < len; i += 1) {
    const leftVal = left[i];
    const rightVal = right[i];
    const l = typeof leftVal === "number" && !Number.isNaN(leftVal) ? leftVal : 0;
    const r = typeof rightVal === "number" && !Number.isNaN(rightVal) ? rightVal : 0;
    if (l !== r) return l > r;
  }
  return true;
}

export function parseIsoTimestamp(input?: string | number | Date): string {
  if (typeof input === "number") return new Date(input).toISOString();
  if (input instanceof Date) return input.toISOString();
  if (typeof input === "string") {
    const parsed = Date.parse(input);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return new Date().toISOString();
}

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
      mutatedContent = `${originalContent}\n\n>>> INJECTED_ADVERSARIAL_SYNTAX_ERROR <<<\n`;
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
        temp = `${originalContent}\nthrow new Error("HARNESS_ADVERSARIAL_ASSERTION_FLIP: Test assertion failure injected");\n`;
      }
      mutatedContent = temp;
      break;
    }

    case "return_override":
      mutatedContent = `throw new Error("HARNESS_ADVERSARIAL_RETURN_OVERRIDE: Function execution halted");\n${originalContent}`;
      break;

    case "empty_file":
      mutatedContent = "";
      break;

    case "exception_injection":
      mutatedContent = `throw new Error("HARNESS_ADVERSARIAL_EXCEPTION: Diagnostic probe failure");\n${originalContent}`;
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

export const mutateScopeCounterfactual = mutateWriteScopeForCounterfactual;
