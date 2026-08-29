import { categorizeDefect } from "../core/sanitizer.ts";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { atomicWriteBytes } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import { isTestEnvironment, resolveScratchDir } from "../../../core/shared/paths.ts";
import type {
  DefectEntry,
  DefectStatus,
  EmpiricalFailureProof,
  SyncDefectResult,
  SyncDoctorDefectOptions,
} from "../../contracts/defect-contracts.ts";

export interface DoctorFindingInput {
  readonly id?: string | undefined;
  readonly code?: string | undefined;
  readonly error_code?: string | undefined;
  readonly rule?: string | undefined;
  readonly severity?: "info" | "warn" | "error" | "critical" | undefined;
  readonly message?: string | undefined;
  readonly description?: string | undefined;
  readonly title?: string | undefined;
  readonly file?: string | undefined;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly repaired?: boolean | undefined;
  readonly context?: Record<string, unknown> | undefined;
}

export function resolveDefectsJsonlPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  const root = isTestEnvironment() ? resolveScratchDir() : process.cwd();
  return join(root, ".olt", "defects.jsonl");
}

export function parseDefectsJsonl(content: string, options?: { readonly capsuleRoot?: string | undefined }): DefectEntry[] {
  if (!content || !content.trim()) return [];
  const entries: DefectEntry[] = [];
  const lines = content.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as DefectEntry;
      if (parsed && typeof parsed === "object" && parsed.id) {
        if (!parsed.category) {
          (parsed as { category: unknown }).category = categorizeDefect(parsed);
        }
        if (!parsed.status) {
          (parsed as { status: unknown }).status = "open";
        }
        if (!parsed.severity) {
          (parsed as { severity: unknown }).severity = "warning";
        }
        if (options?.capsuleRoot && !parsed.capsule_root) {
          (parsed as { capsule_root: unknown }).capsule_root = options.capsuleRoot;
        }
        entries.push(parsed);
      }
    } catch {
      // Ignore corrupt line in parsing
    }
  }
  return entries;
}

export function serializeDefectsJsonl(entries: readonly DefectEntry[]): string {
  if (entries.length === 0) return "";
  return entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
}

function normalizeFindingToDefect(finding: DoctorFindingInput, timestamp: string): DefectEntry {
  const code = finding.code || finding.error_code || finding.rule || "doctor_finding";
  const desc = finding.message || finding.description || finding.title || code;
  const id = finding.id || `doctor-${code}-${Date.now()}`;
  const severity = finding.severity === "critical" ? "critical" : finding.severity === "error" ? "high" : "warning";

  return {
    id,
    type: code,
    category: categorizeDefect({ type: code, observation: desc, remediation: "" }),
    severity,
    status: "open",
    observation: desc,
    remediation: `Remediate doctor finding: ${code}`,
    timestamp,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    count: 1,
    ...(finding.path || finding.file ? { context: { path: finding.path || finding.file, line: finding.line } } : {}),
  };
}

export function syncDoctorFindingsToDefects(
  findings: readonly DoctorFindingInput[],
  options: SyncDoctorDefectOptions = {},
): SyncDefectResult {
  const filePath = resolveDefectsJsonlPath(options.customPath);
  const now = options.timestamp || new Date().toISOString();

  let existingEntries: DefectEntry[] = [];
  if (existsSync(filePath)) {
    existingEntries = parseDefectsJsonl(readFileSync(filePath, "utf-8"));
  }

  const existingMap = new Map<string, DefectEntry>();
  for (const entry of existingEntries) {
    existingMap.set(entry.id, entry);
  }

  let pushed = 0;
  let reopened = 0;
  let skipped = 0;

  for (const finding of findings) {
    if (finding.repaired) {
      skipped += 1;
      continue;
    }

    const defectCandidate = normalizeFindingToDefect(finding, now);
    const existing = existingMap.get(defectCandidate.id);

    if (!existing) {
      existingMap.set(defectCandidate.id, defectCandidate);
      pushed += 1;
    } else {
      if (existing.status === "resolved" || existing.status === "completed") {
        if (!options.failureProof) {
          throw new HarnessError("INTEGRITY", "Cannot reopen previously completed defect without empirical failure proof");
        }
        const updated: DefectEntry = {
          ...existing,
          status: "open",
          last_seen_at: now,
          count: (existing.count ?? 1) + 1,
          reopened_at: now,
          failure_proof: options.failureProof,
        };
        existingMap.set(existing.id, updated);
        reopened += 1;
      } else {
        const updated: DefectEntry = {
          ...existing,
          last_seen_at: now,
          count: (existing.count ?? 1) + 1,
        };
        existingMap.set(existing.id, updated);
        skipped += 1;
      }
    }
  }

  const updatedEntries = Array.from(existingMap.values());
  const serialized = serializeDefectsJsonl(updatedEntries);

  if (!options.dryRun) {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }
    atomicWriteBytes(filePath, Buffer.from(serialized, "utf-8"));
  }

  return {
    pushed_count: pushed,
    reopened_count: reopened,
    skipped_count: skipped,
    total_findings: findings.length,
    defects_file: filePath,
  };
}
