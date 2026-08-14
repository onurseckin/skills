import type { AgentRole } from "../contracts/packets.ts";
import type { JsonObject } from "../contracts/json.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../contracts/trusted-host.ts";

const taskSubmission: JsonObject = {
  summary: "<nonempty summary>",
  requirement_ids: ["<every mapped requirement id exactly once>"],
  files_changed: ["<repository-relative path within write scope>"],
  checks: [{ command_id: "<authoritative command id>" }],
  evidence: [{ path: "<durable evidence path>" }],
};

const validatorReview: JsonObject = {
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
};

const criticReview: JsonObject = {
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
};

const plannerDocuments: JsonObject = {
  requirements_path: "<validated requirements JSON path>",
  graph_path: "<validated graph JSON path>",
  validation: [{ command: ["bun", "<pinned-runtime>", "validate"], status: "passed" }],
};

export function evidenceSchema(role: AgentRole): JsonObject {
  const contract =
    role === "validator"
      ? validatorReview
      : role === "completeness-critic"
        ? criticReview
        : role === "planner"
          ? plannerDocuments
          : taskSubmission;
  return {
    gate_evidence: trustedHostEvidence(),
    gate_evidence_limitations: trustedHostLimitations(),
    ...structuredClone(contract),
  };
}
