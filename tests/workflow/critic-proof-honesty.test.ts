import { describe, expect, test } from "bun:test";
import { beginCompletenessCritic } from "../../olt/scripts/src/workflow/completion/begin-completeness-critic.ts";
import { parseRawProofs } from "../../olt/scripts/src/workflow/completion/parse-raw-proofs.ts";
import { recordCompletionReview } from "../../olt/scripts/src/workflow/completion/record-completion-review.ts";
import { completionReviewIssues } from "../../olt/scripts/src/workflow/completion/review-issues.ts";
import { parseCompletionAssessment } from "../../olt/scripts/src/workflow/completion/review-input.ts";
import {
  at,
  commandRecord,
  repositoryBinding,
  TEST_GATE_ARGV,
  TestPort,
  workflowState,
} from "./test-port.ts";
import { criticIntegrityDigest } from "../../olt/scripts/src/packets/critic-integrity-digest.ts";

const clock = at("2026-08-13T12:00:00.000Z");
const integrity = [{ status: "passed", event_head: "head" }];
const integritySha = criticIntegrityDigest(integrity);
const verifyRepository = () => structuredClone(repositoryBinding);

function reviewPort() {
  const state = workflowState();
  Object.assign(state.tasks["T-1"]!, {
    status: "done",
    report: { summary: "done" },
    validations: [
      {
        validator_id: "validator",
        domain: "code-quality",
        token_digest: "digest",
        attempt: 1,
        started_at: clock.now().toISOString(),
        deadline_at: "2026-08-13T13:00:00.000Z",
        verdict: "pass",
        reviewed_requirement_ids: ["R-1"],
        checks: [{ command_id: "C-V" }],
      },
    ],
    gate_results: [{ gate_id: "G-1", command_id: "C-T", status: "passed" }],
  });
  state.requirements[0] = {
    id: "R-1",
    status: "satisfied",
    disposition: "actionable",
    evidence: ["task:T-1"],
  };
  state.requirements.push({
    id: "R-2",
    status: "satisfied",
    disposition: "actionable",
    evidence: ["task:T-1"],
  });
  state.gates.push({
    id: "G-RUN",
    command: TEST_GATE_ARGV,
    cwd: ".",
    scope: "run",
    requirement_ids: [],
    mandatory: true,
  });
  state.commands["C-T"] = commandRecord("C-T", { gate_id: "G-1" });
  state.commands["C-V"] = commandRecord("C-V");
  state.commands["C-RUN"] = commandRecord("C-RUN", {
    argv: TEST_GATE_ARGV,
    task_id: null,
    gate_id: "G-RUN",
    actor: "coordinator",
  });
  const port = new TestPort(state);
  const assigned = beginCompletenessCritic(port, "critic", { clock });
  port.transact("critic", "publish", {}, (draft) => {
    draft.commands["C-CHECK"] = commandRecord("C-CHECK", { task_id: null, actor: "critic" });
    const authority = draft.completion_critic!;
    draft.packets = {
      "critic-1": {
        id: "critic-1",
        status: "published",
        role: "completeness-critic",
        agent_id: "critic",
        task_id: null,
        attempt: 1,
        graph_revision: 1,
        markdown_path: "packets/critic-1/packet.md",
        metadata_path: "packets/critic-1/metadata.json",
        packet_sha256: "a".repeat(64),
        readiness_sha256: authority.readiness_sha256,
        repository_binding: structuredClone(repositoryBinding),
        repository_command_ids: ["C-RUN"],
        integrity_evidence_sha256: integritySha,
        published_at: clock.now().toISOString(),
      },
    };
    authority.status = "packet_published";
    authority.packet_id = "critic-1";
    Object.assign(draft.completion_critic_history![0]!, authority);
  });
  return { port, token: assigned.token };
}

function proof(requirementId: string) {
  return {
    requirement_id: requirementId,
    status: "satisfied",
    evidence: [{ kind: "command", reference: "C-CHECK", observation: "verified independently" }],
  };
}

function reviewInput(
  port: TestPort,
  token: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    packet_id: "critic-1",
    critic_token: token,
    packet_sha256: "a".repeat(64),
    graph_revision: 1,
    readiness_sha256: port.read().completion_critic!.readiness_sha256,
    repository_binding: structuredClone(repositoryBinding),
    summary: "whole diff verified against the run gate",
    status: "clean",
    unresolved_finding_ids: [],
    findings: [],
    integrity_evidence: integrity,
    repository_command_ids: ["C-RUN"],
    checks: [{ command_id: "C-CHECK" }],
    requirement_proofs: [proof("R-1"), proof("R-2")],
    residual_risks: [],
    ...overrides,
  };
}

