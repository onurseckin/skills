import { describe, expect, test } from "bun:test";
import { initRun, loadRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import { enableInMemoryAgentMetadata } from "../../../../olt/scripts/src/runtime/session.ts";
import {
  registerAgentGrant,
  releaseAgentGrant,
} from "../../../../olt/scripts/src/workflow/agents/grants.ts";
import { readAgentLedger } from "../../../../olt/scripts/src/workflow/agents/ledger.ts";
import { setupWorkflowVirtualFs } from "../../shared/index.ts";

function withRun<T>(body: (runRoot: string) => T): T {
  const { vfs, cleanup } = setupWorkflowVirtualFs();
  enableInMemoryAgentMetadata();
  try {
    const repo = "/virtual/tmp/grants-run-core";
    vfs.mkdirSync(repo, { recursive: true });
    const runRoot = initRun(repo, "test-run", new TextEncoder().encode("task"), "file", true);
    transact(runRoot, "setup", "add-task", {}, (draft) => {
      draft.tasks = { "T-1": { id: "T-1" } };
    });
    return body(runRoot);
  } finally {
    cleanup();
  }
}

describe("workflow/agents/grants: registration core & authority", () => {
  test("rejects an untyped registration request that omits transactional authority", () => {
    withRun((runRoot) => {
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "missing-authority",
          role: "coordinator",
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          maxAgents: 5,
          telemetry: {},
        } as unknown as Parameters<typeof registerAgentGrant>[0]),
      ).toThrow("registration authority is required");
      expect(readAgentLedger(loadRun(runRoot).state)).toHaveLength(0);
    });
  });

  test("admits exactly one conditional-genesis grant under the transaction lock", () => {
    for (const [firstId, secondId] of [
      ["genesis-a", "genesis-b"],
      ["genesis-same", "genesis-same"],
    ]) {
      withRun((runRoot) => {
        const input = (agentId: string) => ({
          runRoot,
          agentId,
          role: "coordinator" as const,
          parentAgentId: null,
          parentTaskId: null,
          host: "local",
          authority: { kind: "conditional_genesis" as const },
          maxAgents: 5,
          telemetry: {},
        });
        expect(registerAgentGrant(input(firstId)).grant.id).toBe(firstId);
        expect(() => registerAgentGrant(input(secondId))).toThrow(
          firstId === secondId ? "already holds a grant" : "conditional agent genesis",
        );
        expect(
          loadRun(runRoot).events.filter((event) => event.kind === "agent-registered"),
        ).toHaveLength(1);
      });
    }
  });

  test("enforces verified-parent identity, active status, and tier checks in the locked mutator", () => {
    withRun((runRoot) => {
      const register = (
        agentId: string,
        role: "coordinator" | "implementer",
        parent: string | null,
        actor?: string,
      ) => {
        const base = {
          runRoot,
          agentId,
          role,
          parentTaskId: null,
          host: "local",
          maxAgents: 5,
          telemetry: {},
        };
        return parent === null
          ? registerAgentGrant({
              ...base,
              parentAgentId: null,
              authority: { kind: "conditional_genesis" },
            })
          : registerAgentGrant({
              ...base,
              parentAgentId: parent,
              authority: { kind: "verified_parent", actorId: actor ?? parent },
            });
      };

      register("coord-1", "coordinator", null);
      expect(() => register("impl-unrelated", "implementer", "coord-1", "other")).toThrow(
        "does not match parent agent",
      );
      releaseAgentGrant({ runRoot, agentId: "coord-1", actor: "coord-1", reason: "released" });
      expect(() => register("impl-released", "implementer", "coord-1", "coord-1")).toThrow(
        "holds a released grant",
      );
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "orch-1",
        role: "orchestrator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "impl-tier-jump",
          role: "implementer",
          parentAgentId: "orch-1",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "orch-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("may only dispatch Tier 2 Coordinators");
    });
  });

  test("registerAgentGrant validates parent agent and parent task constraints", () => {
    withRun((runRoot) => {
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-self",
          role: "implementer",
          parentAgentId: "agent-self",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "agent-self" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("an agent cannot be its own parent");
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-child",
          role: "implementer",
          parentAgentId: "nonexistent-parent",
          parentTaskId: null,
          host: "local",
          authority: { kind: "verified_parent", actorId: "nonexistent-parent" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("agent nonexistent-parent holds no grant");
    });

    withRun((runRoot) => {
      registerAgentGrant({
        runRoot,
        agentId: "coordinator-1",
        role: "coordinator",
        parentAgentId: null,
        parentTaskId: null,
        host: "local",
        authority: { kind: "conditional_genesis" },
        maxAgents: 5,
        telemetry: {},
      });
      expect(() =>
        registerAgentGrant({
          runRoot,
          agentId: "agent-task-child",
          role: "implementer",
          parentAgentId: "coordinator-1",
          parentTaskId: "unknown-task-99",
          host: "local",
          authority: { kind: "verified_parent", actorId: "coordinator-1" },
          maxAgents: 5,
          telemetry: {},
        }),
      ).toThrow("parent task unknown-task-99 does not exist in this run");
    });
  });
});
