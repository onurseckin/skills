import { describe, expect, test } from "bun:test";
import { evidenceSchema } from "../../src/packets/evidence-schema.ts";

const gateEvidence = {
  assurance: "trusted_host_observed_v1",
  sandboxed: false,
  trusted_boundary: "local OS user, host-selected toolchain and transitive processes",
};
const gateEvidenceLimitations = [
  "The host or coding application may add a sandbox; the harness neither configures nor attests it.",
  "Same-user mutate, execute, and restore between observations is outside this assurance.",
  "Process ownership signaling remains independently fail-closed.",
];

describe("generated evidence schemas", () => {
  test("matches the task submission runtime contract", () => {
    const expected = {
      gate_evidence: gateEvidence,
      gate_evidence_limitations: gateEvidenceLimitations,
      summary: "<nonempty summary>",
      requirement_ids: ["<every mapped requirement id exactly once>"],
      files_changed: ["<repository-relative path within write scope>"],
      checks: [{ command_id: "<authoritative command id>" }],
      evidence: [{ path: "<durable evidence path>" }],
    };
    expect(evidenceSchema("implementer")).toEqual(expected);
    expect(evidenceSchema("repairer")).toEqual(expected);
  });

  test("matches the validator review runtime contract without a token field", () => {
    expect(evidenceSchema("validator")).toEqual({
      gate_evidence: gateEvidence,
      gate_evidence_limitations: gateEvidenceLimitations,
      verdict: "pass|reject",
      requirement_ids: ["<every task requirement id exactly once>"],
      checks: [{ command_id: "<independent validator command id>" }],
      findings: [
        {
          id: "<stable finding id>",
          requirement_id: "<mapped requirement id>",
          severity: "critical|important|minor",
          observation: "<precise nonempty observation>",
          evidence: [{ path: "<direct evidence path>" }],
          remediation: "<required remediation>",
          revalidation: "<exact revalidation method>",
        },
      ],
      resolved_findings: [
        {
          finding_id: "<open finding id>",
          method: "<revalidation method>",
          evidence: [{ command_id: "<fresh validator command id>" }],
        },
      ],
    });
    expect(JSON.stringify(evidenceSchema("validator"))).not.toContain("token");
  });

  test("matches the completeness review contract using only a host-delivery marker", () => {
    const schema = evidenceSchema("completeness-critic");
    expect(schema).toEqual({
      gate_evidence: gateEvidence,
      gate_evidence_limitations: gateEvidenceLimitations,
      packet_id: "<this packet id>",
      critic_token: "<host-delivered>",
      packet_sha256: "<this packet sha256>",
      readiness_sha256: "<this packet readiness sha256>",
      repository_binding: {
        schema: "harness.repository-binding",
        version: 1,
        inspection_sha256: "<this packet repository inspection sha256>",
        git_identity_sha256: "<this packet repository Git identity sha256>",
        content_sha256: "<this packet repository content sha256>",
        file_count: "<this packet repository file count>",
        total_bytes: "<this packet repository total bytes>",
      },
      graph_revision: "<this packet graph revision>",
      status: "clean|findings",
      unresolved_finding_ids: ["<exactly every findings[].id>"],
      integrity_evidence: [{ status: "passed", issues: [] }],
      repository_command_ids: ["<packet-bound repository command id>"],
      checks: [{ command_id: "<critic-owned independent command id>" }],
      requirement_proofs: [
        {
          requirement_id: "<every authoritative requirement id exactly once>",
          status: "satisfied|out_of_scope",
          evidence: [
            {
              kind: "command|artifact|state",
              reference: "<authoritative evidence reference>",
              observation: "<what the evidence proves>",
            },
          ],
        },
      ],
      findings: [
        {
          id: "<stable finding id>",
          requirement_id: "<mapped requirement id>",
          severity: "critical|important|minor",
          observation: "<precise nonempty observation>",
          evidence: [{ path: "<direct evidence path>" }],
          remediation: "<required remediation>",
          revalidation: "<exact revalidation method>",
        },
      ],
      residual_risks: [
        {
          id: "<stable risk id>",
          severity: "critical|important|minor",
          description: "<risk description>",
          disposition: "accepted",
          rationale: "<why the residual risk is accepted>",
          evidence: [{ reference: "<supporting evidence>" }],
        },
      ],
    });
  });
});
