import { lstatSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/index.ts";
import type { CommandSpec } from "./registry/index.ts";

const isEnoent = (error: unknown): boolean =>
  error instanceof Error && (error as { code?: string }).code === "ENOENT";

export function canonicalizePhysicalPath(path: string, description: string): string {
  let existingPath = resolve(path);
  const missingSuffix: string[] = [];

  while (true) {
    try {
      lstatSync(existingPath);
    } catch (error) {
      if (!isEnoent(error)) {
        throw new HarnessError("PATH_SAFETY", `cannot inspect ${description}: ${existingPath}`);
      }
      const parent = dirname(existingPath);
      if (parent === existingPath) {
        throw new HarnessError("PATH_SAFETY", `cannot resolve ${description}: ${path}`);
      }
      missingSuffix.push(basename(existingPath));
      existingPath = parent;
      continue;
    }

    let canonicalExistingPath: string;
    try {
      canonicalExistingPath = realpathSync(existingPath);
    } catch {
      throw new HarnessError("PATH_SAFETY", `cannot resolve ${description}: ${existingPath}`);
    }
    return missingSuffix.length === 0
      ? canonicalExistingPath
      : join(canonicalExistingPath, ...missingSuffix.reverse());
  }
}

export function isOutside(root: string, target: string): boolean {
  const rel = relative(root, target);
  if (rel === "..") return true;
  if (isAbsolute(rel)) return true;
  return rel.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`);
}

export function assertAuthorityBoundTargets(
  spec: CommandSpec,
  flags: Record<string, unknown>,
): void {
  const authority = spec.authority;
  if (authority?.constrainedPathFlags === undefined) return;
  const authorityRun = flags[authority.authorityRunFlag];
  if (typeof authorityRun !== "string") return;
  if (authorityRun.trim() === "") return;
  const repositoryRoot = resolve(findRepoRoot(authorityRun));
  const physicalRepositoryRoot = canonicalizePhysicalPath(
    repositoryRoot,
    "authority-run repository",
  );
  const constrained = new Set(authority.constrainedPathFlags);
  const qfDefault = join(repositoryRoot, ".olt", "backlog.jsonl");
  if (constrained.has("queue-file") || constrained.has("queue-path")) {
    const chosen =
      (typeof flags["queue-file"] === "string" ? flags["queue-file"] : undefined) ??
      (typeof flags["queue-path"] === "string" ? flags["queue-path"] : undefined) ??
      qfDefault;
    if (constrained.has("queue-file") && typeof flags["queue-file"] !== "string")
      flags["queue-file"] = chosen;
    if (constrained.has("queue-path") && typeof flags["queue-path"] !== "string")
      flags["queue-path"] = chosen;
  }
  if (constrained.has("archive-file") && typeof flags["archive-file"] !== "string") {
    flags["archive-file"] = join(repositoryRoot, ".olt", "completed-tasks.jsonl");
  }
  for (const name of authority.constrainedPathFlags) {
    const target = flags[name];
    if (typeof target !== "string") continue;
    if (target.trim() === "") continue;
    const resolvedTarget = resolve(target);
    if (isOutside(repositoryRoot, resolvedTarget)) {
      throw new HarnessError(
        "PATH_SAFETY",
        `${spec.name} rejects --${name} outside the authority-run repository: ${resolvedTarget}`,
      );
    }
    const physicalTarget = canonicalizePhysicalPath(
      resolvedTarget,
      `${spec.name} --${name} target`,
    );
    if (isOutside(physicalRepositoryRoot, physicalTarget)) {
      throw new HarnessError(
        "PATH_SAFETY",
        `${spec.name} rejects --${name} outside the authority-run repository: ${physicalTarget}`,
      );
    }
  }
}
