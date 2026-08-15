import { readFileSync } from "node:fs";
import { HarnessError } from "../../errors/harness-error.ts";
import type { CompletionFinding } from "./types.ts";

export function parseRawFindings(
  findingsRaw: string | undefined,
  findingsFile: string | undefined,
  firstReqId: string,
  defaultSummary: string,
): CompletionFinding[] {
  let content = findingsRaw;
  if (!content && findingsFile) {
    try {
      content = readFileSync(findingsFile, "utf-8");
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `cannot read findings file: ${findingsFile}`);
    }
  }
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    const list = Array.isArray(parsed)
      ? parsed
      : typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray((parsed as Record<string, unknown>).findings)
        ? ((parsed as Record<string, unknown>).findings as unknown[])
        : [parsed];

    return list.map((item: unknown, idx: number) => {
      const rec = (typeof item === "object" && item !== null ? item : {}) as Record<
        string,
        unknown
      >;
      const id =
        typeof rec.id === "string" && rec.id.trim()
          ? rec.id.trim()
          : `finding-critic-${String(idx + 1).padStart(2, "0")}`;
      const requirementId =
        typeof rec.requirement_id === "string" && rec.requirement_id.trim()
          ? rec.requirement_id.trim()
          : firstReqId;
      const severity = (
        rec.severity === "critical" || rec.severity === "minor" ? rec.severity : "important"
      ) as CompletionFinding["severity"];
      const observation =
        typeof rec.observation === "string"
          ? rec.observation
          : String(rec.finding ?? rec.message ?? defaultSummary);
      const remediation =
        typeof rec.remediation === "string"
          ? rec.remediation
          : "Address identified gap prior to completion.";
      const revalidation =
        typeof rec.revalidation === "string" ? rec.revalidation : "Re-run full verification gate.";
      const filePaths = Array.isArray(rec.file_paths)
        ? rec.file_paths.map(String)
        : typeof rec.file_path === "string"
          ? [rec.file_path]
          : typeof rec.path === "string"
            ? [rec.path]
            : undefined;

      return {
        id,
        requirement_id: requirementId,
        severity,
        observation,
        ...(filePaths ? { file_paths: filePaths } : {}),
        evidence: [{ kind: "state", reference: requirementId, observation }],
        remediation,
        revalidation,
      };
    });
  } catch {
    return [
      {
        id: "finding-critic-01",
        requirement_id: firstReqId,
        severity: "important",
        observation: content.trim() || defaultSummary,
        evidence: [
          { kind: "state", reference: firstReqId, observation: content.trim() || defaultSummary },
        ],
        remediation: "Address identified gap prior to completion.",
        revalidation: "Re-run full verification gate.",
      },
    ];
  }
}
