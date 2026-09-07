import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { mindPulseCommand } from "../../../../../../olt/scripts/src/cli/commands/mind-pulse.ts";
import * as evidenceModule from "../../../../../../olt/scripts/src/mind/evidence/index.ts";
import {
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../../fixtures/full-lifecycle-fixture.ts";
import { initRun, transact } from "../../../../../../olt/scripts/src/engine/store/index.ts";
import type { VirtualMemoryFS } from "../../../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../../olt/scripts/src/runtime/session.ts";

let vfs: VirtualMemoryFS;
let evidSpy: { mockRestore: () => void } | undefined;

beforeEach(() => {
  vfs = setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});

afterEach(() => {
  evidSpy?.mockRestore();
  evidSpy = undefined;
  disableInMemoryAgentMetadata();
  cleanupVirtualCliFS();
});

function setupMindRun(name: string): { run: string; repo: string } {
  const repo = `/virtual/mind-pulse/${name}`;
  vfs.mkdirSync(repo, { recursive: true });
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
  vfs.writeFileSync(join(repo, ".olt", "policy.json"), JSON.stringify({ version: "1.0.0" }));
  const run = initRun(repo, `${name}-run`, new TextEncoder().encode("prompt"), "file", true);
  return { run, repo };
}

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
    const { run } = setupMindRun("mind-pulse-halted");
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
    const { run } = setupMindRun("mind-pulse-evidence-fail");
    evidSpy = spyOn(evidenceModule, "verifyMilestoneEvidence").mockReturnValue({
      hashChain: {
        valid: false,
        error: "Corrupted event sequence hash",
      },
      milestoneId: "pulse",
    } as unknown as evidenceModule.MilestoneVerificationResult);

    await expect(mindPulseCommand({ run })).rejects.toMatchObject({
      code: "INVALID_STATE",
    });
  });

  test("throws HarnessError on non-mind role grant and handles auto-grant actors", async () => {
    const { run } = setupMindRun("mind-pulse-role");
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
    const { run } = setupMindRun("mind-pulse-open-delegate");
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
    const { run } = setupMindRun("mind-pulse-charter-missing");

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
