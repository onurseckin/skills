import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { quotaFreezeCommand } from "../../../../olt/scripts/src/cli/commands/quota-freeze.ts";
import { QuotaCircuitBreaker } from "../../../../olt/scripts/src/telemetry/circuit-breaker.ts";
import { execute } from "../../../../olt/scripts/src/cli/execute.ts";
import { registerSessionGrant } from "../../../../olt/scripts/src/authority/session/index.ts";
import { initRun, transact } from "../../../../olt/scripts/src/engine/store/index.ts";
import type { VirtualMemoryFS } from "../../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { cleanupVirtualCliFS, setupVirtualCliFS } from "../fixtures/full-lifecycle-fixture.ts";

let vfs: VirtualMemoryFS;

beforeEach(() => {
  vfs = setupVirtualCliFS();
});

afterEach(() => {
  cleanupVirtualCliFS();
});

function setupQuotaRun(name: string): { run: string; repo: string } {
  const repo = `/virtual/mind-freeze/${name}`;
  vfs.mkdirSync(repo, { recursive: true });
  vfs.mkdirSync(join(repo, ".git"), { recursive: true });
  vfs.mkdirSync(join(repo, ".olt"), { recursive: true });
  vfs.writeFileSync(join(repo, ".olt", "policy.json"), JSON.stringify({ version: "1.0.0" }));
  const run = initRun(repo, `${name}-run`, new TextEncoder().encode("prompt"), "file", true);
  return { run, repo };
}

function grantRole(
  run: string,
  agentId: string,
  role: string,
  status: "active" | "released" = "active",
): void {
  transact(run, "test-setup", `grant-${agentId}`, {}, (draft) => {
    const agents = Array.isArray(draft.agents) ? [...draft.agents] : [];
    agents.push({
      id: agentId,
      role,
      parent_agent_id: null,
      parent_task_id: null,
      host: "local",
      granted_at: new Date().toISOString(),
      status,
    });
    draft.agents = agents;
  });
}

