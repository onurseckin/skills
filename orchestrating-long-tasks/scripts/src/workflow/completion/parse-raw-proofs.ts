import { readFileSync } from "node:fs";
import { HarnessError } from "../../errors/harness-error.ts";
import { requireText } from "../task-state.ts";
import type { CompletionEvidenceItem, CompletionRequirementProof } from "./types.ts";

const PROOF_STATUSES = new Set(["satisfied", "out_of_scope"]);
const EVIDENCE_KINDS = new Set(["command", "artifact", "state"]);

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INVALID_ARGUMENT", `${label} must be an object`);
  return value as Record<string, unknown>;
}

function evidenceItems(value: unknown, requirementId: string): CompletionEvidenceItem[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new HarnessError(
      "INVALID_ARGUMENT",
      `requirement proof ${requirementId} must carry at least one evidence item`,
    );
  return value.map((raw) => {
    const item = record(raw, `requirement proof ${requirementId} evidence`);
    if (!EVIDENCE_KINDS.has(String(item.kind)))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `requirement proof ${requirementId} evidence kind must be command, artifact or state`,
      );
    return {
      kind: item.kind as CompletionEvidenceItem["kind"],
      reference: requireText(item.reference, `proof ${requirementId} evidence reference`),
      observation: requireText(item.observation, `proof ${requirementId} evidence observation`),
    };
  });
}

/**
 * Parses critic-supplied requirement proofs. Nothing is defaulted: a malformed payload is an error
 * rather than a proof, because the alternative is a sign-off the critic never wrote. Returns the
 * proofs the critic actually supplied; requirements it left out stay absent and are recorded
 * `unproven` downstream.
 */
export function parseRawProofs(
  proofsRaw: string | undefined,
  proofsFile: string | undefined,
): CompletionRequirementProof[] {
  let content = proofsRaw;
  if (content === undefined && proofsFile !== undefined) {
    try {
      content = readFileSync(proofsFile, "utf-8");
    } catch {
      throw new HarnessError("INVALID_ARGUMENT", `cannot read proofs file: ${proofsFile}`);
    }
  }
  if (content === undefined || content.trim() === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(content) as unknown;
  } catch {
    throw new HarnessError("INVALID_ARGUMENT", "requirement proofs must be valid JSON");
  }
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(record(parsed, "requirement proofs").requirement_proofs)
      ? (parsed as { requirement_proofs: unknown[] }).requirement_proofs
      : undefined;
  if (!list)
    throw new HarnessError(
      "INVALID_ARGUMENT",
      "requirement proofs must be an array or an object with requirement_proofs",
    );

  return list.map((raw) => {
    const proof = record(raw, "requirement proof");
    const requirementId = requireText(proof.requirement_id, "requirement_proof.requirement_id");
    if (!PROOF_STATUSES.has(String(proof.status)))
      throw new HarnessError(
        "INVALID_ARGUMENT",
        `requirement proof ${requirementId} needs an explicit satisfied or out_of_scope status`,
      );
    return {
      requirement_id: requirementId,
      status: proof.status as CompletionRequirementProof["status"],
      evidence: evidenceItems(proof.evidence, requirementId),
    };
  });
}
