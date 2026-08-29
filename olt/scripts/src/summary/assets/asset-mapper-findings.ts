import type { HarnessEvent, Manifest } from "../../core/contracts/index.ts";
import type { CompletionReview, TaskRecord } from "../../workflow/types.ts";
import { extractFindingScreenshots } from "./asset-mapper-finding-screenshots.ts";
import { isImageExtension } from "./asset-mapper-props.ts";
import { isFindingClass } from "../../workflow/review/finding-class.ts";
import type { FileRef, FindingDetail } from "../types.ts";

export { extractFindingScreenshots };

export interface FindingDetailsOptions {
  completionReview?: CompletionReview | undefined;
  events?: readonly HarnessEvent[] | undefined;
  manifest?: Manifest | undefined;
  runRoot?: string | undefined;
}

function readProof(value: unknown): { method: string; evidence: string[] } | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const proof = value as Record<string, unknown>;
  const evidence: string[] = [];
  for (const entry of Array.isArray(proof.evidence) ? proof.evidence : []) {
    if (typeof entry === "string") {
      evidence.push(entry);
      continue;
    }
    if (typeof entry === "object" && entry !== null && !Array.isArray(entry)) {
      const commandId = (entry as Record<string, unknown>).command_id;
      if (typeof commandId === "string") evidence.push(commandId);
    }
  }
  return { method: typeof proof.method === "string" ? proof.method : "unstated", evidence };
}