describe("quota:freeze CLI actor authentication and soft drain suite", () => {
  test("rejects direct invocation when context is provided without authenticated caller", async () => {
    const { run } = setupQuotaRun("unauth-context");
    await expect(quotaFreezeCommand({ run }, {})).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILURE",
    });
  });

  test("rejects direct invocation when explicit actor has no verified session", async () => {
    const { run } = setupQuotaRun("unverified-actor");
    await expect(quotaFreezeCommand({ run, actor: "ghost" })).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILURE",
    });
  });

  test("rejects direct invocation when caller session is unverified", async () => {
    const { run } = setupQuotaRun("unverified-caller");
    await expect(
      quotaFreezeCommand(
        { run, actor: "mind" },
        { authenticatedCaller: { actor: "mind", role: "mind", verified: false } },
      ),
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILURE",
    });
  });

  test("rejects direct invocation when actor flag does not match caller session", async () => {
    const { run } = setupQuotaRun("spoofed-actor");
    await expect(
      quotaFreezeCommand(
        { run, actor: "mind-1" },
        { authenticatedCaller: { actor: "mind-2", role: "mind", verified: true } },
      ),
    ).rejects.toMatchObject({
      code: "AUTHENTICATION_FAILURE",
    });
  });

  test("rejects direct invocation when caller role is not mind or orchestrator", async () => {
    const { run } = setupQuotaRun("unauthorized-role");
    await expect(
      quotaFreezeCommand(
        { run, actor: "worker" },
        { authenticatedCaller: { actor: "worker", role: "implementer", verified: true } },
      ),
    ).rejects.toMatchObject({
      code: "ROLE_CONFINEMENT_VIOLATION",
    });
  });

  test("rejects via execute when required actor flag is missing", async () => {
    const { run } = setupQuotaRun("cli-missing-actor");
    await expect(execute(["quota:freeze", "--run", run, "--force"])).rejects.toThrow(
      "--actor is required",
    );
  });

  test("rejects via execute when actor has no grant or session", async () => {
    const { run } = setupQuotaRun("cli-ghost-actor");
    await expect(
      execute(["quota:freeze", "--run", run, "--actor", "ghost", "--force"]),
    ).rejects.toThrow();
  });

  test("rejects via execute when actor holds implementer role", async () => {
    const { run } = setupQuotaRun("cli-worker-actor");
    grantRole(run, "worker", "implementer");
    registerSessionGrant({ runRoot: run, agentId: "worker", role: "implementer" });
    await expect(
      execute(["quota:freeze", "--run", run, "--actor", "worker", "--force"]),
    ).rejects.toThrow();
  });

  test("skips freeze and soft exit when quota is healthy and force is false", async () => {
    const { run } = setupQuotaRun("healthy-skip");
    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "healthy",
      isTriggered: false,
      thresholdPercentage: 10,
      lowestRemainingQuota: 85,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: undefined,
      summary: "Quota healthy",
      reasons: [],
    });

    const result = await quotaFreezeCommand(
      { run, actor: "mind" },
      { authenticatedCaller: { actor: "mind", role: "mind", verified: true } },
    );

    expect(result.status).toBe("healthy");
    expect(result.isTriggered).toBe(false);
    expect(vfs.existsSync(join(run, "handoff.md"))).toBe(false);

    breakerSpy.mockRestore();
  });

  test("executes graceful soft exit, creates handoff.md, and snapshots DAG when forced", async () => {
    const { run, repo } = setupQuotaRun("freeze-forced");
    grantRole(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "healthy",
      isTriggered: false,
      thresholdPercentage: 10,
      lowestRemainingQuota: 80,
      constrainedModels: [],
      wrapUpDirectives: [],
      autoWakeSchedule: undefined,
      summary: "All healthy",
      reasons: [],
    });

    const runnerCalls: Array<{ cwd: string; argv: readonly string[] }> = [];
    const mockGitRunner = (cwd: string, argv: readonly string[]) => {
      runnerCalls.push({ cwd, argv });
      if (argv.includes("rev-parse")) {
        return { status: 0, stdout: "commitsha123456\n", stderr: "" };
      }
      return { status: 0, stdout: "", stderr: "" };
    };

    const result = await quotaFreezeCommand(
      { run, actor: "mind", force: true, detailed: true },
      {
        authenticatedCaller: { actor: "mind", role: "mind", verified: true },
        gitRunner: mockGitRunner,
      },
    );

    expect(result.status).toBe("frozen");
    expect(result.snapshot).toBeDefined();
    expect(result.softExit).toBeDefined();
    expect(result.handoffPath).toBe(join(run, "handoff.md"));
    expect(result.stagedCommitSha).toBe("commitsha123456");
    expect(vfs.existsSync(join(run, "handoff.md"))).toBe(true);
    expect(vfs.existsSync(join(repo, ".olt", "quota-dag-snapshot.json"))).toBe(true);

    const handoffText = vfs.readFileSync(join(run, "handoff.md"), "utf-8");
    expect(handoffText).toContain("# Harness handoff");
    expect(handoffText).toContain("80%");

    expect(runnerCalls.some((c) => c.argv.includes("add") && c.argv.includes("-A"))).toBe(true);
    expect(runnerCalls.some((c) => c.argv.includes("commit"))).toBe(true);

    breakerSpy.mockRestore();
  });

  test("executes graceful soft exit with refreshHandoffFn callback", async () => {
    const { run } = setupQuotaRun("freeze-callback");
    grantRole(run, "orchestrator", "orchestrator");
    registerSessionGrant({ runRoot: run, agentId: "orchestrator", role: "orchestrator" });

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "constrained",
      isTriggered: true,
      thresholdPercentage: 10,
      lowestRemainingQuota: 3,
      constrainedModels: [
        { platformId: "anthropic", modelName: "claude-3-5-sonnet", remainingPercentage: 3 },
      ],
      wrapUpDirectives: ["Wrap up running tasks"],
      autoWakeSchedule: {
        targetWakeupIso: new Date(Date.now() + 3600000).toISOString(),
        durationSeconds: 3600,
        timerCondition: "any",
        activeAgentsCount: 0,
      },
      summary: "Quota low",
      reasons: ["Anthropic remaining quota below threshold"],
    });

    let refreshCalledWith: string | undefined;
    const customHandoff = (root: string) => {
      refreshCalledWith = root;
      vfs.writeFileSync(join(root, "handoff.md"), "# Custom Handoff Content\n");
      return join(root, "handoff.md");
    };

    const mockGitRunner = () => ({ status: 0, stdout: "abc123\n", stderr: "" });

    const result = await quotaFreezeCommand(
      { run, actor: "orchestrator" },
      {
        authenticatedCaller: { actor: "orchestrator", role: "orchestrator", verified: true },
        refreshHandoffFn: customHandoff,
        gitRunner: mockGitRunner,
      },
    );

    expect(result.status).toBe("frozen");
    expect(refreshCalledWith).toBe(run);
    expect(vfs.existsSync(join(run, "handoff.md"))).toBe(true);
    expect(vfs.readFileSync(join(run, "handoff.md"), "utf-8")).toContain(
      "# Custom Handoff Content",
    );

    breakerSpy.mockRestore();
  });

  test("freezes and writes handoff via full execute CLI flow for authorized mind caller", async () => {
    const { run, repo } = setupQuotaRun("freeze-cli-full");
    grantRole(run, "mind", "mind");
    registerSessionGrant({ runRoot: run, agentId: "mind", role: "mind" });

    const breakerSpy = spyOn(QuotaCircuitBreaker.prototype, "evaluate").mockReturnValue({
      status: "constrained",
      isTriggered: true,
      thresholdPercentage: 10,
      lowestRemainingQuota: 4,
      constrainedModels: [
        { platformId: "anthropic", modelName: "claude-3-5-sonnet", remainingPercentage: 4 },
      ],
      wrapUpDirectives: ["Wrap up"],
      autoWakeSchedule: {
        targetWakeupIso: new Date(Date.now() + 3600000).toISOString(),
        durationSeconds: 3600,
        timerCondition: "any",
        activeAgentsCount: 0,
      },
      summary: "Quota low",
      reasons: ["Low quota"],
    });

    const res = await execute(["quota:freeze", "--run", run, "--actor", "mind"]);
    expect(res.status).toBe("frozen");
    expect(vfs.existsSync(join(run, "handoff.md"))).toBe(true);
    expect(vfs.existsSync(join(repo, ".olt", "quota-dag-snapshot.json"))).toBe(true);

    breakerSpy.mockRestore();
  });
});
