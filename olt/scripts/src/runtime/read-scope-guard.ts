import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import { HarnessError } from "../core/errors/index.ts";
import { findRepoRoot } from "../core/shared/paths.ts";
import type { AgentMetadata } from "./index.ts";
import {
  createAgentMetadata,
  findAgentMetadataLocation,
  getAgentMetadataPath,
  withAgentMetadataMutationLock,
  writeAgentMetadataUnlocked,
} from "./index.ts";

export interface ReadScopeCheckResult {
  readonly authorized: boolean;
  readonly error_code?: "READ_SCOPE_EXCEEDED" | "PATH_SAFETY" | string | undefined;
  readonly reason?: string | undefined;
  readonly message?: string | undefined;
}

export const ALWAYS_ACCESSIBLE_PATTERNS: readonly RegExp[] = [
  /package\.json$/i,
  /tsconfig.*\.json$/i,
  /bun\.lockb?$/i,
  /\.gitignore$/i,
  /olt\/policy\.json$/i,
  /(^|\/)contracts\//i,
  /(^|\/)types\//i,
  /(^|\/)shared\//i,
];

export function normalizeScopePath(rawPath: string, rootDir: string): string {
  const resolved = isAbsolute(rawPath) ? resolve(rawPath) : resolve(rootDir, rawPath);
  return relative(rootDir, resolved);
}

export function isPathInScopeList(
  targetRel: string,
  scopeList: readonly string[],
  rootDir: string,
): boolean {
  const normTarget = normalize(targetRel);
  for (const s of scopeList) {
    if (s === "*" || s === "**/*" || s === ".") return true;
    const normScope = normalize(isAbsolute(s) ? relative(rootDir, s) : s);
    if (normTarget === normScope) return true;
    if (normScope.endsWith("/") && normTarget.startsWith(normScope)) return true;
    if (
      !normScope.includes(".") &&
      (normTarget.startsWith(`${normScope}/`) || normTarget === normScope)
    ) {
      return true;
    }
  }
  return false;
}

export function isWithinNeighborhood(
  targetRel: string,
  referenceFiles: readonly string[],
  maxDepth: number = 2,
): boolean {
  const targetDir = dirname(normalize(targetRel));
  const targetParts = targetDir === "." ? [] : targetDir.split("/").filter(Boolean);

  for (const ref of referenceFiles) {
    const refDir = dirname(normalize(ref));
    const refParts = refDir === "." ? [] : refDir.split("/").filter(Boolean);

    // Exact same directory
    if (targetDir === refDir) {
      return true;
    }

    // Root-level file boundaries
    if (refParts.length === 0 || targetParts.length === 0) {
      // Disjoint from root directory unless both at root level
      continue;
    }

    // Calculate common directory depth
    let common = 0;
    const minLen = Math.min(targetParts.length, refParts.length);
    while (common < minLen && targetParts[common] === refParts[common]) {
      common++;
    }

    // Root crossover prevention: MUST share at least 1 top-level directory ancestor
    if (common === 0) {
      continue;
    }

    const diff = targetParts.length - common + (refParts.length - common);
    if (diff <= maxDepth) {
      return true;
    }
  }

  return false;
}

export function checkReadScopeAuthorization(
  actor: AgentMetadata,
  targetFilePath: string,
  repoRoot?: string,
  maxNeighborhoodDepth: number = 2,
): ReadScopeCheckResult {
  const root = repoRoot ? resolve(repoRoot) : findRepoRoot();
  const targetRel = normalizeScopePath(targetFilePath, root);

  // 0. Boundary & Traversal Invariant: block directory traversal outside repo root
  if (targetRel.startsWith("..") || isAbsolute(targetRel)) {
    return {
      authorized: false,
      error_code: "PATH_SAFETY",
      reason: `Path '${targetFilePath}' escapes repository root boundary`,
      message:
        `[PATH_SAFETY] Path '${targetFilePath}' escapes repository root boundary.\n` +
        `Access is strictly confined within repository root: '${root}'.`,
    };
  }

  // 1. Check always-accessible global project files (ONLY against normalized targetRel)
  for (const pattern of ALWAYS_ACCESSIBLE_PATTERNS) {
    if (pattern.test(targetRel)) {
      return { authorized: true };
    }
  }

  // 2. Unbounded or supervisor roles
  if (
    actor.role === "mind" ||
    actor.role === "orchestrator" ||
    actor.role === "coordinator" ||
    actor.role === "meta-auditor" ||
    actor.role === "meta_auditor" ||
    actor.role === "completeness-critic"
  ) {
    return { authorized: true };
  }

  // 3. Direct match in allowed_read_scope or write_scope
  if (isPathInScopeList(targetRel, actor.allowed_read_scope, root)) {
    return { authorized: true };
  }

  if (isPathInScopeList(targetRel, actor.write_scope, root)) {
    return { authorized: true };
  }

  // 4. Neighborhood heuristic against write_scope and allowed_read_scope
  const referenceList = [...actor.write_scope, ...actor.allowed_read_scope];
  if (
    referenceList.length > 0 &&
    isWithinNeighborhood(targetRel, referenceList, maxNeighborhoodDepth)
  ) {
    return { authorized: true };
  }

  // 5. If no scopes defined at all, default allow
  if (actor.write_scope.length === 0 && actor.allowed_read_scope.length === 0) {
    return { authorized: true };
  }

  return {
    authorized: false,
    error_code: "READ_SCOPE_EXCEEDED",
    reason: `File '${targetRel}' is outside declared neighborhood`,
    message:
      `[READ_SCOPE_EXCEEDED] File '${targetRel}' is outside your declared neighborhood.\n` +
      `Focus on your assigned target files or declare access via:\n` +
      `'bun harness.ts scope:expand --actor ${actor.agent_id} --read ${targetRel}'.`,
  };
}

export function expandReadScope(
  agentId: string,
  additionalPath: string,
  runRoot?: string,
): { success: boolean; allowed_read_scope: readonly string[]; metadata: AgentMetadata } {
  const discovered = findAgentMetadataLocation(agentId, runRoot);
  const targetRunRoot = runRoot ?? discovered?.runRoot ?? findRepoRoot();
  const canonicalPath = getAgentMetadataPath(agentId, targetRunRoot);
  const metadata = withAgentMetadataMutationLock(canonicalPath, () => {
    const current = findAgentMetadataLocation(agentId, targetRunRoot);
    if (!current) {
      const created = createAgentMetadata({
        agent_id: agentId,
        role: "implementer",
        allowed_read_scope: [additionalPath],
        run_id: runRoot ? dirname(runRoot) : undefined,
      });
      writeAgentMetadataUnlocked(created, targetRunRoot);
      return created;
    }
    const existing = new Set(current.metadata.allowed_read_scope);
    existing.add(additionalPath);
    const expanded: AgentMetadata = {
      ...current.metadata,
      allowed_read_scope: [...existing],
    };
    writeAgentMetadataUnlocked(expanded, targetRunRoot);
    return expanded;
  });

  return {
    success: true,
    allowed_read_scope: metadata.allowed_read_scope,
    metadata,
  };
}
