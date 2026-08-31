import { describe, expect, test } from "bun:test";
import { fileURLToPath } from "node:url";
import {
  assertGrantedRoleTools,
  grantContext,
  grantPacketId,
  grantedInvocations,
  publishSubTaskRolePacket,
  publishTaskRolePacket,
  recordGrantInspections,
  type SubTaskRoleGrant,
  type TaskRoleGrant,
} from "../../../olt/scripts/src/packets/role-grant.ts";
import { loadRoleContract } from "../../../olt/scripts/src/packets/role-contract.ts";
import { loadRun, transact } from "../../../olt/scripts/src/engine/store/index.ts";
import { workflowPort } from "../../../olt/scripts/src/integration/store-ports.ts";
import { tokenDigest } from "../../../olt/scripts/src/workflow/lease/token.ts";
import { emptyGrantRun, seedSingleTaskGraph } from "./grant-run-fixture.ts";

const HARNESS_SCRIPT = fileURLToPath(new URL("../../../olt/scripts/harness.ts", import.meta.url));

describe("role-grant pure helpers", () => {
  test("grantedInvocations builds a bun-harness argv for every contract command", () => {
    const contract = loadRoleContract("implementer");
    const invocations = grantedInvocations(contract);
    expect(invocations.length).toBe(contract.commands.length);
    for (const [index, command] of contract.commands.entries()) {
      expect(invocations[index]).toEqual(["bun", HARNESS_SCRIPT, command]);
    }
  });

  test("grantPacketId is deterministic for the same role and binding, and differs across bindings", () => {
    const first = grantPacketId("implementer", { agent_id: "agent-1", attempt: 1 });
    const same = grantPacketId("implementer", { agent_id: "agent-1", attempt: 1 });
    const other = grantPacketId("implementer", { agent_id: "agent-1", attempt: 2 });
    expect(first).toBe(same);
    expect(first).not.toBe(other);
    expect(first.startsWith("implementer-")).toBe(true);
  });

  test("assertGrantedRoleTools forbids execution tools on cognitive validators", () => {
    expect(() =>
      assertGrantedRoleTools("validator", [{ name: "run:exec", category: "shell" }]),
    ).toThrow("Shell and test execution belongs exclusively to mechanic validators");

    expect(() => assertGrantedRoleTools("validator", [{ name: "bash" }])).toThrow(
      "Shell and test execution belongs exclusively to mechanic validators",
    );

    // Safe tools on validator succeed
    expect(() =>
      assertGrantedRoleTools("validator", [{ name: "view_file", category: "reading" }]),
    ).not.toThrow();

    // Execution tools on mechanic validator succeed
    expect(() =>
      assertGrantedRoleTools("mechanic-validator", [{ name: "run:exec", category: "shell" }]),
    ).not.toThrow();
  });
});

describe("recordGrantInspections and grantContext", () => {
  test("records baseline and current inspections and builds context around the raw run state", async () => {
    const { repo, run } = await emptyGrantRun("role-grant-context-");
    recordGrantInspections(run, "agent-1");

    const loaded = loadRun(run);
    expect(typeof loaded.state.baseline_repository_inspection_sha256).toBe("string");
    expect(typeof loaded.state.current_repository_inspection_sha256).toBe("string");

    const { runId, context, runState } = grantContext(run, 0);
    expect(runId).toBe(loaded.manifest.run_id);
    expect(runState.revision).toBeGreaterThan(0);
    expect(context.original_prompt).toBe("Build the thing");
    expect(context.expected_revision).toBe(0);
    expect(context.baseline_repository_state).toBeDefined();
    expect(context.current_repository_state).toBeDefined();
    void repo;
  });
});

