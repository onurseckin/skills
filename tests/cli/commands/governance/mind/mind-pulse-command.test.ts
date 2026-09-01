import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { mindPulseCommand } from "../../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import * as evidenceModule from "../../../../../olt/scripts/src/mind/evidence/index.ts";
import { cleanupRoots } from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";
import { transact } from "../../../../../olt/scripts/src/engine/store/index.ts";

const roots: string[] = [];
afterEach(async () => cleanupRoots(roots));

function grantRole(run: string, agentId: string, role: string): void {
  transact(run, "coordinator", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status: "active",
    });
    draft.agents = agents;
  });
}

describe("mindPulseCommand", () => {
  test("throws HarnessError when mind is halted", async () => {
    const { run } = await setupCompiledRun("mind-pulse-halted", roots);
    transact(run, "mind-1", "halt", {}, (draft) => {
      draft.mind = {
        halted: true,
        halt_reason: "Quota drained",
      };
    });

    await expect(mindPulseCommand({ run })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("throws HarnessError when milestone evidence verification fails", async () => {
    const { run } = await setupCompiledRun("mind-pulse-evidence-fail", roots);
    const evidSpy = spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
      hashChain: {
        valid: false,
        error: "Corrupted event sequence hash",
      },
      milestoneId: "pulse",
    } as unknown as evidenceModule.MilestoneVerificationResult);

    await expect(mindPulseCommand({ run })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    evidSpy.mockRestore();
  });

  test("throws HarnessError on non-mind role grant and handles auto-grant actors", async () => {
    const { run } = await setupCompiledRun("mind-pulse-role", roots);
    grantRole(run, "non-mind-agent", "implementer");

    await expect(
      mindPulseCommand({
        run,
        actor: "non-mind-agent",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });

    await expect(
      mindPulseCommand({
        run,
        actor: "custom-unregistered-worker",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("delegates to handleOpenPulseTelemetry when open pulse is present", async () => {
    const { run } = await setupCompiledRun("mind-pulse-open-delegate", roots);
    transact(run, "mind-1", "open-pulse", {}, (draft) => {
      draft.pulse = {
        open: {
          pulse_id: "pulse-active",
          opened_at: new Date().toISOString(),
          deadline_at: new Date(Date.now() + 3600000).toISOString(),
        },
      };
    });

    const res = await mindPulseCommand({
      run,
      actor: "mind-1",
    });

    expect(res.status).toBe("active");
    expect(res.pulse_id).toBe("pulse-active");
  });

  test("throws HarnessError when opening pulse if charter file is missing or has sha drift", async () => {
    const { run } = await setupCompiledRun("mind-pulse-charter-missing", roots);

    await expect(
      mindPulseCommand({
        run,
        actor: "mind-1",
      }),
    ).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });
});
