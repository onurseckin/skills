import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { findRepoRoot, isTestEnvironment, resolveCapsulesDir } from "../core/index.ts";
import { isOutside } from "./authority-bound.ts";
import { commandAuthority } from "../packets/index.ts";
import type { CommandSpec } from "./registry/index.ts";

function extractRunFromSessionFile(sessionPath: string): string | undefined {
  try {
    if (!existsSync(sessionPath)) return undefined;
    const content = readFileSync(sessionPath, "utf-8");
    const data = JSON.parse(content);
    if (!data || typeof data !== "object") return undefined;
    const candidate = data.run_id ?? data.run ?? data.runId ?? data.runRoot ?? data.run_root;
    if (typeof candidate === "string" && candidate.trim() !== "") {
      return candidate.trim();
    }
  } catch {
    return undefined;
  }
  return undefined;
}

let cachedHostMonorepoRoot: string | undefined;
function getHostMonorepoRoot(): string | undefined {
  if (cachedHostMonorepoRoot) return cachedHostMonorepoRoot;
  try {
    cachedHostMonorepoRoot = findRepoRoot(import.meta.path);
  } catch {
    cachedHostMonorepoRoot = "";
  }
  return cachedHostMonorepoRoot || undefined;
}

/**
 * Infers the active run identifier or capsule directory path.
 *
 * Order of inference:
 * 1. process.env.OLT_RUN (if defined and non-blank)
 * 2. Active session: check .session.json in cwd walking up to repoRoot, or in repoRoot.
 *    Extract: run_id ?? run ?? runId ?? runRoot ?? run_root
 * 3. Newest unarchived capsule directory in resolveCapsulesDir(repoRoot):
 *    Filter out hidden directories (starting with .) like .locks and filter out "archive".
 *    Sort by mtimeMs descending (most recent first).
 *    Return resolved path.
 */
export function inferActiveRun(repoRoot?: string): string | undefined {
  // Resolve repository root if possible
  let resolvedRepoRoot: string | undefined;
  if (repoRoot) {
    try {
      resolvedRepoRoot = realpathSync(resolve(repoRoot));
    } catch {
      resolvedRepoRoot = resolve(repoRoot);
    }
  } else {
    try {
      resolvedRepoRoot = realpathSync(findRepoRoot());
    } catch {
      resolvedRepoRoot = undefined;
    }
  }

  let cwd: string;
  try {
    cwd = realpathSync(process.cwd());
  } catch {
    cwd = resolve(process.cwd());
  }

  const resolveRunCandidate = (candidate: string): string => {
    if (resolvedRepoRoot) {
      try {
        const capsulesDir = resolveCapsulesDir(resolvedRepoRoot);
        const inCapsules = join(capsulesDir, candidate);
        if (existsSync(inCapsules)) {
          return inCapsules;
        }
        const inPlain = join(resolvedRepoRoot, "capsules", candidate);
        if (existsSync(inPlain)) {
          return inPlain;
        }
      } catch {
        // ignore
      }
    } else {
      const inCwdPlain = join(cwd, "capsules", candidate);
      if (existsSync(inCwdPlain)) {
        return inCwdPlain;
      }
    }
    return candidate;
  };

  const envRun = process.env.OLT_RUN?.trim();
  if (envRun) {
    return resolveRunCandidate(envRun);
  }

  // b. Active session: check .session.json in cwd walking up to repoRoot, or in repoRoot
  const cwdInsideRepo = resolvedRepoRoot !== undefined && !isOutside(resolvedRepoRoot, cwd);
  let currentDir = cwdInsideRepo ? cwd : (resolvedRepoRoot ?? cwd);
  const visited = new Set<string>();
  const hostRepo = getHostMonorepoRoot();
  const isHostRepo =
    hostRepo !== undefined && resolvedRepoRoot !== undefined && resolvedRepoRoot === hostRepo;
  const canCheckRepoSession = !isTestEnvironment() || !isHostRepo;

  while (true) {
    visited.add(currentDir);
    const isAtRepoRoot = resolvedRepoRoot !== undefined && currentDir === resolvedRepoRoot;
    if (!isAtRepoRoot || canCheckRepoSession) {
      const sessionPath = join(currentDir, ".session.json");
      const runFromSession = extractRunFromSessionFile(sessionPath);
      if (runFromSession !== undefined) {
        return resolveRunCandidate(runFromSession);
      }
    }

    if (isAtRepoRoot) {
      break;
    }

    const parent = dirname(currentDir);
    if (parent === currentDir) {
      break;
    }
    currentDir = parent;
  }

  if (resolvedRepoRoot && !visited.has(resolvedRepoRoot) && canCheckRepoSession) {
    const sessionPath = join(resolvedRepoRoot, ".session.json");
    const runFromSession = extractRunFromSessionFile(sessionPath);
    if (runFromSession !== undefined) {
      return resolveRunCandidate(runFromSession);
    }
  }

  // c. Newest unarchived capsule directory in .olt/capsules/ or capsules/:
  // Filter out hidden directories (starting with .) like .locks and filter out "archive".
  // Sort by mtimeMs descending (most recent first). Return resolved path.
  if (!canCheckRepoSession) {
    return undefined;
  }

  const candidateDirs: string[] = [];
  if (resolvedRepoRoot) {
    try {
      candidateDirs.push(resolveCapsulesDir(resolvedRepoRoot));
    } catch {
      // ignore
    }
    candidateDirs.push(join(resolvedRepoRoot, ".olt", "capsules"));
    candidateDirs.push(join(resolvedRepoRoot, "capsules"));
  } else {
    candidateDirs.push(join(cwd, ".olt", "capsules"));
    candidateDirs.push(join(cwd, "capsules"));
  }

  const seenDirs = new Set<string>();
  const candidates: { fullPath: string; mtimeMs: number }[] = [];

  for (const dir of candidateDirs) {
    let resolvedDir: string;
    try {
      resolvedDir = realpathSync(dir);
    } catch {
      resolvedDir = resolve(dir);
    }
    if (seenDirs.has(resolvedDir) || !existsSync(resolvedDir)) {
      continue;
    }
    seenDirs.add(resolvedDir);

    try {
      const entries = readdirSync(resolvedDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith(".") || entry.name === "archive") {
          continue;
        }
        const fullPath = join(resolvedDir, entry.name);
        try {
          const st = statSync(fullPath);
          if (st.isDirectory()) {
            candidates.push({ fullPath, mtimeMs: st.mtimeMs });
          }
        } catch {
          // Ignore unreadable entries
        }
      }
    } catch {
      // Ignore unreadable directory
    }
  }

  if (candidates.length > 0) {
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs || a.fullPath.localeCompare(b.fullPath));
    return candidates[0]!.fullPath;
  }

  return undefined;
}

