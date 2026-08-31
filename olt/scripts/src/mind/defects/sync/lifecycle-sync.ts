import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { atomicWriteBytes } from "../../../core/durable-write.ts";
import { HarnessError } from "../../../core/errors/index.ts";
import {
  isTestEnvironment,
  resolveDefectsPath,
  resolveScratchDir,
} from "../../../core/shared/paths.ts";
import { withDefectLogMutationLock } from "../../../logging/lock.ts";
import type {
  DefectEntry,
  DefectStatus,
  EmpiricalFailureProof,
  SyncDefectResult,
  SyncDoctorDefectOptions,
} from "../../contracts/defect-contracts.ts";
import { createSha256Hash } from "../core/discriminator.ts";
import { categorizeDefect } from "../core/sanitizer.ts";
import { computeNormalizedFailureSignature } from "./signature.ts";

export interface DoctorFindingInput {
  readonly id?: string | undefined;
  readonly code?: string | undefined;
  readonly error_code?: string | undefined;
  readonly rule?: string | undefined;
  readonly severity?:
    | "info"
    | "warn"
    | "error"
    | "critical"
    | "warning"
    | "low"
    | "medium"
    | "high"
    | undefined;
  readonly message?: string | undefined;
  readonly description?: string | undefined;
  readonly title?: string | undefined;
  readonly file?: string | undefined;
  readonly path?: string | undefined;
  readonly line?: number | undefined;
  readonly repaired?: boolean | undefined;
  readonly context?: Readonly<Record<string, unknown>> | undefined;
  readonly observation?: string | undefined;
  readonly remediation?: string | undefined;
  readonly failure_proof?: EmpiricalFailureProof | undefined;
}

export function resolveDefectsJsonlPath(customPath?: string): string {
  if (customPath && customPath.trim()) return resolve(customPath.trim());
  return resolveDefectsPath();
}

export function cleanupVestigialDefectsFile(customDefectPath?: string): void {
  const root = customDefectPath
    ? basename(dirname(customDefectPath)) === ".olt"
      ? dirname(dirname(customDefectPath))
      : dirname(customDefectPath)
    : isTestEnvironment()
      ? resolveScratchDir()
      : process.cwd();
  const vestigialPath = join(root, "olt", "defects.jsonl");
  if (existsSync(vestigialPath)) {
    try {
      const vestigialContent = readFileSync(vestigialPath, "utf-8");
      const canonicalPath = resolveDefectsJsonlPath(customDefectPath);
      if (vestigialContent.trim() && !existsSync(canonicalPath)) {
        const canonicalDir = dirname(canonicalPath);
        if (!existsSync(canonicalDir)) mkdirSync(canonicalDir, { recursive: true, mode: 0o700 });
        writeFileSync(canonicalPath, vestigialContent, "utf-8");
      }
      unlinkSync(vestigialPath);
    } catch {
      // Best-effort cleanup of vestigial loose file
    }
  }
}

