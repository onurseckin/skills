import { dirname } from "node:path";
import type { RunState } from "../contracts/capsule.ts";
import type { JsonObject } from "../contracts/json.ts";
import type { RepositoryBinding } from "../contracts/repository.ts";
import { canonicalJsonBytes, sha256Bytes } from "../core/json.ts";
import { HarnessError } from "../errors/harness-error.ts";
import { loadRun, transact } from "../store/index.ts";
import { requireText } from "../workflow/task-state.ts";
import { inspectRepository } from "./repository-snapshot.ts";

export type InspectionPhase = "baseline" | "current";
export type RepositoryInspection = JsonObject & {
  schema: "harness.repository-inspection";
  version: 3;
  phase: InspectionPhase;
  captured_at: string;
  repository_root: string;
  repository_identity_sha256: string;
  repository_git_identity_sha256: string;
  repository_content_sha256: string;
  repository_file_count: number;
  repository_total_bytes: number;
  inspection_sha256: string;
};

export function repositoryInspectionDigest(value: JsonObject): string {
  const { inspection_sha256: _digest, ...content } = value;
  return sha256Bytes(canonicalJsonBytes(content));
}

function validInspection(value: unknown, phase: InspectionPhase): RepositoryInspection {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new HarnessError("INTEGRITY", `${phase} repository inspection is missing`);
  const inspection = value as RepositoryInspection;
  if (
    inspection.schema !== "harness.repository-inspection" ||
    inspection.version !== 3 ||
    inspection.phase !== phase ||
    !Number.isFinite(Date.parse(inspection.captured_at)) ||
    typeof inspection.repository_root !== "string" ||
    inspection.repository_root === "" ||
    !/^[0-9a-f]{64}$/u.test(inspection.repository_identity_sha256) ||
    !/^[0-9a-f]{64}$/u.test(inspection.repository_git_identity_sha256) ||
    !/^[0-9a-f]{64}$/u.test(inspection.repository_content_sha256) ||
    !Number.isSafeInteger(inspection.repository_file_count) ||
    inspection.repository_file_count < 0 ||
    !Number.isSafeInteger(inspection.repository_total_bytes) ||
    inspection.repository_total_bytes < 0 ||
    typeof inspection.inspection_sha256 !== "string"
  ) {
    throw new HarnessError("INTEGRITY", `${phase} repository inspection is invalid`);
  }
  if (repositoryInspectionDigest(inspection) !== inspection.inspection_sha256)
    throw new HarnessError("INTEGRITY", `${phase} repository inspection digest differs`);
  return structuredClone(inspection);
}

export function repositoryBindingFromInspection(
  inspection: RepositoryInspection,
): RepositoryBinding {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: inspection.repository_identity_sha256,
    git_identity_sha256: inspection.repository_git_identity_sha256,
    content_sha256: inspection.repository_content_sha256,
    file_count: inspection.repository_file_count,
    total_bytes: inspection.repository_total_bytes,
  };
}

function reference(state: RunState, phase: InspectionPhase): string {
  const value = state[`${phase}_repository_inspection_sha256`];
  if (typeof value !== "string" || value === "")
    throw new HarnessError("INVALID_STATE", `${phase} repository inspection is missing`);
  return value;
}

function fromState(state: RunState, phase: InspectionPhase): RepositoryInspection {
  const digest = reference(state, phase);
  const records = state.repository_inspections;
  if (typeof records !== "object" || records === null || Array.isArray(records))
    throw new HarnessError("INTEGRITY", "repository inspection registry is missing");
  const inspection = validInspection(records[digest], phase);
  if (inspection.inspection_sha256 !== digest)
    throw new HarnessError("INTEGRITY", `${phase} repository inspection reference differs`);
  const binding = state[`${phase}_repository_binding`];
  if (
    typeof binding !== "object" ||
    binding === null ||
    Array.isArray(binding) ||
    !Buffer.from(canonicalJsonBytes(binding as JsonObject)).equals(
      Buffer.from(canonicalJsonBytes(repositoryBindingFromInspection(inspection))),
    )
  ) {
    throw new HarnessError("INTEGRITY", `${phase} repository binding differs`);
  }
  return inspection;
}

export function repositoryInspectionContext(state: RunState, requireCurrent: boolean) {
  const baseline = fromState(state, "baseline");
  const current = requireCurrent ? fromState(state, "current") : baseline;
  return { baseline_repository_state: baseline, current_repository_state: current };
}

export function validateRepositoryInspectionPair(context: JsonObject) {
  return {
    baseline_repository_state: validInspection(context.baseline_repository_state, "baseline"),
    current_repository_state: validInspection(context.current_repository_state, "current"),
  };
}

export function recordRepositoryInspection(
  runRoot: string,
  actor: string,
  phase: InspectionPhase,
  now = new Date(),
): RepositoryInspection {
  actor = requireText(actor, "actor");
  if (phase !== "baseline" && phase !== "current")
    throw new HarnessError("INVALID_ARGUMENT", "inspection phase must be baseline or current");
  const loaded = loadRun(runRoot);
  if (phase === "baseline") {
    try {
      return fromState(loaded.state, phase);
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== "INVALID_STATE") throw error;
    }
  }
  const repo = dirname(dirname(loaded.runRoot));
  const content = inspectRepository(repo, phase, now) as JsonObject;
  const inspection = {
    ...content,
    inspection_sha256: repositoryInspectionDigest(content),
  } as RepositoryInspection;
  if (phase === "baseline") {
    try {
      return fromState(loaded.state, "baseline");
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== "INVALID_STATE") throw error;
    }
  }
  if (phase === "current") {
    try {
      const previous = fromState(loaded.state, "current");
      if (
        previous.repository_identity_sha256 === inspection.repository_identity_sha256 &&
        previous.repository_git_identity_sha256 === inspection.repository_git_identity_sha256 &&
        previous.repository_content_sha256 === inspection.repository_content_sha256 &&
        previous.repository_file_count === inspection.repository_file_count &&
        previous.repository_total_bytes === inspection.repository_total_bytes
      ) {
        return previous;
      }
    } catch (error) {
      if (!(error instanceof HarnessError) || error.code !== "INVALID_STATE") throw error;
    }
  }
  transact(
    loaded.runRoot,
    actor,
    "repository-inspected",
    { phase, inspection_sha256: inspection.inspection_sha256 },
    (draft) => {
      if (phase === "baseline" && draft.baseline_repository_inspection_sha256 !== undefined)
        throw new HarnessError("INVALID_STATE", "baseline repository inspection already exists");
      const records = (draft.repository_inspections ?? {}) as JsonObject;
      records[inspection.inspection_sha256] = inspection;
      draft.repository_inspections = records;
      draft[`${phase}_repository_inspection_sha256`] = inspection.inspection_sha256;
      draft[`${phase}_repository_binding`] = repositoryBindingFromInspection(inspection);
    },
  );
  return inspection;
}
