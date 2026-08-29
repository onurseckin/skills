import { isJsonObject } from "../../core/contracts/index.ts";
import { anchoredChangedPaths, diffAnchor } from "../../packets/round-repository-delta.ts";
import { repositoryGit, type RepositoryGitCommand } from "../../packets/repository-git-command.ts";
import type { WorkflowState } from "../types.ts";
import { pathAllowed } from "./validate-report.ts";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function declaredWriteScopeUnion(tasks: WorkflowState["tasks"]): string[] {
  return [...new Set(Object.values(tasks).flatMap((task) => task.write_scope))];
}

export function outOfBandPaths(
  state: WorkflowState,
  now: Date,
  command: RepositoryGitCommand = repositoryGit,
): string[] {
  const digest = text(state.baseline_repository_inspection_sha256);
  const registry = state.repository_inspections;
  if (digest === "" || !isJsonObject(registry)) return [];
  const inspection = registry[digest];
  if (!isJsonObject(inspection)) return [];
  const repositoryRoot = text(inspection.repository_root);
  if (repositoryRoot === "") return [];
  const changed = anchoredChangedPaths(repositoryRoot, diffAnchor(inspection), now, command);
  if (!changed.paths) return [];
  const scope = declaredWriteScopeUnion(state.tasks);
  return changed.paths.filter((path) => !pathAllowed(path, scope)).sort();
}
