import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as os from "node:os";
import { join } from "node:path";
import { execute } from "../../../olt/scripts/src/cli/execute.ts";
import {
  registerSessionGrant,
  revokeSessionGrant,
} from "../../../olt/scripts/src/authority/session/index.ts";
import {
  disableInMemoryAgentMetadata,
  enableInMemoryAgentMetadata,
} from "../../../olt/scripts/src/runtime/session.ts";
import {
  cleanupRoots,
  cleanupVirtualCliFS,
  getVirtualCliFS,
  setupVirtualCliFS,
} from "../../cli/commands/fixtures/full-lifecycle-fixture.ts";
import { setupCompiledRun } from "../../cli/commands/fixtures/task-ops-fixture.ts";
import {
  LiveStrategyMonitorImpl,
  SentinelMonitorRegistry,
} from "../../../olt/scripts/src/sentinel/monitor/index.ts";
import {
  clearInMemoryStrikes,
  setInMemoryStrikeMode,
} from "../../../olt/scripts/src/sentinel/index.ts";

const roots: string[] = [];
const SESSION_ID = "sentinel-registration-lifecycle-session";
const HOME_DIR = "/virtual/mock-home";
const PROJECT_SLUG = "sentinel-lifecycle-project";
let homedirSpy: ReturnType<typeof spyOn>;
let previousHome: string | undefined;

function transcriptPathFor(agentId: string): string {
  return join(
    HOME_DIR,
    ".claude",
    "projects",
    PROJECT_SLUG,
    SESSION_ID,
    "subagents",
    `agent-${agentId}.jsonl`,
  );
}

function seedTranscript(agentId: string): void {
  const vfs = getVirtualCliFS();
  const path = transcriptPathFor(agentId);
  vfs.mkdirSync(join(path, ".."), { recursive: true });
  vfs.writeFileSync(path, "", "utf-8");
}

async function registerCoordAndWorker(run: string): Promise<void> {
  seedTranscript("coordinator-1");
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
  registerSessionGrant({
    runRoot: run,
    agentId: "coordinator-1",
    role: "coordinator",
    host: "claude-code",
  });
  seedTranscript("worker-1");
  await execute([
    "agent:register",
    "--run",
    run,
    "--agent",
    "worker-1",
    "--role",
    "implementer",
    "--host",
    "claude-code",
    "--parent-agent",
    "coordinator-1",
    "--actor",
    "coordinator-1",
  ]);
}

beforeEach(() => {
  setupVirtualCliFS();
  enableInMemoryAgentMetadata();
  setInMemoryStrikeMode(true);
  clearInMemoryStrikes();
  process.env.CLAUDE_CODE_SESSION_ID = SESSION_ID;
  previousHome = process.env.HOME;
  process.env.HOME = HOME_DIR;
  homedirSpy = spyOn(os, "homedir").mockReturnValue(HOME_DIR);
});

afterEach(async () => {
  SentinelMonitorRegistry.stopAll();
  homedirSpy.mockRestore();
  delete process.env.CLAUDE_CODE_SESSION_ID;
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  setInMemoryStrikeMode(false);
  clearInMemoryStrikes();
  revokeSessionGrant({ agentId: "coordinator-1", pid: process.pid, ppid: process.ppid });
  disableInMemoryAgentMetadata();
  await cleanupRoots(roots);
  cleanupVirtualCliFS();
  roots.length = 0;
});

describe("Sentinel monitor registration lifecycle", () => {
  test("agent:register starts a live monitor bound to the agent's transcript", async () => {
    const { run } = await setupCompiledRun("agent-sentinel-register-starts-monitor", roots);
    await registerCoordAndWorker(run);

    const monitor = SentinelMonitorRegistry.get("worker-1");
    expect(monitor).toBeDefined();
    expect(monitor?.isMonitoring()).toBe(true);
    expect(monitor?.transcriptPath).toBe(transcriptPathFor("worker-1"));

    const coordinatorMonitor = SentinelMonitorRegistry.get("coordinator-1");
    expect(coordinatorMonitor?.isMonitoring()).toBe(true);
  });

  test("agent:release stops and de-registers the agent's monitor", async () => {
    const { run } = await setupCompiledRun("agent-sentinel-release-stops-monitor", roots);
    await registerCoordAndWorker(run);
    expect(SentinelMonitorRegistry.get("worker-1")?.isMonitoring()).toBe(true);

    await execute([
      "agent:release",
      "--run",
      run,
      "--agent",
      "worker-1",
      "--reason",
      "task complete",
    ]);

    expect(SentinelMonitorRegistry.get("worker-1")).toBeUndefined();
    expect(SentinelMonitorRegistry.get("coordinator-1")?.isMonitoring()).toBe(true);
  });

  test("double-registering the same agent id does not double-start the monitor", () => {
    const startSpy = spyOn(LiveStrategyMonitorImpl.prototype, "start");
    const vfs = getVirtualCliFS();
    const transcriptPath = "/virtual/sentinel/double-register/transcript.jsonl";
    vfs.mkdirSync("/virtual/sentinel/double-register", { recursive: true });
    vfs.writeFileSync(transcriptPath, "", "utf-8");

    const first = SentinelMonitorRegistry.register({
      agentId: "double-register-agent",
      role: "implementer",
      transcriptPath,
    });
    const second = SentinelMonitorRegistry.register({
      agentId: "double-register-agent",
      role: "implementer",
      transcriptPath,
    });

    expect(second).toBe(first);
    expect(startSpy).toHaveBeenCalledTimes(1);
    startSpy.mockRestore();
  });
});