describe("critic requirement proofs", () => {
  test("a requirement the critic never proved is recorded unproven", () => {
    const { port } = reviewPort();
    const assessment = parseCompletionAssessment(port.read(), {
      findings: [],
      unresolved_finding_ids: [],
      status: "clean",
      requirement_proofs: [proof("R-1")],
      residual_risks: [],
    });

    expect(assessment.requirement_proofs).toEqual([
      { requirement_id: "R-1", status: "satisfied", evidence: [proof("R-1").evidence[0]!] },
      { requirement_id: "R-2", status: "unproven", evidence: [] },
    ]);
  });

  test("a clean verdict cannot be recorded while a requirement is unproven", () => {
    const { port, token } = reviewPort();
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        reviewInput(port, token, { requirement_proofs: [proof("R-1")] }),
        verifyRepository,
        clock,
      ),
    ).toThrow("clean completion review leaves requirements unproven: R-2");
  });

  test("unproven requirements survive into the review and block completion", () => {
    const { port, token } = reviewPort();
    const finding = {
      id: "F-1",
      requirement_id: "R-2",
      severity: "important",
      observation: "no proof was produced",
      evidence: [{ kind: "state", reference: "R-2" }],
      remediation: "produce the proof",
      revalidation: "re-run the critic",
    };
    const state = recordCompletionReview(
      port,
      "critic",
      reviewInput(port, token, {
        status: "findings",
        findings: [finding],
        unresolved_finding_ids: ["F-1"],
        requirement_proofs: [proof("R-1")],
      }),
      verifyRepository,
      clock,
    );

    const recorded = state.completion_review!;
    expect(recorded.requirement_proofs.find((p) => p.requirement_id === "R-2")?.status).toBe(
      "unproven",
    );
    expect(completionReviewIssues(state, recorded)).toContain(
      "completion requirement is unproven: R-2",
    );
  });

  test("a fully proved clean review records no packet digest guess", () => {
    const { port, token } = reviewPort();
    const state = recordCompletionReview(
      port,
      "critic",
      reviewInput(port, token),
      verifyRepository,
      clock,
    );
    expect(state.completion_review!.packet_sha256).toBe("a".repeat(64));
    expect(
      completionReviewIssues(state, state.completion_review!).filter((issue) =>
        issue.includes("unproven"),
      ),
    ).toEqual([]);
  });

  test("a review without a packet omits packet_sha256 rather than blanking it", () => {
    const { port, token } = reviewPort();
    const input = reviewInput(port, token, { packet_id: "direct" });
    delete input.packet_sha256;
    const state = recordCompletionReview(port, "critic", input, verifyRepository, clock);
    expect("packet_sha256" in state.completion_review!).toBeFalse();
  });

  test("a blank packet digest is refused outright", () => {
    const { port, token } = reviewPort();
    expect(() =>
      recordCompletionReview(
        port,
        "critic",
        reviewInput(port, token, { packet_id: "direct", packet_sha256: "" }),
        verifyRepository,
        clock,
      ),
    ).toThrow("packet_sha256 must be a sha256 digest when present");
  });
});

describe("critic proof parsing", () => {
  test("returns nothing when the critic supplied nothing", () => {
    expect(parseRawProofs(undefined, undefined)).toEqual([]);
  });

  test("keeps the supplied proofs", () => {
    expect(parseRawProofs(JSON.stringify([proof("R-1")]), undefined)).toEqual([
      {
        requirement_id: "R-1",
        status: "satisfied",
        evidence: [
          { kind: "command", reference: "C-CHECK", observation: "verified independently" },
        ],
      },
    ]);
  });

  test("refuses a proof with no explicit status", () => {
    expect(() =>
      parseRawProofs(JSON.stringify([{ requirement_id: "R-1", evidence: [] }]), undefined),
    ).toThrow("needs an explicit satisfied or out_of_scope status");
  });

  test("refuses a proof with no evidence", () => {
    expect(() =>
      parseRawProofs(
        JSON.stringify([{ requirement_id: "R-1", status: "satisfied", evidence: [] }]),
        undefined,
      ),
    ).toThrow("must carry at least one evidence item");
  });

  test("refuses malformed JSON instead of guessing a proof", () => {
    expect(() => parseRawProofs("not json", undefined)).toThrow(
      "requirement proofs must be valid JSON",
    );
  });
});
