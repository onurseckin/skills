import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  refreshHandoff,
  refreshHandoffOnEscalation,
} from "../../../olt/scripts/src/reporting/handoff.ts";
import {
  taskClaimCommand,
  taskSubmitCommand,
} from "../../../olt/scripts/src/cli/commands/task-claim.ts";
import {
  orchestratorSuperviseCommand,
  orchestratorTickCommand,
} from "../../../olt/scripts/src/cli/commands/orchestrator-ops.ts";
import { cleanupRoots } from "../../cli/full-lifecycle-fixture.ts";
import { CHANGED_FILE, setupRun, TASK_ID } from "../../cli/probe-fixture.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

describe("refreshHandoff", () => {
  test("a run that cannot be rendered yields undefined instead of throwing", () => {
    expect(refreshHandoff("/nonexistent/run/root/for/sure")).toBeUndefined();
  });
});

describe("refreshHandoffOnEscalation", () => {
  test("only escalation triggers a refresh attempt", () => {
    expect(refreshHandoffOnEscalation("/nonexistent/run/root", "running")).toBeUndefined();
  });

  test("an escalated status that fails to refresh still yields undefined, not a throw", () => {
    expect(
      refreshHandoffOnEscalation("/nonexistent/run/root/for/sure", "escalated"),
    ).toBeUndefined();
  });
});

describe("handoff refresh at lifecycle boundaries", () => {
  test("task:submit refreshes handoff.md and returns handoff_path", async () => {
    const { repo, run } = await setupRun("handoff-submit", roots);
    const claim = await taskClaimCommand({
      run,
      task: TASK_ID,
      agent: "worker-1",
      role: "implementer",
    });
    const token = claim.token as string;
    const workerCheck = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--actor",
      "worker-1",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    await writeFile(
      join(repo, CHANGED_FILE),
      "export const probed = true;\nexport const implemented = true;\n",
    );
    const submit = await taskSubmitCommand({
      run,
      task: TASK_ID,
      agent: "worker-1",
      token,
      summary: "completed probe implementation",
      "files-changed": CHANGED_FILE,
      evidence: workerCheck.command_id as string,
    });
    expect(typeof submit.handoff_path).toBe("string");
    expect(existsSync(submit.handoff_path as string)).toBe(true);
    const handoffContent = readFileSync(submit.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");
  });

  test("orchestrator:supervise / orchestratorTickCommand refreshes handoff.md and returns handoff_path", async () => {
    const { run } = await setupRun("handoff-supervise", roots);
    const supervise = await orchestratorSuperviseCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof supervise.handoff_path).toBe("string");
    expect(existsSync(supervise.handoff_path as string)).toBe(true);
    const handoffContent = readFileSync(supervise.handoff_path as string, "utf8");
    expect(handoffContent).toContain("# Harness handoff");

    const tickResult = await orchestratorTickCommand({
      run,
      actor: "coordinator",
    });
    expect(typeof tickResult.handoff_path).toBe("string");
    expect(existsSync(tickResult.handoff_path as string)).toBe(true);
  });
});
