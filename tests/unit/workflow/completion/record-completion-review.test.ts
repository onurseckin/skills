import { describe, expect, test } from "bun:test";
import { recordCompletionReview } from "../../../../olt/scripts/src/workflow/completion/record-completion-review.ts";
import { repositoryBinding } from "../test-port.ts";
import {
  clock,
  completionPort,
  reviewInput,
  verifyRepository,
} from "../completion-provenance-fixture.ts";

describe("recordCompletionReview: repository_command_ids validation", () => {
  test("rejects a blank entry in repository_command_ids", () => {
    const port = completionPort();
    const input = reviewInput(port);
    input.repository_command_ids = ["C-REPO", "  "];
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /repository_command_ids must be duplicate-free strings/,
    );
  });

  test("rejects a duplicate entry in repository_command_ids", () => {
    const port = completionPort();
    const input = reviewInput(port);
    input.repository_command_ids = ["C-REPO", "C-REPO"];
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /repository_command_ids must be duplicate-free strings/,
    );
  });

  test("rejects an empty repository_command_ids list (not allowed to be empty)", () => {
    const port = completionPort();
    const input = reviewInput(port);
    input.repository_command_ids = [];
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /repository_command_ids must be duplicate-free strings/,
    );
  });
});

describe("recordCompletionReview: repository binding drift", () => {
  test("rejects when the submitted repository_binding differs from the critic's authorized binding", () => {
    const port = completionPort();
    const input = reviewInput(port);
    input.repository_binding = { ...repositoryBinding, content_sha256: "9".repeat(64) };
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /completion repository binding has drifted/,
    );
  });

  // NB: the sibling condition — comparing draft.current_repository_binding against the critic's
  // assignment.repository_binding — is not independently reachable. completionReadinessSnapshot
  // embeds currentRepositoryBinding(state) directly into the digest it hashes, so any state
  // mutation that changes current_repository_binding enough to trip that clause also changes the
  // readiness digest, and the earlier "completeness readiness snapshot has drifted" check throws
  // first. Confirmed empirically: mutating current_repository_binding here throws the readiness
  // error, never the repository-binding one. See summary findings.
});

describe("recordCompletionReview: published packet consistency", () => {
  test("rejects a review that omits its packet digest while a published packet exists for that id", () => {
    const port = completionPort();
    const input = reviewInput(port);
    delete (input as { packet_sha256?: unknown }).packet_sha256;
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /critic review omits its published packet digest/,
    );
  });

  test("rejects a review whose graph_revision does not match its published packet", () => {
    const port = completionPort();
    const input = reviewInput(port);
    input.graph_revision = 2;
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /critic review does not match its published packet/,
    );
  });
});

describe("recordCompletionReview: requirement proof command evidence", () => {
  test("rejects a requirement proof whose command evidence was not run by the reviewing critic", () => {
    const port = completionPort();
    const input = reviewInput(port);
    // C-REPO is an authoritative (task-less, succeeded) command, but its actor is "coordinator",
    // not the reviewing critic — so it cannot stand as this critic's own proof evidence.
    (
      input.requirement_proofs as { evidence: { reference: string }[] }[]
    )[0]!.evidence[0]!.reference = "C-REPO";
    expect(() => recordCompletionReview(port, "critic", input, verifyRepository, clock)).toThrow(
      /requirement proof command is invalid: C-REPO/,
    );
  });
});
