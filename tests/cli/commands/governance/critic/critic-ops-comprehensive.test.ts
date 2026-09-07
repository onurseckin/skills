import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  criticReviewCommand,
  criticStartCommand,
} from "../../../../../olt/scripts/src/cli/commands/critic-ops.ts";
import { registerInspectionCommand, setupReadyRun } from "../../fixtures/critic-ready-fixture.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { loadRun, transact } from "../../../../../olt/scripts/src/engine/store/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";

const roots: string[] = [];

beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
});

describe("critic-ops comprehensive test suite", () => {
  test("criticStartCommand initializes session with string and array gates", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-CRITIC-START-INSPECT";
    registerInspectionCommand(run, repo, cmdId, criticId);

    transact(run, "test-setup", "add-array-gate", {}, (state) => {
      state.gates = [
        { id: "gate-arr", scope: "run", mandatory: true, command: ["bun", "test", "arr"] },
        { id: "gate-str", scope: "run", mandatory: true, command: "bun test str" },
      ];
    });

    const startWithIds = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    expect(typeof startWithIds.token).toBe("string");
    expect(startWithIds.critic).toBeDefined();
    expect(startWithIds.packet_id).toBeDefined();
    expect(String(startWithIds.markdown)).toContain("Completeness Critic Session Initialized");

    const { run: run2 } = await setupReadyRun("critic-changes-run", roots);
    const startWithoutIds = await criticStartCommand({ run: run2, critic: "critic-beta" });
    expect(typeof startWithoutIds.token).toBe("string");
    expect(startWithoutIds.run_root).toBe(run2);
  });

  test("criticReviewCommand validates decisions and catches superficial rubber-stamps", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-VAL";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;

    await expect(
      criticReviewCommand({
        run,
        critic: criticId,
        token,
        decision: "invalid_decision",
        summary: "Detailed review summary exceeding 15 chars",
      }),
    ).rejects.toThrow("--decision must be approve or request_changes");

    const genericStamps = ["lgtm", "looks good", "approved", "pass", "verified", "done"];
    for (const stamp of genericStamps) {
      await expect(
        criticReviewCommand({ run, critic: criticId, token, decision: "approve", summary: stamp }),
      ).rejects.toThrow("critic summary cannot be a superficial rubber-stamp");
    }

    await expect(
      criticReviewCommand({
        run,
        critic: criticId,
        token,
        decision: "approve",
        summary: "Too short",
      }),
    ).rejects.toThrow("critic summary cannot be a superficial rubber-stamp");
  });

  test("criticReviewCommand handles approve and synthesizes proofs with critic and gate checks fallback", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-FULL";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;

    const review = await criticReviewCommand({
      run,
      critic: criticId,
      token,
      decision: "approve",
      summary: "Comprehensive sign-off covering all functional requirements and gates.",
    });

    expect(review.decision).toBe("approve");
    expect(review.report_path).toBeDefined();
    expect(String(review.markdown)).toContain("APPROVED");

    const { run: runGate } = await setupReadyRun("critic-no-findings", roots);
    const criticGate = "critic-delta";
    const startGate = await criticStartCommand({ run: runGate, critic: criticGate });

    const reviewGate = await criticReviewCommand({
      run: runGate,
      critic: criticGate,
      token: startGate.token as string,
      decision: "approve",
      summary: "Comprehensive sign-off verified purely against run gate suite.",
    });
    expect(reviewGate.decision).toBe("approve");
  });

  test("criticReviewCommand reads review payload from file", async () => {
    const { repo, run } = await setupReadyRun("critic-review-file", roots);
    const criticId = "critic-file";
    const cmdId = "C-INSPECT-FILE";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    const token = start.token as string;
    const assignment = start.critic as { readiness_sha256: string; repository_binding: unknown };
    const packet = loadRun(run).state.packets?.[start.packet_id as string];
    const repoCmds = packet?.repository_command_ids ?? [cmdId];

    const reviewDir = `/virtual/cli/review-test-${Date.now()}`;
    getVirtualCliFS().mkdirSync(reviewDir, { recursive: true });
    roots.push(reviewDir);
    const reviewPath = join(reviewDir, "review.json");
    getVirtualCliFS().writeFileSync(
      reviewPath,
      JSON.stringify({
        graph_revision: 1,
        status: "clean",
        readiness_sha256: assignment.readiness_sha256,
        repository_binding: assignment.repository_binding,
        repository_command_ids: repoCmds,
        checks: [{ command_id: cmdId }],
        findings: [],
        unresolved_finding_ids: [],
        requirement_proofs: [
          {
            requirement_id: "req-1",
            status: "satisfied",
            evidence: [{ kind: "command", reference: cmdId, observation: "Passed" }],
          },
        ],
        residual_risks: [],
      }),
    );

    const result = await criticReviewCommand({
      run,
      critic: criticId,
      token,
      decision: "approve",
      review: reviewPath,
      summary: "Comprehensive sign-off verified via external review document.",
    });

    expect(result.decision).toBe("approve");
    expect(result.summary).toBe("Comprehensive sign-off verified via external review document.");
  });
});
