import { describe, expect, test } from "bun:test";
import { parseRawProofs } from "../../../olt/scripts/src/workflow/completion/parse-raw-proofs.ts";

describe("parseRawProofs", () => {
  test("returns an empty list when neither inline text nor a file is supplied", () => {
    expect(parseRawProofs(undefined, undefined)).toEqual([]);
    expect(parseRawProofs("   ", undefined)).toEqual([]);
  });

  test("throws INVALID_ARGUMENT when the proofs file cannot be read", () => {
    expect(() => parseRawProofs(undefined, "/nonexistent/proofs.json")).toThrow(
      /cannot read proofs file: \/nonexistent\/proofs\.json/,
    );
  });

  test("throws INVALID_ARGUMENT when the inline payload is not valid JSON", () => {
    expect(() => parseRawProofs("{not json", undefined)).toThrow(
      /requirement proofs must be valid JSON/,
    );
  });

  test("throws INVALID_ARGUMENT when the payload is a non-array, non-object JSON value", () => {
    expect(() => parseRawProofs("42", undefined)).toThrow(/requirement proofs must be an object/);
  });

  test("throws INVALID_ARGUMENT when the payload is an object but lacks a requirement_proofs array", () => {
    expect(() => parseRawProofs(JSON.stringify({ other: "shape" }), undefined)).toThrow(
      /requirement proofs must be an array or an object with requirement_proofs/,
    );
  });

  test("reads a bare JSON array of proofs", () => {
    const proofs = parseRawProofs(
      JSON.stringify([
        {
          requirement_id: "R-1",
          status: "satisfied",
          evidence: [{ kind: "command", reference: "C-1", observation: "verified" }],
        },
      ]),
      undefined,
    );
    expect(proofs).toHaveLength(1);
    expect(proofs[0]).toEqual({
      requirement_id: "R-1",
      status: "satisfied",
      evidence: [{ kind: "command", reference: "C-1", observation: "verified" }],
    });
  });

  test("reads proofs nested under a { requirement_proofs: [...] } wrapper object", () => {
    const proofs = parseRawProofs(
      JSON.stringify({
        requirement_proofs: [
          {
            requirement_id: "R-1",
            status: "out_of_scope",
            evidence: [{ kind: "state", reference: "state-ref", observation: "not applicable" }],
          },
        ],
      }),
      undefined,
    );
    expect(proofs).toHaveLength(1);
    expect(proofs[0]!.status).toBe("out_of_scope");
  });

  test("rejects a missing or unrecognised proof status", () => {
    expect(() =>
      parseRawProofs(
        JSON.stringify([{ requirement_id: "R-1", status: "unproven", evidence: [] }]),
        undefined,
      ),
    ).toThrow(/requirement proof R-1 needs an explicit satisfied or out_of_scope status/);
  });

  test("rejects a proof with no evidence items", () => {
    expect(() =>
      parseRawProofs(
        JSON.stringify([{ requirement_id: "R-1", status: "satisfied", evidence: [] }]),
        undefined,
      ),
    ).toThrow(/requirement proof R-1 must carry at least one evidence item/);
  });

  test("rejects an evidence item with an unrecognised kind", () => {
    expect(() =>
      parseRawProofs(
        JSON.stringify([
          {
            requirement_id: "R-1",
            status: "satisfied",
            evidence: [{ kind: "bogus", reference: "C-1", observation: "x" }],
          },
        ]),
        undefined,
      ),
    ).toThrow(/requirement proof R-1 evidence kind must be command, artifact or state/);
  });

  test("rejects an evidence item missing its reference or observation", () => {
    expect(() =>
      parseRawProofs(
        JSON.stringify([
          { requirement_id: "R-1", status: "satisfied", evidence: [{ kind: "artifact" }] },
        ]),
        undefined,
      ),
    ).toThrow();
  });

  test("rejects a proof entry that is not an object", () => {
    expect(() => parseRawProofs(JSON.stringify(["not-an-object"]), undefined)).toThrow(
      /requirement proof must be an object/,
    );
  });
});
