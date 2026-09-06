import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { discoverActiveTranscripts } from "../../../olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts";
import {
  LiveStrategyMonitorImpl,
  SentinelMonitorRegistry,
  type CreateMonitorOptions,
} from "../../../olt/scripts/src/sentinel/monitor/index.ts";
import {
  clearInMemoryStrikes,
  getStrikeRecord,
  setInMemoryStrikeMode,
  type AgentRole,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("LiveStrategyMonitor & SentinelMonitorRegistry Probes", () => {
  const scratchDir = join(process.cwd(), ".olt", "scratch-strategy-test");
  const transcriptPath = join(scratchDir, "transcript.jsonl");

  beforeEach(() => {
    setInMemoryStrikeMode(true);
    clearInMemoryStrikes();
    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true });
    mkdirSync(scratchDir, { recursive: true });
    writeFileSync(transcriptPath, "", "utf-8");
  });

  afterEach(() => {
    SentinelMonitorRegistry.stopAll();
    setInMemoryStrikeMode(false);
    clearInMemoryStrikes();
    if (existsSync(scratchDir)) rmSync(scratchDir, { recursive: true, force: true });
  });

  function writeTranscript(lines: unknown[]): void {
    writeFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  }

  function appendTranscript(lines: unknown[]): void {
    appendFileSync(transcriptPath, lines.map((l) => JSON.stringify(l)).join("\n") + "\n", "utf-8");
  }

  function makeMonitor(
    role: AgentRole = "coordinator",
    agentId = "test-agent",
    extra?: Partial<CreateMonitorOptions>,
  ): LiveStrategyMonitorImpl {
    return new LiveStrategyMonitorImpl({
      agentId,
      role,
      transcriptPath,
      repoRoot: scratchDir,
      parentSupervisor: "mind",
      autoStart: false,
      ...extra,
    });
  }

  it("triggers instant interjection and full strike escalation when coordinator invokes run_command", () => {
    const statePath = join(scratchDir, "state.json");
    writeFileSync(
      statePath,
      JSON.stringify({ agents: [{ id: "coord-1", role: "coordinator", status: "active" }] }),
      "utf-8",
    );
    writeTranscript([
      { step_index: 1, tool_calls: [{ name: "run_command", args: { CommandLine: "ls" } }] },
    ]);
    const monitor = makeMonitor("coordinator", "coord-1");
    monitor.pollNow();

    const strike = getStrikeRecord("coord-1", scratchDir);
    expect(strike?.strike_count).toBeGreaterThan(0);
    expect(strike?.active_violations[0]?.code).toBe("SUPERVISOR_PROHIBITED_TOOL_EXECUTION");

    const state = JSON.parse(readFileSync(statePath, "utf-8")) as { agents: { status: string }[] };
    expect(state.agents[0]?.status).toBe("quarantined");

    const defects = readFileSync(join(scratchDir, ".olt", "defects.jsonl"), "utf-8");
    expect(defects).toContain("SUPERVISOR_PROHIBITED_TOOL_EXECUTION");

    const inbox = readFileSync(
      join(scratchDir, ".olt", "mailboxes", "coord-1", "inbox.jsonl"),
      "utf-8",
    );
    expect(inbox).toContain("EMERGENCY_HALT");
    monitor.stop();
  });

  it("triggers interjection when orchestrator invokes shell", () => {
    writeTranscript([{ tool_calls: [{ name: "shell", args: { cmd: "pwd" } }] }]);
    const monitor = makeMonitor("orchestrator", "orch-1");
    monitor.pollNow();
    expect(getStrikeRecord("orch-1", scratchDir)?.active_violations[0]?.code).toBe(
      "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
    );
    monitor.stop();
  });

  it("triggers interjection when mind invokes execute_command or exec", () => {
    writeTranscript([{ tool_calls: [{ name: "execute_command", args: { cmd: "whoami" } }] }]);
    const monitor = makeMonitor("mind", "mind-1");
    monitor.pollNow();
    expect(getStrikeRecord("mind-1", scratchDir)?.active_violations[0]?.code).toBe(
      "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
    );
    monitor.stop();
  });

  it("triggers interjection when supervisor invokes file modification tools", () => {
    writeTranscript([{ tool_calls: [{ name: "write_to_file", args: { TargetFile: "foo.ts" } }] }]);
    const monitor = makeMonitor("coordinator", "coord-mod");
    monitor.pollNow();
    expect(getStrikeRecord("coord-mod", scratchDir)?.active_violations[0]?.code).toBe(
      "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
    );
    monitor.stop();
  });

  it("detects prohibited tools in plain text transcript via regex", () => {
    writeFileSync(transcriptPath, 'call: default_api:edit_file {"file":"foo.ts"}\n', "utf-8");
    const monitor = makeMonitor("coordinator", "coord-plain");
    monitor.pollNow();
    expect(getStrikeRecord("coord-plain", scratchDir)?.active_violations[0]?.code).toBe(
      "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
    );
    monitor.stop();
  });

  it("permits implementer to run execution and write tools within scope", () => {
    writeTranscript([
      { tool_calls: [{ name: "run_command", args: { CommandLine: "bun test" } }] },
      { tool_calls: [{ name: "write_to_file", args: { TargetFile: "src/app.ts" } }] },
    ]);
    const monitor = makeMonitor("implementer", "impl-ok", { writeScope: ["src/"] });
    monitor.pollNow();
    expect(getStrikeRecord("impl-ok", scratchDir)).toBeNull();
    monitor.stop();
  });

  it("permits validator to run execution tools within scope without strike", () => {
    writeTranscript([{ tool_calls: [{ name: "run_command", args: { CommandLine: "bun test" } }] }]);
    const monitor = makeMonitor("validator", "val-ok");
    monitor.pollNow();
    expect(getStrikeRecord("val-ok", scratchDir)).toBeNull();
    monitor.stop();
  });

  it("triggers interjection on path traversal attack in transcript targetPath", () => {
    writeTranscript([
      { tool_calls: [{ name: "write_to_file", args: { targetPath: "../outside/secret.ts" } }] },
    ]);
    const monitor = makeMonitor("implementer", "impl-traversal");
    monitor.pollNow();
    const strike = getStrikeRecord("impl-traversal", scratchDir);
    expect(strike?.active_violations[0]?.code).toBe("PATH_TRAVERSAL_ATTACK");
    monitor.stop();
  });

  it("triggers interjection when target path escapes worktree boundary", () => {
    const worktree = join(scratchDir, "worktree");
    mkdirSync(worktree, { recursive: true });
    writeTranscript([
      {
        tool_calls: [
          { name: "write_to_file", args: { TargetFile: join(scratchDir, "escape.ts") } },
        ],
      },
    ]);
    const monitor = makeMonitor("implementer", "impl-escape", { targetWorktree: worktree });
    monitor.pollNow();
    const strike = getStrikeRecord("impl-escape", scratchDir);
    expect(strike?.active_violations[0]?.code).toBe("PATH_TRAVERSAL_ATTACK");
    monitor.stop();
  });

  it("triggers interjection on filesystem mutation outside writeScope", async () => {
    const worktree = join(scratchDir, "fs-worktree");
    mkdirSync(worktree, { recursive: true });
    const monitor = makeMonitor("implementer", "impl-fs", {
      targetWorktree: worktree,
      writeScope: ["src/"],
    });
    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
    writeFileSync(join(worktree, "config.json"), "{}", "utf-8");
    for (let i = 0; i < 20; i++) {
      if (getStrikeRecord("impl-fs", scratchDir)) break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    monitor.stop();
    const strike = getStrikeRecord("impl-fs", scratchDir);
    expect(strike?.active_violations[0]?.code).toBe("OUT_OF_SCOPE_MUTATION");
  });

  it("handles burst of 10 transcript events incrementally", () => {
    const monitor = makeMonitor("implementer", "impl-burst");
    monitor.pollNow();
    const burst = Array.from({ length: 10 }, (_, i) => ({
      step: i,
      tool_calls: [{ name: "view_file", args: { path: `src/f${i}.ts` } }],
    }));
    appendTranscript(burst);
    monitor.pollNow();
    expect(getStrikeRecord("impl-burst", scratchDir)).toBeNull();
    monitor.stop();
  });

  it("handles partial, empty, and malformed lines without crashing", () => {
    const monitor = makeMonitor("coordinator", "coord-malformed");
    appendFileSync(transcriptPath, "\n\n{broken\n", "utf-8");
    expect(() => monitor.pollNow()).not.toThrow();
    appendTranscript([{ tool_calls: [{ name: "run_command" }] }]);
    expect(() => monitor.pollNow()).not.toThrow();
    expect(getStrikeRecord("coord-malformed", scratchDir)).not.toBeNull();
    monitor.stop();
  });

  it("transitions agent status to quarantined in state.json", () => {
    const statePath = join(scratchDir, "state.json");
    writeFileSync(
      statePath,
      JSON.stringify({ agents: [{ id: "quarantine-me", role: "coordinator", status: "active" }] }),
      "utf-8",
    );
    writeTranscript([{ tool_calls: [{ name: "exec", args: { cmd: "id" } }] }]);
    const monitor = makeMonitor("coordinator", "quarantine-me");
    monitor.pollNow();
    const state = JSON.parse(readFileSync(statePath, "utf-8")) as { agents: { status: string }[] };
    expect(state.agents[0]?.status).toBe("quarantined");
    monitor.stop();
  });

  it("terminates watcher on stop and ensures pollNow after stop is a no-op", () => {
    const monitor = makeMonitor("coordinator", "coord-teardown");
    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);
    monitor.stop();
    expect(monitor.isMonitoring()).toBe(false);
    writeTranscript([{ tool_calls: [{ name: "run_command" }] }]);
    monitor.pollNow();
    expect(getStrikeRecord("coord-teardown", scratchDir)).toBeNull();
  });

  it("synchronizes registry state with .olt/sentinel-monitors.json", () => {
    const monitor = SentinelMonitorRegistry.register({
      agentId: "reg-agent",
      role: "coordinator",
      transcriptPath,
      repoRoot: scratchDir,
      autoStart: false,
    });
    expect(SentinelMonitorRegistry.get("reg-agent")).toBe(monitor);
    expect(SentinelMonitorRegistry.list().length).toBe(1);
    const file = join(scratchDir, ".olt", "sentinel-monitors.json");
    expect(existsSync(file)).toBe(true);
    const desc = JSON.parse(readFileSync(file, "utf-8")) as { agentId: string }[];
    expect(desc[0]?.agentId).toBe("reg-agent");
    SentinelMonitorRegistry.unregister("reg-agent");
    expect(SentinelMonitorRegistry.get("reg-agent")).toBeUndefined();
    expect(SentinelMonitorRegistry.list().length).toBe(0);
  });

  it("discovers valid host transcripts and ignores invalid ones", () => {
    const logDir = join(scratchDir, ".system_generated", "logs");
    mkdirSync(logDir, { recursive: true });
    const transcript = join(logDir, "transcript.jsonl");
    writeFileSync(transcript, "{}\n", "utf-8");

    const dummy = join(logDir, "not-a-transcript.log");
    writeFileSync(dummy, "dummy\n", "utf-8");

    const disc = discoverActiveTranscripts(scratchDir);
    expect(disc).toContain(transcript);
    expect(disc).not.toContain(dummy);
    expect(disc.every((p) => p.endsWith("transcript.jsonl") && existsSync(p))).toBe(true);
  });
});
