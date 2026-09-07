import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { taskReviewCommand } from "../../../../../olt/scripts/src/cli/commands/task-review.ts";
import { loadChecklist } from "../../../../../olt/scripts/src/packets/role-contract.ts";
import {
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import {
  TASK_ID,
  VALIDATOR,
  answeredBy,
  findingIdsFrom,
  recordProbe,
  recordProbeRounds,
  reviewPass,
  seedGateProof,
} from "../../fixtures/probe-fixture.ts";
import { setupReviewRun } from "./task-review-verdicts.test.ts";

describe("task:review - Checklist Verification", () => {
  beforeEach(() => {
    setupVirtualCliFS();
  });

  afterEach(() => {
    cleanupVirtualCliFS();
  });

  test("verifies --checklist-domain and --checklist-report requirements", async () => {
    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "code-quality",
      }),
    ).rejects.toThrow(/must be given together/);

    await expect(
      taskReviewCommand({
        run: "unused",
        task: TASK_ID,
        validator: VALIDATOR,
        token: "unused-token",
        status: "pass",
        "checklist-domain": "not-a-real-domain",
        "checklist-report": "/does-not-matter/coverage.json",
      }),
    ).rejects.toThrow(/not a recognized validator domain/);
  });

  test("records checklist coverage into validation record", async () => {
    const { repo, run, token, gateCmd } = await setupReviewRun("review-checklist-coverage");
    seedGateProof(run, TASK_ID);
    const first = await recordProbe(run, token, "Prove with checklist");
    const laterRounds = await recordProbeRounds(run, token, "Prove with checklist", 2, 5);
    const allFindingIds = findingIdsFrom([first, ...laterRounds]);

    const checklist = loadChecklist("code-quality");
    const reportPath = join(repo, "coverage.json");
    getVirtualCliFS().writeFileSync(
      reportPath,
      JSON.stringify({
        items: checklist.items.map((item) => ({
          id: item.id,
          disposition: "not_applicable",
          reason: "exercised by the fixture task, not this checklist item",
        })),
      }),
    );

    const passed = await execute([
      ...reviewPass(run, token, gateCmd, answeredBy(allFindingIds, gateCmd)),
      "--checklist-domain",
      "code-quality",
      "--checklist-report",
      reportPath,
    ]);
    expect((passed.checklist_coverage as { applicable: boolean }).applicable).toBe(true);
  });
});
