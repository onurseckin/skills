import { describe, expect, test } from "bun:test";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { loadRoleContract } from "../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import { loadRun } from "../../orchestrating-long-tasks/scripts/src/store/index.ts";
import { setupReadyRun } from "../unit/cli/critic-run-fixture.ts";
import { setupRun, TASK_ID } from "../unit/cli/probe-fixture.ts";
import { disposableRoots, registerGrant } from "../unit/packets/grant-fixture.ts";

// The in-memory domain-level cases for role-contract refusal live in
// tests/unit/packets/role-contract-refusals.test.ts; this file drives the real CLI end to end
// against real capsules, which is the only way to exercise the dispatch-level enforcement below.

const roots = disposableRoots();

describe("a granted role cannot invoke a command its contract withholds", () => {
  test("a registered validator is refused task:submit", async () => {
    const { run } = await setupRun("deny-validator", roots);
    await registerGrant(run, "val-deny", "validator");
    await expect(
      execute([
        "task:submit",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "val-deny",
        "--token",
        "irrelevant",
        "--summary",
        "should never be recorded",
      ]),
    ).rejects.toThrow("role validator may not invoke task:submit");
  });

  test("a registered sub-investigator is refused a command that writes", async () => {
    const { run } = await setupRun("deny-investigator", roots);
    await registerGrant(run, "sub-deny", "sub-investigator");
    await expect(
      execute([
        "task:claim",
        "--run",
        run,
        "--task",
        TASK_ID,
        "--agent",
        "sub-deny",
        "--role",
        "implementer",
      ]),
    ).rejects.toThrow("role sub-investigator may not invoke task:claim");
    expect(loadRun(run).state.tasks).toMatchObject({ [TASK_ID]: { status: "ready" } });
  });

  test("a registered implementer keeps the commands its contract grants", async () => {
    const { run } = await setupRun("allow-implementer", roots);
    await registerGrant(run, "impl-allow", "implementer");
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "impl-allow",
      "--role",
      "implementer",
    ]);
    expect(claim.role_contract_sha256).toBe(loadRoleContract("implementer").sha256);
  });

  test("the critic a grant creates is its subject, so critic:start still reaches it", async () => {
    const { run } = await setupReadyRun("subject-critic", roots);
    await registerGrant(run, "critic-1", "completeness-critic");
    const started = await execute(["critic:start", "--run", run, "--critic", "critic-1"]);
    expect(started.role_contract_sha256).toBe(loadRoleContract("completeness-critic").sha256);
  });

  test("the agent a pop leases to is its subject, so queue:pop still reaches it", async () => {
    const { run } = await setupRun("subject-pop", roots);
    await registerGrant(run, "worker-pop", "implementer");
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-pop"]);
    expect(popped.role_contract_sha256).toBe(loadRoleContract("implementer").sha256);
  });

  test("the subject exception does not leak to the rest of the critic family", async () => {
    const { run } = await setupRun("subject-leak", roots);
    await registerGrant(run, "impl-critic", "implementer");
    await expect(
      execute([
        "critic:review",
        "--run",
        run,
        "--critic",
        "impl-critic",
        "--token",
        "irrelevant",
        "--decision",
        "approve",
        "--summary",
        "should never be recorded",
      ]),
    ).rejects.toThrow("role implementer may not invoke critic:review");
  });

  test("registering a sub-agent is the coordinator's call, not the subject's", async () => {
    const { run } = await setupRun("register-subject", roots);
    await registerGrant(run, "coord-1", "coordinator");
    // --agent names the agent being created; the contract checked is the caller's.
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "new-validator",
      "--role",
      "validator",
      "--host",
      "claude-code",
      "--actor",
      "coord-1",
    ]);
    expect((loadRun(run).state.agents as { id: string }[]).map((grant) => grant.id)).toContain(
      "new-validator",
    );
  });
});
