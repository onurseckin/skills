import { afterEach, describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import {
  cleanupRoots,
  compiledCapsule,
  ledgerOf,
  registerCoordinator,
} from "../unit/agents/fixture.ts";

const roots: string[] = [];

afterEach(() => cleanupRoots(roots));

function register(run: string, agent: string): Promise<Record<string, unknown>> {
  return execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    agent,
    "--role",
    "implementer",
    "--host",
    "claude-code",
    "--parent-agent",
    "coordinator-1",
    "--parent-task",
    "task-1",
  ]);
}

describe("total agent budget", () => {
  test("refuses the grant that would take the run past max_agents", async () => {
    const run = await compiledCapsule(roots, "agent-budget", { max_agents: 2 });
    await registerCoordinator(run);
    await register(run, "worker-1");

    await expect(register(run, "worker-2")).rejects.toThrow(
      "max_agents budget of 2 is exhausted: 2 grants already issued and this needs 1 more; raise max_agents or narrow the work",
    );
    expect(ledgerOf(run)).toHaveLength(2);
  });

  test("charges every grant the run ever issued, released ones included", async () => {
    const run = await compiledCapsule(roots, "agent-budget-released", { max_agents: 2 });
    await registerCoordinator(run);
    await register(run, "worker-1");
    await execute([
      "agent:release",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--reason",
      "task-1 submitted",
    ]);

    await expect(register(run, "worker-2")).rejects.toThrow("max_agents budget of 2 is exhausted");
  });

  test("leaves the default budget out of the way of an ordinary run", async () => {
    const run = await compiledCapsule(roots, "agent-budget-default");
    await registerCoordinator(run);
    await register(run, "worker-1");
    expect(ledgerOf(run)).toHaveLength(2);
  });
});