export function parseDefectsJsonl(
  content: string,
  options?: { readonly capsuleRoot?: string | undefined },
): DefectEntry[] {
  if (content === undefined) return [];
  if (content === null) return [];
  if (!content.trim()) return [];
  const entries: DefectEntry[] = [];
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed) as DefectEntry;
      if (parsed && typeof parsed === "object" && parsed.id) {
        const record = { ...parsed } as {
          category?: unknown;
          status?: unknown;
          severity?: unknown;
          capsule_root?: unknown;
        };
        if (!record.category) record.category = categorizeDefect(parsed);
        if (!record.status) record.status = "open";
        if (!record.severity) record.severity = "warning";
        if (options?.capsuleRoot && !record.capsule_root) record.capsule_root = options.capsuleRoot;
        entries.push(record as DefectEntry);
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

export function normalizeFindingToDefect(
  finding: DoctorFindingInput,
  timestamp: string,
): DefectEntry {
  const rawCode =
    finding.code !== undefined && finding.code !== ""
      ? finding.code
      : finding.error_code !== undefined && finding.error_code !== ""
        ? finding.error_code
        : finding.rule !== undefined && finding.rule !== ""
          ? finding.rule
          : "doctor_finding";
  const code = rawCode.trim();

  const rawFilePath =
    finding.path !== undefined && finding.path !== ""
      ? finding.path
      : finding.file !== undefined && finding.file !== ""
        ? finding.file
        : "";
  const filePath = rawFilePath.trim();

  const line = finding.line !== undefined ? String(finding.line) : "";
  const rawDesc =
    finding.message !== undefined && finding.message !== ""
      ? finding.message
      : finding.description !== undefined && finding.description !== ""
        ? finding.description
        : finding.title !== undefined && finding.title !== ""
          ? finding.title
          : finding.observation !== undefined && finding.observation !== ""
            ? finding.observation
            : code;
  const desc = rawDesc.trim();

  const category = categorizeDefect({
    type: code,
    observation: desc,
    remediation: finding.remediation !== undefined ? finding.remediation : "",
  });
  const dedupKey = computeNormalizedFailureSignature({
    category,
    code,
    path: filePath,
    message: desc,
    line: finding.line,
  });
  const contentHash = dedupKey.slice(0, 12);
  const sanitizedCode = code
    .toLowerCase()
    .replace(/_/g, "-")
    .replace(/[^a-z0-9-]/g, "-");
  const id =
    finding.id !== undefined && finding.id.trim() !== ""
      ? finding.id.trim()
      : `doctor-${sanitizedCode}-${contentHash}`;

  let severity: "critical" | "high" | "low" | "warning" = "warning";
  if (finding.severity === "critical") severity = "critical";
  else if (finding.severity === "error") severity = "high";
  else if (finding.severity === "high") severity = "high";
  else if (finding.severity === "low") severity = "low";
  else if (finding.severity === "info") severity = "low";

  const remediation =
    finding.remediation !== undefined && finding.remediation !== ""
      ? finding.remediation
      : `Remediate doctor finding: ${code}`;

  return {
    id,
    type: code,
    category,
    severity,
    status: "open",
    observation: desc,
    remediation,
    timestamp,
    first_seen_at: timestamp,
    last_seen_at: timestamp,
    count: 1,
    dedup_key: dedupKey,
    ...(filePath ? { context: { path: filePath, ...(line ? { line: finding.line } : {}) } } : {}),
  };
}

function executeDefectSync(
  existingEntries: readonly DefectEntry[],
  findings: readonly DoctorFindingInput[],
  now: string,
  options: SyncDoctorDefectOptions,
  filePath: string,
  persist: boolean,
): SyncDefectResult {
  const existingById = new Map<string, DefectEntry>();
  const existingByDedupKey = new Map<string, DefectEntry>();
  for (const entry of existingEntries) {
    existingById.set(entry.id, entry);
    if (entry.dedup_key) existingByDedupKey.set(entry.dedup_key, entry);
  }

  let newlyCreated = 0;
  let reopened = 0;
  let existingUpdated = 0;
  let unchanged = 0;

  for (const finding of findings) {
    if (finding.repaired) {
      unchanged += 1;
      continue;
    }

    const defectCandidate = normalizeFindingToDefect(finding, now);
    const byIdCandidate =
      defectCandidate.id !== undefined && defectCandidate.id !== ""
        ? existingById.get(defectCandidate.id)
        : undefined;
    const byDedupCandidate =
      defectCandidate.dedup_key !== undefined && defectCandidate.dedup_key !== ""
        ? existingByDedupKey.get(defectCandidate.dedup_key)
        : undefined;
    const existing = byIdCandidate !== undefined ? byIdCandidate : byDedupCandidate;

    if (!existing) {
      existingById.set(defectCandidate.id, defectCandidate);
      if (defectCandidate.dedup_key)
        existingByDedupKey.set(defectCandidate.dedup_key, defectCandidate);
      newlyCreated += 1;
    } else {
      if (["resolved", "completed", "closed"].includes(existing.status)) {
        let resolvedCommitSha = "empirical-proof-pending";
        if (options.commitSha !== undefined && options.commitSha !== "") {
          resolvedCommitSha = options.commitSha;
        } else if (
          typeof finding.context?.["commit_sha"] === "string" &&
          finding.context["commit_sha"] !== ""
        ) {
          resolvedCommitSha = finding.context["commit_sha"] as string;
        } else if (
          typeof finding.failure_proof?.commit_sha === "string" &&
          finding.failure_proof.commit_sha !== ""
        ) {
          resolvedCommitSha = finding.failure_proof.commit_sha;
        }

        const resolvedTestAssertion =
          finding.message !== undefined && finding.message !== ""
            ? finding.message
            : finding.description !== undefined && finding.description !== ""
              ? finding.description
              : finding.code !== undefined && finding.code !== ""
                ? finding.code
                : "Doctor check assertion failed";

        let resolvedTaskId = "doctor-run";
        if (options.runId !== undefined && options.runId !== "") {
          resolvedTaskId = options.runId;
        } else if (
          typeof finding.context?.["task_id"] === "string" &&
          finding.context["task_id"] !== ""
        ) {
          resolvedTaskId = finding.context["task_id"] as string;
        }

        const resolvedErrorCode =
          finding.code !== undefined && finding.code !== ""
            ? finding.code
            : finding.error_code !== undefined && finding.error_code !== ""
              ? finding.error_code
              : finding.rule;

        const resolvedMessage =
          finding.message !== undefined && finding.message !== ""
            ? finding.message
            : finding.description;

        const failureProof: EmpiricalFailureProof =
          options.failureProof !== undefined
            ? options.failureProof
            : {
                commit_sha: resolvedCommitSha,
                test_assertion: resolvedTestAssertion,
                task_id: resolvedTaskId,
                run_id: options.runId,
                error_code: resolvedErrorCode,
                message: resolvedMessage,
                timestamp: now,
              };

        if (options.requireStrictProof) {
          if (!failureProof.commit_sha) {
            throw new HarnessError(
              "INTEGRITY",
              "Cannot reopen previously completed defect without empirical failure proof (requires commit_sha, test_assertion, task_id)",
            );
          }
          if (failureProof.commit_sha === "empirical-proof-pending") {
            throw new HarnessError(
              "INTEGRITY",
              "Cannot reopen previously completed defect without empirical failure proof (requires commit_sha, test_assertion, task_id)",
            );
          }
          if (!failureProof.test_assertion) {
            throw new HarnessError(
              "INTEGRITY",
              "Cannot reopen previously completed defect without empirical failure proof (requires commit_sha, test_assertion, task_id)",
            );
          }
          if (!failureProof.task_id) {
            throw new HarnessError(
              "INTEGRITY",
              "Cannot reopen previously completed defect without empirical failure proof (requires commit_sha, test_assertion, task_id)",
            );
          }
        }

        const prevCount = existing.count !== undefined ? existing.count : 1;
        const updated: DefectEntry = {
          ...existing,
          status: "open",
          last_seen_at: now,
          count: prevCount + 1,
          reopened_at: now,
          failure_proof: failureProof,
        };
        existingById.set(existing.id, updated);
        if (existing.dedup_key) existingByDedupKey.set(existing.dedup_key, updated);
        reopened += 1;
      } else {
        const prevCount = existing.count !== undefined ? existing.count : 1;
        const updated: DefectEntry = {
          ...existing,
          last_seen_at: now,
          count: prevCount + 1,
        };
        existingById.set(existing.id, updated);
        if (existing.dedup_key) existingByDedupKey.set(existing.dedup_key, updated);
        existingUpdated += 1;
      }
    }
  }

  const updatedEntries = Array.from(existingById.values());

  if (persist) {
    const parentDir = dirname(filePath);
    if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true, mode: 0o700 });
    const serialized = serializeDefectsJsonl(updatedEntries);
    atomicWriteBytes(filePath, Buffer.from(serialized, "utf-8"));
  }

  return {
    totalFindings: findings.length,
    newlyCreated,
    reopened,
    existingUpdated,
    unchanged,
    defects: updatedEntries,
    pushed_count: newlyCreated,
    reopened_count: reopened,
    skipped_count: unchanged,
    total_findings: findings.length,
    defects_file: filePath,
  };
}

