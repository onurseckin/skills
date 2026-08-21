import { describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execute } from "../../orchestrating-long-tasks/scripts/src/cli/execute.ts";
import { workflowPort } from "../../orchestrating-long-tasks/scripts/src/integration/store-ports.ts";
import {
  publishCriticRolePacket,
  repositoryEvidenceCommandIds,
} from "../../orchestrating-long-tasks/scripts/src/packets/critic-grant.ts";
import {
  publishSubTaskRolePacket,
  publishTaskRolePacket,
} from "../../orchestrating-long-tasks/scripts/src/packets/role-grant.ts";
import {
  loadRoleContract,
  loadValidatorDomainContract,
} from "../../orchestrating-long-tasks/scripts/src/packets/role-contract.ts";
import type { TransactionPort } from "../../orchestrating-long-tasks/scripts/src/workflow/types.ts";
import { branchCapsule, openBranchVia, type BranchFixture } from "../unit/branch/fixture.ts";
import { setupReadyRun } from "../unit/cli/critic-run-fixture.ts";
import { setupRun, TASK_ID, VALIDATOR } from "../unit/cli/probe-fixture.ts";
import {
  disposableRoots,
  expectCarriesContract,
  packets,
  publishedFor,
} from "../unit/packets/grant-fixture.ts";

const roots = disposableRoots();

describe("every authority grant hands over a role contract", () => {
  test("task:claim publishes the implementer contract bound to the lease", async () => {
    const { run } = await setupRun("grant-claim", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    const contract = loadRoleContract("implementer");
    expect(claim.role_contract_sha256).toBe(contract.sha256);
    const { record, markdown } = publishedFor(run, "worker-core");
    expect(record.role).toBe("implementer");
    expect(record.task_id).toBe(TASK_ID);
    expect(record.attempt).toBe(1);
    expect(record.id).toBe(claim.packet_id);
    expectCarriesContract(markdown, "implementer");
  });

  test("queue:pop publishes the same contract a claim would", async () => {
    const { run } = await setupRun("grant-pop", roots);
    const popped = await execute(["queue:pop", "--run", run, "--agent", "worker-pop"]);
    expect(popped.role_contract_sha256).toBe(loadRoleContract("implementer").sha256);
    const { record, markdown } = publishedFor(run, "worker-pop");
    expect(record.role).toBe("implementer");
    expectCarriesContract(markdown, "implementer");
  });

  test("task:validate-start publishes the validator contract", async () => {
    const { repo, run } = await setupRun("grant-validate", roots);
    const claim = await execute([
      "task:claim",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-core",
      "--role",
      "implementer",
    ]);
    const check = await execute([
      "run:exec",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--actor",
      "worker-core",
      "--cwd",
      repo,
      "--",
      "bun",
      "gate-core.ts",
    ]);
    // C4: task:submit refuses a submission whose write scope is byte-identical to its content at
    // claim. probe-fixture's setupRun already wrote this file before the task was claimed, so the
    // implementer has to actually change it here, not merely declare it.
    await writeFile(
      join(repo, "tests/unit/core/probe-target.ts"),
      "export const probed = true;\nexport const implemented = true;\n",
    );
    await execute([
      "task:submit",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--agent",
      "worker-core",
      "--token",
      claim.token as string,
      "--files-changed",
      "tests/unit/core/probe-target.ts",
      "--evidence",
      check.command_id as string,
      "--summary",
      "Implemented the task under test",
    ]);
    const started = await execute([
      "task:validate-start",
      "--run",
      run,
      "--task",
      TASK_ID,
      "--validator",
      VALIDATOR,
    ]);
    // B12.2: task:validate-start derives a domain from the task's write scope even when the caller
    // never passes --validator-domain, so the packet carries that domain's contract (standing
    // checklist folded in) rather than the bare validator role contract. This task's write scope
    // draws only code-quality (see probe-fixture.ts).
    const domainContract = loadValidatorDomainContract("code-quality");
    expect(started.role_contract_sha256).toBe(domainContract.sha256);
    const { record, markdown } = publishedFor(run, VALIDATOR);
    expect(record.role).toBe("validator");
    expect(record.task_id).toBe(TASK_ID);
    expectCarriesContract(markdown, "validator", domainContract);
  });

  test("branch:claim publishes the sub-agent contract bound to its sub-task", async () => {
    const fixture: BranchFixture = await branchCapsule(roots, "grant-branch");
    const opened = await openBranchVia(fixture);
    const claimed = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-investigator",
      "--lease-seconds",
      "600",
    ]);
    expect(claimed.role_contract_sha256).toBe(loadRoleContract("sub-investigator").sha256);
    const { record, markdown } = publishedFor(fixture.run, "sub-1");
    expect(record.role).toBe("sub-investigator");
    expect(record.task_id).toBe("S-1");
    expectCarriesContract(markdown, "sub-investigator");
    // The contract forbids writing, so the packet hands the paths over as resources, not a scope.
    expect(markdown).toContain('"write_scope": []');
  });

  test("branch:claim refuses a role no branch dispatches into", async () => {
    const fixture: BranchFixture = await branchCapsule(roots, "grant-branch-role");
    const opened = await openBranchVia(fixture);
    await expect(
      execute([
        "branch:claim",
        "--run",
        fixture.run,
        "--repo",
        fixture.repo,
        "--branch",
        String(opened.branch_id),
        "--sub-task",
        "S-1",
        "--agent",
        "sub-1",
        "--role",
        "implementer",
      ]),
    ).rejects.toThrow("--role must be one of sub-implementer, sub-investigator, sub-validator");
  });

  test("critic:start publishes the completeness critic contract", async () => {
    const { run } = await setupReadyRun("grant-critic", roots);
    const started = await execute(["critic:start", "--run", run, "--critic", "critic-1"]);
    expect(started.role_contract_sha256).toBe(loadRoleContract("completeness-critic").sha256);
    const { record, markdown } = publishedFor(run, "critic-1");
    expect(record.role).toBe("completeness-critic");
    expect(record.task_id).toBeNull();
    expect(record.repository_command_ids?.length).toBeGreaterThan(0);
    expectCarriesContract(markdown, "completeness-critic");
  });
});

