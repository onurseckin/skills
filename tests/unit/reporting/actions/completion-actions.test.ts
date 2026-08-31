import { describe, expect, test } from "bun:test";
import type { JsonObject } from "../../../../olt/scripts/src/core/contracts/index.ts";
import { orphanEvidenceSha256 } from "../../../../olt/scripts/src/workflow/orphan-evidence/digest.ts";
import { actions, view } from "./actions-fixture.ts";

describe("completion argv after every task is done", () => {
  const done = (overrides: JsonObject = {}) => view("done", overrides);
  const withRunGate = {
    commands: [
      { id: "C-RUN", actor: "coordinator", status: "succeeded", task_id: null, gate_id: "G-run" },
    ],
  };

  test("runs the outstanding run gate before anything else", () => {
    const text = actions(done()).text;
    expect(text).toContain("--gate G-run");
    expect(text).toContain("/repo/packages/api");
    expect(text).not.toContain(" critic:start ");
  });

  test("states that orphan evidence has no disposition command", () => {
    const evidence = { task_id: "T-1", report_sha256: "late" };
    const sha = orphanEvidenceSha256(evidence);
    const result = actions(
      done({ ...withRunGate, orphan_evidence: [{ orphan_sha256: sha, evidence }] }),
    );
    expect(result.text).not.toContain(" critic:start ");
    expect(result.unavailable).toEqual([
      `orphan evidence ${sha} blocks completion and no registry command dispositions it; the disposition has to be recorded before the run can seal`,
    ]);
  });

  test("moves past orphan evidence once it carries a disposition", () => {
    const evidence = { task_id: "T-1", report_sha256: "late" };
    const sha = orphanEvidenceSha256(evidence);
    const result = actions(
      done({
        ...withRunGate,
        orphan_evidence: [{ orphan_sha256: sha, evidence }],
        orphan_evidence_dispositions: [{ orphan_sha256: sha }],
      }),
    );
    expect(result.text).toContain(" critic:start ");
    expect(result.unavailable).toEqual([]);
  });

  test("walks the critic from assignment to a sealed capsule", () => {
    const state = done(withRunGate);
    expect(actions(state).text).toContain(" critic:start ");
    for (const status of ["assigned", "packet_published"]) {
      state.completion_critic = { critic_id: "critic-1", attempt: 1, status, packet_id: null };
      const text = actions(state).text;
      expect(text).toContain(" critic:review ");
      expect(text).toContain("<critic-token-returned-by:critic:start>");
    }
    state.completion_critic = {
      critic_id: "critic-1",
      attempt: 1,
      status: "reviewed",
      packet_id: "critic-1",
    };
    state.completion_review = { status: "clean", review_sha256: "review-2" };
    expect(actions(state).text).toContain(" run:complete ");
  });

  test("has the critic record its own check before it is asked for a verdict", () => {
    const state = done({
      ...withRunGate,
      completion_critic: { critic_id: "critic-1", attempt: 1, status: "assigned", packet_id: null },
    });
    const { argv } = actions(state);
    const check = argv.findIndex((entry) => entry.includes("--gate") && entry.includes("G-run"));
    const verdict = argv.findIndex((entry) => entry.includes("critic:review"));
    expect(check).toBeGreaterThanOrEqual(0);
    expect(argv[check]).toContain("critic-1");
    expect(verdict).toBeGreaterThan(check);
  });

  test("stops naming the check once the critic's own command has landed", () => {
    const state = done({
      commands: [
        ...withRunGate.commands,
        { id: "C-CRITIC", actor: "critic-1", status: "succeeded", task_id: null, gate_id: null },
      ],
      completion_critic: { critic_id: "critic-1", attempt: 1, status: "assigned", packet_id: null },
    });
    const { argv } = actions(state);
    expect(argv.some((entry) => entry.includes("run:exec"))).toBeFalse();
    expect(argv.some((entry) => entry.includes("critic:review"))).toBeTrue();
  });

  test("says that a completion remediation has no command, until one is recorded", () => {
    const state = done({
      ...withRunGate,
      completion_critic: {
        critic_id: "critic-1",
        attempt: 1,
        status: "reviewed",
        packet_id: "critic-1",
      },
      completion_review: { status: "findings", review_sha256: "review-1" },
    });
    const blocked = actions(state);
    expect(blocked.text).not.toContain(" critic:start ");
    expect(blocked.text).not.toContain(" run:complete ");
    expect(blocked.unavailable).toEqual([
      "completion review review-1 recorded findings and no registry command records the remediation that answers them",
    ]);
    state.completion_remediations = [{ review_sha256: "review-1" }];
    const remediated = actions(state);
    expect(remediated.text).toContain(" critic:start ");
    expect(remediated.unavailable).toEqual([]);
  });

  test("assigns a fresh critic when the last one expired", () => {
    const state = done({
      ...withRunGate,
      completion_critic: {
        critic_id: "expired-critic",
        attempt: 2,
        status: "expired",
        packet_id: null,
      },
    });
    expect(actions(state).text).toContain(" critic:start ");
  });

  test("offers nothing while a recorded critic has not reached a verdict", () => {
    const state = done({
      ...withRunGate,
      completion_critic: {
        critic_id: "critic-1",
        attempt: 1,
        status: "reviewing",
        packet_id: "critic-1",
      },
    });
    const result = actions(state);
    expect(result.text).not.toContain(" critic:");
    expect(result.text).not.toContain(" run:complete ");
    expect(result.unavailable).toEqual([]);
  });

  test("offers nothing when a reviewed critic recorded no review", () => {
    const state = done({
      ...withRunGate,
      completion_critic: {
        critic_id: "critic-1",
        attempt: 1,
        status: "reviewed",
        packet_id: "critic-1",
      },
    });
    const result = actions(state);
    expect(result.text).not.toContain(" critic:");
    expect(result.text).not.toContain(" run:complete ");
  });
});