describe("publishTaskRolePacket", () => {
  test("rejects a grant naming a task that does not exist", async () => {
    const { run } = await emptyGrantRun("role-grant-unknown-task-");
    seedSingleTaskGraph(run);
    const grant: TaskRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      role: "implementer",
      agentId: "agent-1",
      token: "token-1",
      taskId: "T-does-not-exist",
      attempt: 1,
    };
    await expect(publishTaskRolePacket(grant)).rejects.toThrow(
      "packet grant names an unknown task: T-does-not-exist",
    );
  });

  test("publishes an implementer packet bound to the leased task", async () => {
    const { run } = await emptyGrantRun("role-grant-implementer-");
    seedSingleTaskGraph(run);
    const token = "implementer-token";
    const expires = new Date(Date.now() + 60_000).toISOString();
    transact(run, "test-setup", "lease-task", {}, (draft) => {
      const tasks = draft.tasks as Record<string, Record<string, unknown>>;
      const task = tasks["T-1"]!;
      task.status = "leased";
      task.lease = {
        agent_id: "agent-1",
        role: "implementer",
        attempt: 1,
        token_digest: tokenDigest(token),
        issued_at: new Date().toISOString(),
        expires_at: expires,
        heartbeat_at: new Date().toISOString(),
        duration_seconds: 60,
      };
    });

    const grant: TaskRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      role: "implementer",
      agentId: "agent-1",
      token,
      taskId: "T-1",
      attempt: 1,
    };
    const published = await publishTaskRolePacket(grant);
    expect(published.record.status).toBe("published");
    expect(published.packet.metadata.role).toBe("implementer");
    expect(published.packet.metadata.task_id).toBe("T-1");
  });

  test("publishes a validator packet scoped to a validator domain on the very first round", async () => {
    const { run } = await emptyGrantRun("role-grant-validator-");
    seedSingleTaskGraph(run);
    const token = "validator-token";
    const deadline = new Date(Date.now() + 60_000).toISOString();
    transact(run, "test-setup", "start-validation", {}, (draft) => {
      const tasks = draft.tasks as Record<string, Record<string, unknown>>;
      const task = tasks["T-1"]!;
      task.status = "validating";
      task.validations = [
        {
          validator_id: "agent-2",
          domain: "code-quality",
          token_digest: tokenDigest(token),
          attempt: 1,
          started_at: new Date().toISOString(),
          deadline_at: deadline,
        },
      ];
    });

    const grant: TaskRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      role: "validator",
      agentId: "agent-2",
      token,
      taskId: "T-1",
      attempt: 1,
      validatorDomain: "code-quality",
    };
    const published = await publishTaskRolePacket(grant);
    expect(published.record.status).toBe("published");
    expect(published.packet.metadata.role).toBe("validator");
    // Round 1 has no prior round to report against, so validationRoundContext returns
    // undefined and the packet carries no validation_round section.
    expect(published.packet.markdown).not.toContain("## Validation round");
  });
});

describe("publishSubTaskRolePacket", () => {
  test("rejects a grant naming a sub-task that does not exist in any branch", async () => {
    const { run } = await emptyGrantRun("role-grant-unknown-subtask-");
    seedSingleTaskGraph(run);
    const grant: SubTaskRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      role: "sub-implementer",
      agentId: "agent-3",
      token: "token-3",
      subTaskId: "sub-does-not-exist",
    };
    await expect(publishSubTaskRolePacket(grant)).rejects.toThrow(
      "packet grant names an unknown sub-task: sub-does-not-exist",
    );
  });

  test("publishes a sub-implementer packet bound to a claimed branch sub-task", async () => {
    const { run } = await emptyGrantRun("role-grant-subtask-");
    seedSingleTaskGraph(run);
    const token = "sub-token";
    const expires = new Date(Date.now() + 60_000).toISOString();
    const claimedAt = new Date().toISOString();
    transact(run, "test-setup", "open-branch", {}, (draft) => {
      draft.branches = [
        {
          id: "branch-1",
          parent_task_id: "T-1",
          parent_agent_id: "agent-1",
          reason: "investigate",
          depth: 1,
          status: "open",
          opened_at: claimedAt,
          sub_tasks: [
            {
              id: "sub-1",
              label: "Investigate the thing",
              write_scope: ["src/owned/sub"],
              status: "claimed",
              agent_id: "agent-3",
              claimed_at: claimedAt,
              lease: {
                agent_id: "agent-3",
                token_digest: tokenDigest(token),
                issued_at: claimedAt,
                expires_at: expires,
                duration_seconds: 60,
              },
            },
          ],
        },
      ];
    });

    const grant: SubTaskRoleGrant = {
      runRoot: run,
      port: workflowPort(run),
      role: "sub-implementer",
      agentId: "agent-3",
      token,
      subTaskId: "sub-1",
    };
    const first = await publishSubTaskRolePacket(grant);
    expect(first.record.status).toBe("published");
    expect(first.packet.metadata.role).toBe("sub-implementer");
    expect(first.packet.metadata.attempt).toBe(1);

    // Publishing again for the same still-claimed sub-task counts the prior publication (the
    // branch ledger doesn't consume the claim), covering the attempt-counting filter's body.
    const second = await publishSubTaskRolePacket(grant);
    expect(second.packet.metadata.attempt).toBe(2);
  });
});