/**
 * Normalizes `--run`, `--run-id`, and `--capsule` flags on parsedFlags,
 * inferring the active run when omitted and supported by the command spec.
 */
export function applyRunInference(
  spec: CommandSpec,
  parsedFlags: Record<string, unknown>,
  repoRoot?: string,
): void {
  let runCandidate = parsedFlags["run"] ?? parsedFlags["run-id"] ?? parsedFlags["capsule"];
  const acceptsRun = spec.flags.some((f) => f.name === "run");
  const acceptsRunId = spec.flags.some((f) => f.name === "run-id");
  const acceptsCapsule = spec.flags.some((f) => f.name === "capsule");
  const hasConstrained = spec.authority?.constrainedPathFlags !== undefined;
  const expectsQueuePath = spec.flags.some((f) => f.name === "queue-path");

  if (runCandidate === undefined) {
    if (acceptsRun || acceptsRunId || acceptsCapsule || hasConstrained || expectsQueuePath) {
      let resolvedRepo = repoRoot;
      if (!resolvedRepo) {
        try {
          resolvedRepo = findRepoRoot();
        } catch {
          resolvedRepo = undefined;
        }
      }
      const inferred = inferActiveRun(resolvedRepo);
      if (inferred !== undefined) {
        runCandidate = inferred;
      }
    }
  }

  if (runCandidate !== undefined) {
    if (parsedFlags["run"] === undefined) parsedFlags["run"] = runCandidate;

    if (acceptsRunId || parsedFlags["run-id"] !== undefined) {
      parsedFlags["run-id"] = parsedFlags["run"];
    }
    if (acceptsCapsule) {
      parsedFlags["capsule"] = parsedFlags["run"];
    } else {
      delete parsedFlags["capsule"];
    }
    if (!acceptsRunId && !acceptsRun) {
      delete parsedFlags["run-id"];
    }
    if (!acceptsRun && (acceptsRunId || acceptsCapsule)) {
      delete parsedFlags["run"];
    }
  }
}

/**
 * Normalizes `--actor`, `--agent`, and `--agent-id` aliases across commands.
 */
export function applyActorNormalization(
  spec: CommandSpec,
  parsedFlags: Record<string, unknown>,
): void {
  const actorCandidate = parsedFlags["actor"] ?? parsedFlags["agent"] ?? parsedFlags["agent-id"];
  if (actorCandidate !== undefined) {
    const hasActor = spec.flags.some((f) => f.name === "actor");
    const hasAgent = spec.flags.some((f) => f.name === "agent");
    const hasAgentId = spec.flags.some((f) => f.name === "agent-id");

    if (hasActor || hasAgent || hasAgentId) {
      if (
        hasActor &&
        parsedFlags["actor"] === undefined &&
        commandAuthority.subjectFlag(spec) !== "agent"
      ) {
        parsedFlags["actor"] = actorCandidate;
      }
      if (hasAgent && parsedFlags["agent"] === undefined) parsedFlags["agent"] = actorCandidate;
      if (hasAgentId && parsedFlags["agent-id"] === undefined)
        parsedFlags["agent-id"] = actorCandidate;
      if (!hasActor) delete parsedFlags["actor"];
      if (!hasAgent) delete parsedFlags["agent"];
      if (!hasAgentId) delete parsedFlags["agent-id"];
    }
  }
}
