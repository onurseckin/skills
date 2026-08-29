import { describe, expect, test } from "bun:test";
import { HarnessError } from "../../../olt/scripts/src/core/errors/index.ts";
import { registerAgentGrant } from "../../../olt/scripts/src/workflow/agents/grants.ts";
import { emptyGrantRun } from "./grant-run-fixture.ts";

describe("registerAgentGrant: hierarchical spawning is enforced at the state-mutation layer too", () => {
  test("a parent whose role cannot spawn the requested tier is refused, independent of any CLI check", async () => {
    const { run } = await emptyGrantRun("grants-defense-tier-violation-");
    await registerAgentGrant({
      runRoot: run,
      agentId: "orchestrator-1",
      role: "orchestrator",
      parentAgentId: null,
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });

    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "impl-direct",
        role: "implementer",
        parentAgentId: "orchestrator-1",
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "verified_parent", actorId: "orchestrator-1" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow(HarnessError);
  });

  test("a released parent cannot supervise a new spawn at the state-mutation layer", async () => {
    const { run } = await emptyGrantRun("grants-defense-released-parent-");
    const { releaseAgentGrant } =
      await import("../../../olt/scripts/src/workflow/agents/grants.ts");
    await registerAgentGrant({
      runRoot: run,
      agentId: "coord-1",
      role: "coordinator",
      parentAgentId: null,
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });
    await releaseAgentGrant({
      runRoot: run,
      agentId: "coord-1",
      actor: "coord-1",
      reason: "test-teardown",
    });

    expect(() =>
      registerAgentGrant({
        runRoot: run,
        agentId: "impl-under-released",
        role: "implementer",
        parentAgentId: "coord-1",
        parentTaskId: null,
        host: "claude-code",
        authority: { kind: "verified_parent", actorId: "coord-1" },
        maxAgents: 10,
        telemetry: {},
      }),
    ).toThrow("holds a released grant, not an active one");
  });

  test("the branch-worker exception (Tier 3 -> sub-implementer/sub-investigator/sub-validator) still passes at this layer", async () => {
    const { run } = await emptyGrantRun("grants-defense-branch-exception-");
    await registerAgentGrant({
      runRoot: run,
      agentId: "coord-1",
      role: "coordinator",
      parentAgentId: null,
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "conditional_genesis" },
      maxAgents: 10,
      telemetry: {},
    });
    await registerAgentGrant({
      runRoot: run,
      agentId: "impl-1",
      role: "implementer",
      parentAgentId: "coord-1",
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "verified_parent", actorId: "coord-1" },
      maxAgents: 10,
      telemetry: {},
    });

    const outcome = await registerAgentGrant({
      runRoot: run,
      agentId: "sub-1",
      role: "sub-implementer",
      parentAgentId: "impl-1",
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "verified_parent", actorId: "impl-1" },
      maxAgents: 10,
      telemetry: {},
    });
    expect(outcome.grant.id).toBe("sub-1");

    const nested = await registerAgentGrant({
      runRoot: run,
      agentId: "sub-2",
      role: "sub-implementer",
      parentAgentId: "sub-1",
      parentTaskId: null,
      host: "claude-code",
      authority: { kind: "verified_parent", actorId: "sub-1" },
      maxAgents: 10,
      telemetry: {},
    });
    expect(nested.grant.id).toBe("sub-2");
  });
});
