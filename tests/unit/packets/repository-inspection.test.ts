import { describe, expect, test } from "bun:test";
import type { RunState } from "../../../olt/scripts/src/core/contracts/capsule.ts";
import {
  repositoryBindingFromInspection,
  repositoryInspectionContext,
  repositoryInspectionDigest,
  validateRepositoryInspectionPair,
  type RepositoryInspection,
} from "../../../olt/scripts/src/packets/repository-inspection.ts";

function baseInspection(): RepositoryInspection {
  return {
    schema: "harness.repository-inspection",
    version: 3,
    phase: "baseline",
    captured_at: "2026-08-14T00:00:00.000Z",
    repository_root: "/tmp/fake-repo",
    repository_identity_sha256: "0".repeat(64),
    repository_git_identity_sha256: "1".repeat(64),
    repository_content_sha256: "2".repeat(64),
    repository_file_count: 0,
    repository_total_bytes: 0,
    inspection_sha256: "unset",
  };
}

describe("repositoryInspectionContext integrity checks", () => {
  test("rejects an inspection whose recorded digest does not match its own content", () => {
    const inspection = baseInspection();
    inspection.inspection_sha256 = "not-the-real-digest";
    const state = {
      baseline_repository_inspection_sha256: inspection.inspection_sha256,
      repository_inspections: { [inspection.inspection_sha256]: inspection },
      baseline_repository_binding: repositoryBindingFromInspection(inspection),
    } as unknown as RunState;

    expect(() => repositoryInspectionContext(state, false)).toThrow(
      "baseline repository inspection digest differs",
    );
  });

  test("rejects when the state's recorded binding disagrees with the inspection it references", () => {
    const inspection = baseInspection();
    inspection.inspection_sha256 = repositoryInspectionDigest(inspection);
    const state = {
      baseline_repository_inspection_sha256: inspection.inspection_sha256,
      repository_inspections: { [inspection.inspection_sha256]: inspection },
      baseline_repository_binding: {
        ...repositoryBindingFromInspection(inspection),
        content_sha256: "f".repeat(64), // deliberately disagrees with the inspection above
      },
    } as unknown as RunState;

    expect(() => repositoryInspectionContext(state, false)).toThrow(
      "baseline repository binding differs",
    );
  });

  test("rejects a structurally invalid inspection record", () => {
    const inspection = baseInspection();
    inspection.repository_file_count = -1; // negative counts are structurally invalid
    inspection.inspection_sha256 = repositoryInspectionDigest(inspection);
    const state = {
      baseline_repository_inspection_sha256: inspection.inspection_sha256,
      repository_inspections: { [inspection.inspection_sha256]: inspection },
      baseline_repository_binding: repositoryBindingFromInspection(inspection),
    } as unknown as RunState;

    expect(() => repositoryInspectionContext(state, false)).toThrow(
      "baseline repository inspection is invalid",
    );
  });

  test("accepts a self-consistent inspection and binding pair", () => {
    const inspection = baseInspection();
    inspection.inspection_sha256 = repositoryInspectionDigest(inspection);
    const state = {
      baseline_repository_inspection_sha256: inspection.inspection_sha256,
      repository_inspections: { [inspection.inspection_sha256]: inspection },
      baseline_repository_binding: repositoryBindingFromInspection(inspection),
    } as unknown as RunState;

    const context = repositoryInspectionContext(state, false);
    expect(context.baseline_repository_state.inspection_sha256).toBe(inspection.inspection_sha256);
    // requireCurrent=false: current mirrors baseline rather than requiring its own record.
    expect(context.current_repository_state).toEqual(context.baseline_repository_state);
  });
});

describe("validateRepositoryInspectionPair", () => {
  test("validates a context carrying both a baseline and a current inspection", () => {
    const inspection = baseInspection();
    inspection.inspection_sha256 = repositoryInspectionDigest(inspection);
    const current = { ...inspection, phase: "current" as const };
    current.inspection_sha256 = repositoryInspectionDigest(current);

    const pair = validateRepositoryInspectionPair({
      baseline_repository_state: inspection,
      current_repository_state: current,
    });
    expect(pair.baseline_repository_state.phase).toBe("baseline");
    expect(pair.current_repository_state.phase).toBe("current");
  });

  test("rejects a context missing a current inspection", () => {
    const inspection = baseInspection();
    inspection.inspection_sha256 = repositoryInspectionDigest(inspection);
    expect(() =>
      validateRepositoryInspectionPair({ baseline_repository_state: inspection }),
    ).toThrow("current repository inspection is missing");
  });
});
