import type { AgentRole } from "../core/contracts/packets.ts";
import type { JsonObject } from "../core/contracts/json.ts";
import { trustedHostEvidence, trustedHostLimitations } from "../core/contracts/trusted-host.ts";

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

const investigationReport: JsonObject = {
  summary: "<nonempty summary>",
  requirement_ids: ["<every mapped requirement id exactly once>"],
  sources: ["<repository-relative path actually read>"],
  reproduction: "<the exact command or steps that reproduce the behaviour, or an explicit unknown>",
  checks: [{ command_id: "<read-only diagnostic command id>" }],
  findings: [
    {
      id: "<stable finding id>",
      requirement_id: "<mapped requirement id>",
      severity: "critical|important|minor",
      observation: "<what was observed, never a hypothesis>",
      evidence: [{ path: "<direct evidence path>" }],
      remediation: "<required remediation>",
      revalidation: "<exact revalidation method>",
    },
  ],
  evidence: [{ path: "<durable evidence path>" }],
};

const coordinationRecord: JsonObject = {
  summary: "<nonempty summary>",
  dispatched_agents: ["<agent id registered through agent:register>"],
  waves: [{ wave: "<recorded topology wave>", task_ids: ["<task id dispatched in that wave>"] }],
  checks: [{ command_id: "<mandatory gate command id the coordinator executed>" }],
  evidence: [{ path: "<durable evidence path>" }],
};

const loopSynthesisRecord: JsonObject = {
  summary: "<nonempty summary>",
  dispatched_coordinators: ["<coordinator agent id registered through agent:register>"],
  rounds: [
    {
      round: "<round number>",
      run_id: "<that round's own capsule run id>",
      outcome: "clean_convergence|escalated",
    },
  ],
  checks: [{ command_id: "<run:status or doctor command id inspected>" }],
  evidence: [{ path: "<durable evidence path>" }],
};

const plannerDocuments: JsonObject = {
  requirements_path: "<validated requirements JSON path>",
  graph_path: "<validated graph JSON path>",
  validation: [{ command: ["bun", "<pinned-runtime>", "validate"], status: "passed" }],
};

const planValidatorReview: JsonObject = {
  validator_token: "<host-delivered>",
  graph_revision: "<this packet graph revision>",
  plan_digest: "<this packet plan digest>",
  status: "approved|changes_requested",
  decomposition_answer:
    "<does the decomposition match the work's entity count, or did it compress>",
  dependency_answer: "<is every dependency edge justified by a real read/write relationship>",
  gate_answer: "<can each gate actually fail if its task does nothing>",
  straggler_answer: "<will any task's scope make one agent straggle while the rest idle>",
  dependency_edges_reviewed: [
    {
      from: "<depending task id — exactly every edge the compiled plan declares, or empty if none>",
      to: "<dependency task id>",
    },
  ],
  gate_ids_reviewed: ["<exactly every per-task gate id the compiled plan declares>"],
  findings: [
    {
      id: "<stable finding id>",
      invariant: "<which of the four questions, or audit invariant, this answers>",
      severity: "critical|important|minor",
      observation: "<precise nonempty observation about the plan>",
      remediation: "<what replanning would need to fix>",
    },
  ],
  checks: [{ command_id: "<plan-validator-owned independent command id>" }],
};

const mindRecord: JsonObject = {
  pulse_id: "<pulse id>",
  started_at: "<iso-8601>",
  closed_at: "<iso-8601>",
  outcome: "nominal|quiescent|paused|escalated|halted",
  candidates: [{ id: "<candidate id>" }],
};

const mindAuditorRecord: JsonObject = {
  audit_id: "<audit id>",
  window: "<window start iso-8601>",
  verdict: "approved|changes_requested|halt",
  answers: [
    { question_id: "<q1-q8>", command_id: "<command id>", verdict: "pass|fail|finding|clean" },
  ],
};

const metaAuditorRecord: JsonObject = {
  audit_id: "<audit id>",
  run: "<run slug>",
  wave_index: "<wave index or all>",
  efficiency_score: 100.0,
  heuristics: [
    {
      heuristic:
        "TOKEN_BURNING|FALSE_SERIALIZATION|ROLE_BOUNDARY_DEVIATION|POLLING_WASTE|CONTEXT_OVERFLOW|GHOST_LEASE|STRAGGLER",
      detected: true,
      severity: "low|medium|high|critical",
      details: "<heuristic findings>",
    },
  ],
  remediation_proposals: [{ id: "<proposal id>", title: "<title>", priority: "MEDIUM" }],
};

const mechanicValidatorReview: JsonObject = {
  verdict: "pass|reject",
  requirement_ids: ["<every task requirement id exactly once>"],
  checks: [{ command_id: "<mechanic-validator gate command id>" }],
  gate_receipts: [
    {
      gate_id: "<gate id>",
      command_id: "<executed command id>",
      exit_code: 0,
      duration_ms: "<duration ms>",
      status: "passed|failed",
    },
  ],
  findings: [
    {
      id: "<stable finding id>",
      requirement_id: "<mapped requirement id>",
      severity: "critical|important|minor",
      observation: "<precise nonempty observation>",
      evidence: [{ path: "<direct evidence path or command id>" }],
      remediation: "<required remediation>",
      revalidation: "<exact revalidation method>",
    },
  ],
};

const ROLE_CONTRACTS: Readonly<Record<AgentRole, JsonObject>> = {
  "completeness-critic": criticReview,
  coordinator: coordinationRecord,
  implementer: taskSubmission,
  mind: mindRecord,
  "mind-auditor": mindAuditorRecord,
  "meta-auditor": metaAuditorRecord,
  orchestrator: loopSynthesisRecord,
  "plan-validator": planValidatorReview,
  planner: plannerDocuments,
  repairer: taskSubmission,
  "sub-implementer": taskSubmission,
  "sub-investigator": investigationReport,
  "sub-validator": validatorReview,
  validator: validatorReview,
  "mechanic-validator": mechanicValidatorReview,
};

export function evidenceSchema(role: AgentRole): JsonObject {
  return {
    gate_evidence: trustedHostEvidence(),
    gate_evidence_limitations: trustedHostLimitations(),
    ...structuredClone(ROLE_CONTRACTS[role]),
  };
}
