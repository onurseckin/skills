import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { findRepoRoot } from "../../core/index.ts";
import type { RepoEcosystem } from "../types/index.ts";

export function detectRepoEcosystem(repoRoot?: string): RepoEcosystem {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "Cargo.toml")) || existsSync(join(root, "Cargo.lock"))) return "cargo";
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "requirements.txt")) ||
    existsSync(join(root, "Pipfile")) ||
    existsSync(join(root, "setup.py"))
  )
    return "python";
  if (
    existsSync(join(root, "package.json")) ||
    existsSync(join(root, "package-lock.json")) ||
    existsSync(join(root, "yarn.lock")) ||
    existsSync(join(root, "pnpm-lock.yaml"))
  )
    return "node";
  return "unknown";
}
