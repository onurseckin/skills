import { existsSync, readdirSync, statSync } from "node:fs";
import { isAbsolute, join, normalize, relative, resolve } from "node:path";
import { readCaptures, type CaptureRecord } from "../../engine/store/index.ts";
import type { JsonObject } from "../../core/contracts/index.ts";
import { isJsonObject } from "../../core/contracts/index.ts";
import {
  isUnifiedEvidencePath,
  isUnifiedEvidenceRelativePath,
  UNIFIED_EVIDENCE_DIRECTORY,
  UNIFIED_SCREENSHOTS_DIRECTORY,
} from "../../validation/reporters/index.ts";

export interface EvidenceLocationAuditResult {
  readonly valid: boolean;
  readonly checkedCount: number;
  readonly invalidCount: number;
  readonly invalidPaths: readonly string[];
  readonly issues: readonly string[];
}

export function verifyUnifiedEvidenceLocation(
  runRoot: string,
  state?: JsonObject | null,
): EvidenceLocationAuditResult {
  const issues: string[] = [];
  const invalidPaths: string[] = [];
  let checkedCount = 0;

  const resolvedRunRoot = resolve(runRoot);

  if (existsSync(resolvedRunRoot)) {
    const captures = readCaptures(resolvedRunRoot);
    for (const capture of captures) {
      checkedCount++;
      const pathToCheck = capture.path;
      if (
        !isUnifiedEvidenceRelativePath(pathToCheck) &&
        !isUnifiedEvidencePath(pathToCheck, resolvedRunRoot)
      ) {
        invalidPaths.push(pathToCheck);
        issues.push(
          `Capture record "${capture.name}" (${capture.kind}) has non-unified path "${pathToCheck}": validator outputs must reside under .capsules/<run>/evidence/ (e.g. evidence/screenshots/)`,
        );
      }
    }
  }

  if (state && isJsonObject(state)) {
    const tasks = isJsonObject(state.tasks) ? Object.values(state.tasks) : [];
    for (const task of tasks) {
      if (!isJsonObject(task)) continue;
      const validations = Array.isArray(task.validations) ? task.validations : [];
      for (const val of validations) {
        if (!isJsonObject(val)) continue;
        const findings = Array.isArray(val.findings) ? val.findings : [];
        for (const finding of findings) {
          if (!isJsonObject(finding)) continue;
          const evidenceList = Array.isArray(finding.evidence) ? finding.evidence : [];
          for (const ev of evidenceList) {
            if (isJsonObject(ev) && typeof ev.path === "string") {
              checkedCount++;
              const p = ev.path;
              if (!isUnifiedEvidenceRelativePath(p) && !isUnifiedEvidencePath(p, resolvedRunRoot)) {
                invalidPaths.push(p);
                issues.push(
                  `Task "${task.id}" validation finding evidence path "${p}" violates unified evidence policy: must be under .capsules/<run>/evidence/`,
                );
              }
            }
          }
        }
      }
    }

    const packets = isJsonObject(state.packets) ? Object.values(state.packets) : [];
    for (const packet of packets) {
      if (!isJsonObject(packet)) continue;
      const evidence = isJsonObject(packet.evidence) ? packet.evidence : null;
      if (evidence && Array.isArray(evidence.evidence)) {
        for (const ev of evidence.evidence) {
          if (isJsonObject(ev) && typeof ev.path === "string") {
            checkedCount++;
            const p = ev.path;
            if (!isUnifiedEvidenceRelativePath(p) && !isUnifiedEvidencePath(p, resolvedRunRoot)) {
              invalidPaths.push(p);
              issues.push(
                `Packet "${packet.id}" evidence path "${p}" violates unified evidence policy: must be under .capsules/<run>/evidence/`,
              );
            }
          }
        }
      }
    }
  }

  const physicalEvidenceDir = join(resolvedRunRoot, UNIFIED_EVIDENCE_DIRECTORY);
  if (existsSync(resolvedRunRoot) && existsSync(physicalEvidenceDir)) {
    try {
      const entries = readdirSync(physicalEvidenceDir, { withFileTypes: true });
      for (const ent of entries) {
        checkedCount++;
      }
    } catch {}
  }

  return {
    valid: issues.length === 0,
    checkedCount,
    invalidCount: invalidPaths.length,
    invalidPaths,
    issues,
  };
}
