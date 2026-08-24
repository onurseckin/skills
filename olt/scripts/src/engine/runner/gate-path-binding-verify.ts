import { realpathSync, statSync } from "node:fs";
import { delimiter, isAbsolute, relative, resolve, sep } from "node:path";
import type { CommandPathBinding } from "../../core/contracts/commands.ts";
import { canonicalJsonBytes } from "../../core/json.ts";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { commandLayers } from "./command-wrappers.ts";
import { captureGatePathBindings } from "./gate-path-bindings.ts";

export function inside(root: string, path: string): boolean {
  const value = relative(root, path);
  return !isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`);
}

export function portableRelative(repositoryRoot: string, absolutePath: string): string {
  const value = relative(repositoryRoot, absolutePath);
  if (!value || !inside(repositoryRoot, absolutePath))
    throw new HarnessError("PATH_SAFETY", "gate path must resolve inside repositoryRoot");
  return value.split(sep).join("/");
}

export function resolvePathExecutable(argument: string, pathValue: string): string {
  for (const directory of pathValue.split(delimiter)) {
    if (!directory) continue;
    const candidate = resolve(directory, argument);
    try {
      const metadata = statSync(candidate);
      if (metadata.isFile() && (metadata.mode & 0o111) !== 0) return realpathSync(candidate);
    } catch {}
  }
  throw new HarnessError("PATH_SAFETY", `gate executable is not resolvable: ${argument}`);
}

function normalizeBindingForVerification(binding: CommandPathBinding) {
  const { inode: _inode, device: _device, ...rest } = binding;
  return rest;
}

export function gatePathBindingIssues(
  repositoryRoot: string,
  cwd: string,
  argv: readonly string[],
  recorded: CommandPathBinding[] | undefined,
  pathValue = process.env.PATH ?? "",
): string[] {
  try {
    const current = captureGatePathBindings(repositoryRoot, cwd, argv, pathValue);
    const recordedNormalized = recorded?.map(normalizeBindingForVerification);
    const currentNormalized = current.map(normalizeBindingForVerification);
    return recordedNormalized &&
      Buffer.from(canonicalJsonBytes(recordedNormalized)).equals(
        Buffer.from(canonicalJsonBytes(currentNormalized)),
      )
      ? []
      : ["gate path identity or digest changed"];
  } catch (error) {
    return [
      `gate path identity cannot be verified: ${error instanceof Error ? error.message : String(error)}`,
    ];
  }
}

export function assertGatePathBindings(
  repositoryRoot: string,
  cwd: string,
  argv: readonly string[],
  recorded: CommandPathBinding[] | undefined,
  pathValue = process.env.PATH ?? "",
): void {
  const issues = gatePathBindingIssues(repositoryRoot, cwd, argv, recorded, pathValue);
  if (issues.length > 0) throw new HarnessError("INTEGRITY", issues.join("; "));
}

export function executionArgv(
  argv: readonly string[],
  bindings: readonly CommandPathBinding[],
): string[] {
  const layers = commandLayers(argv);
  if (!layers.valid) throw new HarnessError("INTEGRITY", "gate wrapper binding is invalid");
  const result = [...argv];
  for (const index of layers.executableIndices) {
    const binding = bindings.find(
      (candidate) => candidate.argv_index === index && candidate.role === "executable",
    );
    if (!binding)
      throw new HarnessError("INTEGRITY", `gate executable binding ${index} is missing`);
    result[index] = binding.canonical_path;
  }
  return result;
}
