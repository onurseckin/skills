import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { execute } from "../../../../../olt/scripts/src/cli/execute.ts";
import { revokeSessionGrant } from "../../../../../olt/scripts/src/authority/session/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../../../olt/scripts/src/runtime/session.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  setupVirtualCliFS,
} from "../../fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../fixtures/task-ops-fixture.ts";

const roots: string[] = [];
beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
});

afterEach(async () => {
  disableInMemoryAgentMetadata();
  clearCallerSession();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

function clearCallerSession(run?: string, agentId = "coordinator-1"): void {
  revokeSessionGrant({ runRoot: run, agentId, pid: process.pid, ppid: process.ppid });
  if (run) revokeSessionGrant({ agentId, pid: process.pid, ppid: process.ppid });
}

function registrationBytes(run: string, agentId: string): Record<string, string | null> {
  const sessionPath = join(run, "runtime", "sessions", `${agentId}.json`);
  return {
    events: readFileSync(join(run, "events.jsonl"), "utf8"),
    state: readFileSync(join(run, "state.json"), "utf8"),
    session: existsSync(sessionPath) ? readFileSync(sessionPath, "utf8") : null,
  };
}

describe("agent:register - Authentication and Validation", () => {
  test("refuses an unauthenticated claimed parent before minting child grant", async () => {
    const { run } = await setupCompiledRun("agent-register-no-session-parent", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    clearCallerSession(run);
    const before = registrationBytes(run, "worker-stolen");

    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-stolen",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "coordinator-1",
        "--actor",
        "coordinator-1",
      ]),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILURE" });

    expect(registrationBytes(run, "worker-stolen")).toEqual(before);
  });

  test("refuses omitted and unparented non-genesis registration", async () => {
    const { run } = await setupCompiledRun("agent-register-no-session-variants", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    clearCallerSession(run);
    const before = registrationBytes(run, "worker-no-session");

    for (const args of [
      ["--parent-agent", "coordinator-1"],
      ["--actor", "coordinator-1"],
    ]) {
      await expect(
        execute([
          "agent:register",
          "--run",
          run,
          "--agent",
          "worker-no-session",
          "--role",
          "implementer",
          "--host",
          "claude-code",
          ...args,
        ]),
      ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILURE" });
      expect(registrationBytes(run, "worker-no-session")).toEqual(before);
    }
  });

  test("binds registration to a verified parent session even when --run-id names run", async () => {
    const { run } = await setupCompiledRun("agent-register-run-id-session", roots);
    await execute([
      "agent:register",
      "--run",
      run,
      "--agent",
      "coordinator-1",
      "--role",
      "coordinator",
      "--host",
      "claude-code",
    ]);
    clearCallerSession(run);
    const before = registrationBytes(run, "worker-run-id");

    await expect(
      execute([
        "agent:register",
        "--run-id",
        run,
        "--agent",
        "worker-run-id",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--parent-agent",
        "coordinator-1",
        "--actor",
        "coordinator-1",
      ]),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_FAILURE" });
    expect(registrationBytes(run, "worker-run-id")).toEqual(before);
  });

  test("rejects an unrecognized --role", async () => {
    const { run } = await setupCompiledRun("agent-register-bad-role", roots);
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "not-a-role",
        "--host",
        "claude-code",
      ]),
    ).rejects.toThrow("--role must be one of");
  });

  test("rejects an unrecognized --model-tier", async () => {
    const { run } = await setupCompiledRun("agent-register-bad-tier", roots);
    await expect(
      execute([
        "agent:register",
        "--run",
        run,
        "--agent",
        "worker-1",
        "--role",
        "implementer",
        "--host",
        "claude-code",
        "--model-tier",
        "xxl",
      ]),
    ).rejects.toThrow("--model-tier must be one of");
  });
});
