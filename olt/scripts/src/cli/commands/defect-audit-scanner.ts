import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
  findRepoRoot,
  resolveCapsulesDir,
  resolveDefectsPath,
  resolveCompletedDefectsPath,
} from "../../core/shared/paths.ts";
import type { AuditedDefect, DefectFileDiscovery, DefectStatus } from "./defect-audit-types.ts";

export function discoverDefectFiles(
  capsulesDir: string,
  explicitRunRoot?: string,
): readonly DefectFileDiscovery[] {
  const results: DefectFileDiscovery[] = [];
  const visitedPaths = new Set<string>();

  const repoRoot = findRepoRoot(explicitRunRoot ?? capsulesDir);
  const isCanonicalCapsules =
    resolve(capsulesDir) === resolve(resolveCapsulesDir(repoRoot)) ||
    resolve(capsulesDir) === resolve(repoRoot);

  if (isCanonicalCapsules) {
    const canonicalDefects = resolveDefectsPath(repoRoot);
    if (existsSync(canonicalDefects)) {
      visitedPaths.add(resolve(canonicalDefects));
      results.push({ capsuleName: ".olt", filePath: canonicalDefects });
    }

    const canonicalCompleted = resolveCompletedDefectsPath(repoRoot);
    if (existsSync(canonicalCompleted)) {
      visitedPaths.add(resolve(canonicalCompleted));
      results.push({ capsuleName: ".olt", filePath: canonicalCompleted });
    }
  }

  const rootDefects = join(capsulesDir, "defects.jsonl");
  if (existsSync(rootDefects) && !visitedPaths.has(resolve(rootDefects))) {
    visitedPaths.add(resolve(rootDefects));
    results.push({ capsuleName: "capsules-root", filePath: rootDefects });
  }

  if (existsSync(capsulesDir)) {
    try {
      const entries = readdirSync(capsulesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const defectPath = join(capsulesDir, entry.name, "defects.jsonl");
          const absPath = resolve(defectPath);
          if (existsSync(defectPath) && !visitedPaths.has(absPath)) {
            visitedPaths.add(absPath);
            results.push({ capsuleName: entry.name, filePath: defectPath });
          }
        }
      }
    } catch {}
  }

  if (explicitRunRoot !== undefined) {
    const explicitDefects = join(resolve(explicitRunRoot), "defects.jsonl");
    const absPath = resolve(explicitDefects);
    if (existsSync(explicitDefects) && !visitedPaths.has(absPath)) {
      visitedPaths.add(absPath);
      results.push({ capsuleName: basename(resolve(explicitRunRoot)), filePath: explicitDefects });
    }
  }

  return results;
}

export function parseDefectsFromFile(
  fileInfo: DefectFileDiscovery,
  capsulesDir: string,
): readonly AuditedDefect[] {
  if (!existsSync(fileInfo.filePath)) {
    return [];
  }

  const defects: AuditedDefect[] = [];
  let fileContent = "";
  try {
    fileContent = readFileSync(fileInfo.filePath, "utf-8");
  } catch {
    return [];
  }

  const capsuleDir =
    fileInfo.capsuleName === "capsules-root"
      ? capsulesDir
      : join(capsulesDir, fileInfo.capsuleName);
  const statePath = join(capsuleDir, "state.json");
  const admittedDefectWitnesses = new Map<string, { candidateId: string; status: DefectStatus }>();

  if (existsSync(statePath)) {
    try {
      const stateContent = readFileSync(statePath, "utf-8");
      const stateObj = JSON.parse(stateContent) as Record<string, unknown>;
      const candidates = Array.isArray(stateObj.candidates) ? stateObj.candidates : [];
      for (const cand of candidates) {
        if (typeof cand === "object" && cand !== null) {
          const candRec = cand as Record<string, unknown>;
          const candId = typeof candRec.id === "string" ? candRec.id : "unknown";
          const witness = typeof candRec.witness === "string" ? candRec.witness : "";
          const witnessCmd =
            typeof candRec.witness_command_id === "string" ? candRec.witness_command_id : "";
          const candStatus = typeof candRec.status === "string" ? candRec.status : "";

          const isResolved =
            candStatus === "closed"
              ? true
              : candStatus === "resolved"
                ? true
                : candStatus === "satisfied";
          const isDeclined = candStatus === "declined" ? true : candStatus === "rejected";
          let inferredStatus: DefectStatus = "admitted";
          if (isResolved) {
            inferredStatus = "resolved";
          } else if (isDeclined) {
            inferredStatus = "declined";
          }

          if (witness.length > 0) {
            admittedDefectWitnesses.set(witness, { candidateId: candId, status: inferredStatus });
          }
          if (witnessCmd.length > 0) {
            admittedDefectWitnesses.set(witnessCmd, {
              candidateId: candId,
              status: inferredStatus,
            });
          }
        }
      }
    } catch {}
  }

  const lines = fileContent.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;

    try {
      const raw = JSON.parse(trimmed) as Record<string, unknown>;
      if (typeof raw.id === "string" && typeof raw.type === "string") {
        const id = raw.id;
        const type = raw.type;
        const severity =
          raw.severity === "critical"
            ? "critical"
            : raw.severity === "warning"
              ? "warning"
              : "warning";
        const timestamp =
          typeof raw.timestamp === "string" ? raw.timestamp : new Date().toISOString();
        const pid = typeof raw.pid === "number" ? raw.pid : 0;
        const ppid = typeof raw.ppid === "number" ? raw.ppid : 0;
        const agent_id = typeof raw.agent_id === "string" ? raw.agent_id : null;
        const observation =
          typeof raw.observation === "string" ? raw.observation : "Defect recorded";
        const remediation =
          typeof raw.remediation === "string" ? raw.remediation : "Remediate defect";
        const context =
          typeof raw.context === "object" && raw.context !== null
            ? (raw.context as Record<string, unknown>)
            : {};

        let status: DefectStatus = "open";
        let candidateId: string | null = null;

        const knownStatuses: readonly string[] = [
          "open",
          "admitted",
          "resolved",
          "declined",
          "ignored",
        ];
        if (typeof raw.status === "string" && knownStatuses.includes(raw.status)) {
          status = raw.status as DefectStatus;
        }

        const candidateMatch = admittedDefectWitnesses.get(id);
        if (candidateMatch !== undefined) {
          status = candidateMatch.status;
          candidateId = candidateMatch.candidateId;
        }

        let resolution: Record<string, unknown> | null | undefined = undefined;
        if (typeof raw.resolution === "object" && raw.resolution !== null) {
          resolution = raw.resolution as Record<string, unknown>;
        } else if (raw.resolution === null) {
          resolution = null;
        }

        defects.push({
          id,
          type,
          severity,
          timestamp,
          pid,
          ppid,
          agent_id,
          observation,
          remediation,
          context,
          status,
          source_capsule: fileInfo.capsuleName,
          source_file: fileInfo.filePath,
          candidate_id: candidateId,
          ...(resolution !== undefined ? { resolution } : {}),
        });
      }
    } catch {}
  }

  return defects;
}