export function mapFindingDetails(
  task?: TaskRecord,
  options?: FindingDetailsOptions | undefined,
): FindingDetail[] {
  const findings: FindingDetail[] = [];
  const seenIds = new Set<string>();

  const addFinding = (detail: FindingDetail) => {
    if (!detail.id) return;
    if (seenIds.has(detail.id)) return;
    seenIds.add(detail.id);
    findings.push(detail);
  };

  if (task) {
    const rawReport = task.report as Record<string, unknown> | undefined;
    const taskFindings = [
      ...(task.findings ?? []),
      ...((Array.isArray(rawReport?.findings) ? rawReport.findings : []) as Array<
        Record<string, unknown>
      >),
    ];

    const validatorId =
      task.validations?.[0]?.validator_id ??
      (Array.isArray(task.validation_history) && task.validation_history.length > 0
        ? task.validation_history[task.validation_history.length - 1]?.validator_id
        : undefined);

    for (let i = 0; i < taskFindings.length; i++) {
      const f = taskFindings[i] as Record<string, unknown>;
      const id = typeof f.id === "string" ? f.id : `finding-${task.id}-${i + 1}`;
      const reqId =
        typeof f.requirement_id === "string"
          ? f.requirement_id
          : typeof f.requirementId === "string"
            ? f.requirementId
            : undefined;
      const sevRaw = typeof f.severity === "string" ? f.severity : "important";
      const severity: "critical" | "important" | "suggestion" =
        sevRaw === "critical"
          ? "critical"
          : sevRaw === "minor" || sevRaw === "suggestion"
            ? "suggestion"
            : "important";
      const observation =
        typeof f.observation === "string"
          ? f.observation
          : typeof f.reason === "string"
            ? f.reason
            : typeof f.message === "string"
              ? f.message
              : "The recorded finding states no observation";
      const pushbackReason =
        typeof f.pushback_reason === "string"
          ? f.pushback_reason
          : typeof f.pushbackReason === "string"
            ? f.pushbackReason
            : typeof f.reason === "string"
              ? f.reason
              : observation;
      const remediation =
        typeof f.remediation === "string"
          ? f.remediation
          : typeof f.required_remediation === "string"
            ? f.required_remediation
            : typeof f.requiredRemediation === "string"
              ? f.requiredRemediation
              : undefined;

      const targetFilesRaw = Array.isArray(f.file_paths)
        ? f.file_paths
        : Array.isArray(f.target_files)
          ? f.target_files
          : Array.isArray(f.targetFiles)
            ? f.targetFiles
            : Array.isArray(f.files_changed)
              ? f.files_changed
              : undefined;
      const targetFiles = targetFilesRaw
        ? targetFilesRaw.filter((p): p is string => typeof p === "string")
        : undefined;

      const opposedChanges =
        typeof f.opposed_changes === "string"
          ? f.opposed_changes
          : typeof f.opposedChanges === "string"
            ? f.opposedChanges
            : targetFiles && targetFiles.length > 0
              ? targetFiles.join(", ")
              : undefined;

      const fileRefs: FileRef[] | undefined = targetFiles?.map((path) => ({
        path,
        mode: "write" as const,
      }));

      const findingClass = isFindingClass(f.class) ? f.class : undefined;
      const round =
        typeof f.probe_round === "number"
          ? f.probe_round
          : typeof f.round === "number"
            ? f.round
            : typeof f.rejection_round === "number"
              ? f.rejection_round
              : typeof f.rejectionRound === "number"
                ? f.rejectionRound
                : (task.repair_round ?? 0);

      const author =
        typeof f.author === "string"
          ? f.author
          : typeof f.validator_id === "string"
            ? f.validator_id
            : typeof f.validatorId === "string"
              ? f.validatorId
              : validatorId;

      const timestamp =
        typeof f.timestamp === "string"
          ? f.timestamp
          : typeof f.created_at === "string"
            ? f.created_at
            : typeof f.at === "string"
              ? f.at
              : undefined;

      const status: "open" | "resolved" = f.status === "resolved" ? "resolved" : "open";

      const revalProof =
        readProof(f.revalidation_proof) ??
        readProof(f.revalidationProof) ??
        (typeof f.revalidation === "string" ? { method: f.revalidation, evidence: [] } : undefined);

      const remediationProof = readProof(f.remediation_proof) ?? readProof(f.remediationProof);

      let evidenceList:
        | Array<{
            kind?: string | undefined;
            reference?: string | undefined;
            observation?: string | undefined;
            url?: string | undefined;
          }>
        | undefined = undefined;
      if (Array.isArray(f.evidence)) {
        evidenceList = (f.evidence as unknown[]).map((ev) => {
          if (typeof ev === "string") {
            return {
              kind: isImageExtension(ev) ? "screenshot" : "reference",
              reference: ev,
              url: ev,
            };
          }
          if (typeof ev === "object" && ev !== null) {
            const evObj = ev as Record<string, unknown>;
            return {
              ...(typeof evObj.kind === "string" ? { kind: evObj.kind } : {}),
              ...(typeof evObj.reference === "string" ? { reference: evObj.reference } : {}),
              ...(typeof evObj.observation === "string" ? { observation: evObj.observation } : {}),
              ...(typeof evObj.url === "string" ? { url: evObj.url } : {}),
            };
          }
          return {};
        });
      }

      const extractedScreenshots = extractFindingScreenshots(f, id, author, timestamp);

      addFinding({
        id,
        ...(reqId ? { requirementId: reqId } : {}),
        severity,
        observation,
        ...(findingClass ? { class: findingClass } : {}),
        ...(pushbackReason ? { pushbackReason } : {}),
        ...(opposedChanges ? { opposedChanges } : {}),
        ...(remediation ? { remediation } : {}),
        rejectionRound: round,
        round,
        ...(author ? { author, validatorId: author } : {}),
        ...(timestamp ? { timestamp } : {}),
        status,
        ...(targetFiles ? { targetFiles } : {}),
        ...(fileRefs ? { fileRefs } : {}),
        ...(revalProof ? { revalidationProof: revalProof } : {}),
        ...(remediationProof ? { remediationProof } : {}),
        ...(typeof f.resolved_at === "string" ? { resolvedAt: f.resolved_at } : {}),
        ...(typeof f.resolved_by === "string" ? { resolvedBy: f.resolved_by } : {}),
        ...(evidenceList ? { evidence: evidenceList } : {}),
        ...(extractedScreenshots.length > 0 ? { screenshots: extractedScreenshots } : {}),
      });
    }
  }

  if (options?.completionReview) {
    const cr = options.completionReview;
    for (const cf of cr.findings ?? []) {
      const isUnresolved = cr.unresolved_finding_ids?.includes(cf.id);
      const extractedScreenshots = extractFindingScreenshots(
        cf as Record<string, unknown>,
        cf.id,
        cr.critic_id,
        cr.reviewed_at,
      );

      addFinding({
        id: cf.id,
        ...(cf.requirement_id ? { requirementId: cf.requirement_id } : {}),
        severity:
          cf.severity === "critical"
            ? "critical"
            : cf.severity === "minor"
              ? "suggestion"
              : "important",
        observation: cf.observation,
        pushbackReason: cf.observation,
        ...(cf.remediation ? { remediation: cf.remediation } : {}),
        status: isUnresolved ? "open" : "resolved",
        author: cr.critic_id,
        validatorId: cr.critic_id,
        timestamp: cr.reviewed_at,
        ...(Array.isArray(cf.file_paths)
          ? {
              targetFiles: cf.file_paths,
              fileRefs: cf.file_paths.map((p) => ({ path: p, mode: "write" as const })),
              opposedChanges: cf.file_paths.join(", "),
            }
          : {}),
        ...(typeof cf.revalidation === "string"
          ? {
              revalidationProof: { method: cf.revalidation, evidence: [] },
            }
          : {}),
        ...(extractedScreenshots.length > 0 ? { screenshots: extractedScreenshots } : {}),
      });
    }
  }

  return findings;
}
