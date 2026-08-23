import { describe, expect, test } from "bun:test";
import {
  repositoryObservationIssues,
  sameCommandJson,
} from "../../../olt/scripts/src/runner/repository-observation-shape.ts";

function validObservation(): Record<string, unknown> {
  return {
    schema: "harness.repository-binding",
    version: 1,
    inspection_sha256: "a".repeat(64),
    git_identity_sha256: "b".repeat(64),
    content_sha256: "c".repeat(64),
    file_count: 3,
    total_bytes: 128,
  };
}

describe("sameCommandJson", () => {
  test("matches structurally equal values regardless of key order", () => {
    expect(sameCommandJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  test("distinguishes structurally different values", () => {
    expect(sameCommandJson({ a: 1 }, { a: 2 })).toBe(false);
  });

  test("returns false instead of throwing for a value canonicalization cannot serialize", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(sameCommandJson(cyclic, {})).toBe(false);
  });
});

describe("repositoryObservationIssues", () => {
  test("accepts a well-formed observation", () => {
    expect(repositoryObservationIssues(validObservation(), "repository_before")).toEqual([]);
  });

  test("rejects a non-object value", () => {
    expect(repositoryObservationIssues(null, "repository_before")).toEqual([
      "repository_before is missing",
    ]);
    expect(repositoryObservationIssues("nope", "repository_before")).toEqual([
      "repository_before is missing",
    ]);
    expect(repositoryObservationIssues([], "repository_before")).toEqual([
      "repository_before is missing",
    ]);
  });

  test("rejects an observation with an unexpected key set", () => {
    const { schema: _schema, ...missingSchema } = validObservation();
    expect(repositoryObservationIssues(missingSchema, "repository_before")).toEqual([
      "repository_before is invalid",
    ]);
  });

  test("rejects a wrong schema or version", () => {
    expect(
      repositoryObservationIssues({ ...validObservation(), schema: "other" }, "label"),
    ).toEqual(["label is invalid"]);
    expect(repositoryObservationIssues({ ...validObservation(), version: 2 }, "label")).toEqual([
      "label is invalid",
    ]);
  });

  test("rejects malformed sha256 digests", () => {
    for (const field of ["inspection_sha256", "git_identity_sha256", "content_sha256"] as const) {
      expect(
        repositoryObservationIssues({ ...validObservation(), [field]: "not-hex" }, "label"),
      ).toEqual(["label is invalid"]);
    }
  });

  test("rejects negative or non-integer counters", () => {
    expect(repositoryObservationIssues({ ...validObservation(), file_count: -1 }, "label")).toEqual(
      ["label is invalid"],
    );
    expect(
      repositoryObservationIssues({ ...validObservation(), total_bytes: 1.5 }, "label"),
    ).toEqual(["label is invalid"]);
  });
});