export function syncDoctorFindingsToDefects(
  findings: readonly DoctorFindingInput[],
  options: SyncDoctorDefectOptions = {},
): SyncDefectResult {
  const targetPathOption =
    options.customPath !== undefined && options.customPath !== ""
      ? options.customPath
      : options.defectsPath;
  const filePath = resolveDefectsJsonlPath(targetPathOption);
  const now =
    options.timestamp !== undefined && options.timestamp !== ""
      ? options.timestamp
      : new Date().toISOString();

  cleanupVestigialDefectsFile(filePath);

  if (options.dryRun) {
    let existingEntries: DefectEntry[] = [];
    if (existsSync(filePath)) existingEntries = parseDefectsJsonl(readFileSync(filePath, "utf-8"));
    return executeDefectSync(existingEntries, findings, now, options, filePath, false);
  }

  const parentDir = dirname(filePath);
  if (!existsSync(parentDir)) mkdirSync(parentDir, { recursive: true, mode: 0o700 });

  return withDefectLogMutationLock(filePath, () => {
    let existingEntries: DefectEntry[] = [];
    if (existsSync(filePath)) existingEntries = parseDefectsJsonl(readFileSync(filePath, "utf-8"));
    return executeDefectSync(existingEntries, findings, now, options, filePath, true);
  });
}
