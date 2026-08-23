import { closeSync } from "node:fs";
import { resolve } from "node:path";
import type { CommandPathBinding } from "../../core/contracts/commands.ts";
import { safeRepoPath } from "../../core/paths.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { commandLayers } from "./command-wrappers.ts";
import { pathOperand, pathRole } from "./gate-path-operands.ts";
import {
  captureOpenedPath,
  createGateCaptureBudget,
  MAX_GATE_PATH_BINDINGS,
  openGatePath,
  type GateCaptureBudget,
  type GatePathHooks,
} from "./gate-path-tree.ts";
import { assertCommandArgv } from "./policy.ts";
import {
  assertGatePathBindings,
  executionArgv,
  gatePathBindingIssues,
  inside,
  portableRelative,
  resolvePathExecutable,
} from "./gate-path-binding-verify.ts";

export { assertGatePathBindings, executionArgv, gatePathBindingIssues };

interface GateCapturePlan {
  argument: string;
  index: number;
  operand: string;
  role: CommandPathBinding["role"];
  canonicalPath: string;
  relativePath?: string;
  scope: "repository" | "system";
  executable: boolean;
}

function captureRepositoryPath(
  repositoryRoot: string,
  capture: GateCapturePlan,
  hooks: GatePathHooks,
  budget: GateCaptureBudget,
): CommandPathBinding {
  const relativePath = capture.relativePath!;
  const path = capture.canonicalPath;
  let descriptor: number;
  try {
    descriptor = openGatePath(path, hooks);
  } catch (error) {
    throw new HarnessError(
      "PATH_SAFETY",
      `gate path must exist without symbolic links: ${relativePath}: ${String(error)}`,
    );
  }
  try {
    const binding = captureOpenedPath(
      descriptor,
      repositoryRoot,
      {
        argv_index: capture.index,
        argument: capture.argument,
        operand: capture.operand,
        scope: "repository",
        role: capture.role,
        canonical_path: path,
        relative_path: relativePath,
        executable: capture.role === "executable",
      },
      hooks,
      budget,
    );
    if (binding.executable && (binding.kind !== "file" || (binding.mode & 0o111) === 0))
      throw new HarnessError(
        "PATH_SAFETY",
        `repo-local gate executable is not executable: ${relativePath}`,
      );
    return binding;
  } finally {
    closeSync(descriptor);
  }
}

function captureSystemExecutable(
  repositoryRoot: string,
  capture: GateCapturePlan,
  hooks: GatePathHooks,
  budget: GateCaptureBudget,
): CommandPathBinding {
  const path = capture.canonicalPath;
  const descriptor = openGatePath(path, hooks);
  try {
    const binding = captureOpenedPath(
      descriptor,
      repositoryRoot,
      {
        argv_index: capture.index,
        argument: capture.argument,
        operand: capture.operand,
        scope: "system",
        role: "executable",
        canonical_path: path,
        executable: true,
      },
      hooks,
      budget,
    );
    if (binding.kind !== "file" || (binding.mode & 0o111) === 0)
      throw new HarnessError("PATH_SAFETY", "resolved gate executable is not executable");
    return binding;
  } finally {
    closeSync(descriptor);
  }
}

export function captureGatePathBindings(
  repositoryRoot: string,
  cwd: string,
  argv: readonly string[],
  pathValue = process.env.PATH ?? "",
  hooks: GatePathHooks = {},
): CommandPathBinding[] {
  assertCommandArgv(argv);
  const layers = commandLayers(argv);
  if (!layers.valid) throw new HarnessError("INVALID_ARGUMENT", "gate command wrapper is invalid");
  const executableIndices = new Set(layers.executableIndices);
  const captures: GateCapturePlan[] = [];
  for (const [index, argument] of argv.entries()) {
    const executable = executableIndices.has(index);
    const operand = pathOperand(argument, cwd, executable);
    if (executable && operand === undefined) {
      const canonicalPath = resolvePathExecutable(argument, pathValue);
      if (inside(repositoryRoot, canonicalPath))
        throw new HarnessError(
          "PATH_SAFETY",
          "bare gate executable resolved inside repositoryRoot",
        );
      captures.push({
        argument,
        index,
        operand: canonicalPath,
        role: "executable",
        canonicalPath,
        scope: "system",
        executable: true,
      });
    } else if (operand !== undefined) {
      const relativePath = portableRelative(repositoryRoot, resolve(cwd, operand));
      captures.push({
        argument,
        index,
        operand,
        role: pathRole(argv, index, cwd, layers.effectiveIndex, executableIndices),
        canonicalPath: safeRepoPath(repositoryRoot, relativePath),
        relativePath,
        scope: "repository",
        executable,
      });
    }
    if (captures.length > MAX_GATE_PATH_BINDINGS)
      throw new HarnessError("INVALID_ARGUMENT", "gate command has too many path bindings");
  }
  const canonicalPaths = new Set<string>();
  for (const capture of captures) {
    if (canonicalPaths.has(capture.canonicalPath))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `gate command repeats canonical path operand: ${capture.canonicalPath}`,
      );
    canonicalPaths.add(capture.canonicalPath);
  }
  const budget = createGateCaptureBudget();
  return captures.map((capture) =>
    capture.scope === "system"
      ? captureSystemExecutable(repositoryRoot, capture, hooks, budget)
      : captureRepositoryPath(repositoryRoot, capture, hooks, budget),
  );
}
