import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  criticRejectCommand,
  criticReviewCommand,
  criticStartCommand,
  loadCriticRolePacket,
} from "../olt/scripts/src/cli/commands/critic-ops.ts";
import {
  registerInspectionCommand,
  setupReadyRun,
} from "./cli/commands/fixtures/critic-ready-fixture.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "./cli/commands/fixtures/full-lifecycle-fixture.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../olt/scripts/src/runtime/session.ts";

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

describe("Critic Token Auto-Hydration", () => {
  test("criticReviewCommand auto-hydrates token when --token is not supplied but a packet exists", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-HYDRATE";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    expect(typeof start.token).toBe("string");

    const packet = loadCriticRolePacket(run);
    expect(packet).not.toBeNull();
    expect(packet?.token).toBe(start.token);

    const review = await criticReviewCommand({
      run,
      critic: criticId,
      decision: "approve",
      summary: "Comprehensive verification of all requirements without manual token.",
    });

    expect(review.decision).toBe("approve");
    expect(review.report_path).toBeDefined();
    expect(String(review.markdown)).toContain("APPROVED");
  });

  test("explicit --token still works", async () => {
    const { repo, run } = await setupReadyRun("critic-approve-run", roots);
    const criticId = "critic-alpha";
    const cmdId = "C-INSPECT-EXPLICIT";
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
      summary: "Comprehensive verification of all requirements with explicit token.",
    });

    expect(review.decision).toBe("approve");
    expect(review.report_path).toBeDefined();
    expect(String(review.markdown)).toContain("APPROVED");
  });

  test("throws HarnessError when --token is omitted and no active critic session exists", async () => {
    const { run } = await setupReadyRun("critic-review-no-assignment", roots);
    const criticId = "critic-never-started";

    expect(
      criticReviewCommand({
        run,
        critic: criticId,
        decision: "approve",
        summary: "This should fail because no session or packet exists.",
      }),
    ).rejects.toThrow("--token is required when no active critic session exists");
  });

  test("criticRejectCommand auto-hydrates token when --token is not supplied but a packet exists", async () => {
    const { repo, run } = await setupReadyRun("critic-changes-run", roots);
    const criticId = "critic-beta";
    const cmdId = "C-INSPECT-REJECT";
    registerInspectionCommand(run, repo, cmdId, criticId);

    const start = await criticStartCommand({
      run,
      critic: criticId,
      "repository-command-ids": [cmdId],
    });
    expect(typeof start.token).toBe("string");

    const reject = await criticRejectCommand({
      run,
      critic: criticId,
      summary: "Missing essential integration test proof.",
      findings: JSON.stringify([
        {
          id: "F-HYDRATE-01",
          requirement_id: "req-1",
          severity: "critical",
          observation: "Observed missing integration test in test suite",
          remediation: "Add integration test for critic token auto-hydration",
          revalidation: "bun test tests/critic-token.test.ts",
        },
      ]),
    });

    expect(reject.decision).toBe("request_changes");
    expect(reject.findings_count).toBe(1);
    expect(String(reject.markdown)).toContain("CHANGES REQUESTED");
  });
});