describe("a grant packet refuses to name something the run does not hold", () => {
  test("a plan-task grant naming an unknown task", async () => {
    const { run } = await setupRun("grant-unknown-task", roots);
    await expect(
      publishTaskRolePacket({
        runRoot: run,
        port: workflowPort(run),
        role: "implementer",
        agentId: "worker-core",
        attempt: 1,
        token: "irrelevant",
        taskId: "task-that-does-not-exist",
      }),
    ).rejects.toThrow("packet grant names an unknown task: task-that-does-not-exist");
  });

  test("a branch grant naming an unknown sub-task", async () => {
    const fixture: BranchFixture = await branchCapsule(roots, "grant-unknown-sub");
    await openBranchVia(fixture);
    await expect(
      publishSubTaskRolePacket({
        runRoot: fixture.run,
        port: workflowPort(fixture.run),
        role: "sub-implementer",
        agentId: "sub-1",
        token: "irrelevant",
        subTaskId: "S-nowhere",
      }),
    ).rejects.toThrow("packet grant names an unknown sub-task: S-nowhere");
  });

  test("a critic grant before any authorization exists", async () => {
    const { run } = await setupRun("grant-critic-unassigned", roots);
    await expect(
      publishCriticRolePacket({
        runRoot: run,
        port: workflowPort(run),
        criticId: "critic-1",
        token: "irrelevant",
      }),
    ).rejects.toThrow("completeness critic authorization is missing");
  });

  test("a critic grant with no run gate command to stand as repository evidence", async () => {
    const { run } = await setupReadyRun("grant-critic-no-evidence", roots);
    await execute(["critic:start", "--run", run, "--critic", "critic-1"]);
    const live = workflowPort(run);
    const withoutCommands: TransactionPort = {
      read: () => ({ ...live.read(), commands: {} }),
      transact: (actor, kind, payload, mutate) => live.transact(actor, kind, payload, mutate),
    };
    await expect(
      publishCriticRolePacket({
        runRoot: run,
        port: withoutCommands,
        criticId: "critic-1",
        token: "irrelevant",
      }),
    ).rejects.toThrow("at least one authoritative run gate command");
  });

  test("repository evidence is the run-scope gate commands, sorted", async () => {
    const { run } = await setupReadyRun("grant-critic-evidence", roots);
    const state = workflowPort(run).read();
    const ids = repositoryEvidenceCommandIds(state);
    expect(ids.length).toBeGreaterThan(0);
    expect([...ids].sort()).toEqual(ids);
    for (const id of ids) {
      const gateId = state.commands[id]!.gate_id;
      expect(state.gates.find((gate) => gate.id === gateId)?.scope).toBe("run");
    }
    expect(repositoryEvidenceCommandIds({ ...state, commands: {} })).toEqual([]);
  });

  test("a sub-task reclaimed after recovery is granted a second, distinct packet", async () => {
    const fixture: BranchFixture = await branchCapsule(roots, "grant-reclaim");
    const opened = await openBranchVia(fixture);
    const first = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-1",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "5",
    ]);
    await Bun.sleep(5_500);
    await execute([
      "recover",
      "--run",
      fixture.run,
      "--actor",
      "coordinator",
      "--grace-seconds",
      "0",
    ]);
    const second = await execute([
      "branch:claim",
      "--run",
      fixture.run,
      "--repo",
      fixture.repo,
      "--branch",
      String(opened.branch_id),
      "--sub-task",
      "S-1",
      "--agent",
      "sub-2",
      "--role",
      "sub-implementer",
      "--lease-seconds",
      "600",
    ]);
    expect(second.packet_id).not.toBe(first.packet_id);
    const grants = packets(fixture.run).filter((packet) => packet.task_id === "S-1");
    expect(grants.map((packet) => packet.attempt).sort()).toEqual([1, 2]);
  }, 20_000);
});
