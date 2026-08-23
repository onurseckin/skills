import { readFileSync } from "node:fs";
import { HarnessError } from "../../core/errors/harness-error.ts";
import { isJsonObject, type JsonObject } from "../../core/contracts/json.ts";
import type { CompletionFinding } from "./types.ts";

const SEVERITIES = new Set(["critical", "important", "minor"]);

function text(record: Record<string, unknown>, field: string, findingRef: string): string {
  const value = record[field];
  if (typeof value !== "string" || value.trim() === "") {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `completion finding ${findingRef} must carry a nonempty ${field}`,
    );
  }
  return value.trim();
}

function findingList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (typeof parsed === "object" && parsed !== null) {
    const nested = (parsed as Record<string, unknown>).findings;
    if (Array.isArray(nested)) return nested;
    return [parsed];
  }
  throw new HarnessError("INVALID_ARGUMENT", "findings payload must be a JSON object or array");
}

function suppliedEvidence(record: Record<string, unknown>): JsonObject[] | undefined {
  const raw = record.evidence;
  if (!Array.isArray(raw)) return undefined;
  const entries = raw.filter(isJsonObject);
  return entries.length > 0 ? entries : undefined;
}

function filePaths(record: Record<string, unknown>): string[] | undefined {
  const raw = record.file_paths;
  if (!Array.isArray(raw)) return undefined;
  const paths = raw.filter((entry): entry is string => typeof entry === "string" && !!entry.trim());
  return paths.length > 0 ? paths.map((entry) => entry.trim()) : undefined;
}

export function parseRawFindings(
  findingsRaw: string | undefined,
  findingsFile: string | undefined,
): CompletionFinding[] {
  let content = findingsRaw;
  if (!content && findingsFile) {
    try {
      content = readFileSync(findingsFile, "utf-8");
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `cannot read findings file: ${findingsFile}`);
    }
  }
  if (!content || content.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "findings payload is not valid JSON; pass a JSON array of structured findings",
    );
  }

  return findingList(parsed).map((item, index) => {
    const reference = `#${index + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `completion finding ${reference} must be an object`,
      );
    }
    const record = item as Record<string, unknown>;
    const id = text(record, "id", reference);
    const severity = record.severity;
    if (typeof severity !== "string" || !SEVERITIES.has(severity)) {
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `completion finding ${id} must declare severity critical, important or minor`,
      );
    }
    const requirementId = text(record, "requirement_id", id);
    const observation = text(record, "observation", id);
    const paths = filePaths(record);
    return {
      id,
      requirement_id: requirementId,
      severity: severity as CompletionFinding["severity"],
      observation,
      ...(paths ? { file_paths: paths } : {}),
      evidence: suppliedEvidence(record) ?? [
        { kind: "critic_assertion", evidence_class: "agent_reported", observation },
      ],
      remediation: text(record, "remediation", id),
      revalidation: text(record, "revalidation", id),
    };
  });
}
