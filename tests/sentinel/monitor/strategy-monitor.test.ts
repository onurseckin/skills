import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import * as os from "node:os";
import { join } from "node:path";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { discoverActiveTranscripts } from "../../../olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts";
import {
  getInMemoryMailbox,
  clearInMemoryMailboxStore,
} from "../../../olt/scripts/src/communication/mailbox/index.ts";
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
  const scratchDir = "/virtual/sentinel/scratch-strategy-test";
  const transcriptPath = join(scratchDir, "transcript.jsonl");

  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let homedirSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    setInMemoryStrikeMode(true);
    clearInMemoryStrikes();
    clearInMemoryMailboxStore();
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(scratchDir, { recursive: true });
    vfs.writeFileSync(transcriptPath, "", "utf-8");
    session = createVirtualFSSession(vfs);
    homedirSpy = spyOn(os, "homedir").mockReturnValue("/virtual/mock-home");
  });

  afterEach(() => {
    SentinelMonitorRegistry.stopAll();
    setInMemoryStrikeMode(false);
    clearInMemoryStrikes();
    clearInMemoryMailboxStore();
    homedirSpy.mockRestore();
    session.cleanup();
  });

  function writeTranscript(lines: unknown[]): void {
    vfs.writeFileSync(
      transcriptPath,
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf-8",
    );
  }

  function appendTranscript(lines: unknown[]): void {
    const prev = vfs.existsSync(transcriptPath) ? vfs.readFileSync(transcriptPath, "utf-8") : "";
    vfs.writeFileSync(
      transcriptPath,
      prev + lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf-8",
    );
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
    vfs.writeFileSync(
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

    const state = JSON.parse(vfs.readFileSync(statePath, "utf-8")) as {
      agents: { status: string }[];
    };
    expect(state.agents[0]?.status).toBe("quarantined");

    const defects = vfs.readFileSync(join(scratchDir, ".olt", "defects.jsonl"), "utf-8");
    expect(defects).toContain("SUPERVISOR_PROHIBITED_TOOL_EXECUTION");

    const inboxPath = join(scratchDir, ".olt", "mailboxes", "coord-1", "inbox.jsonl");
    const rawMb = getInMemoryMailbox(inboxPath);
    const mbItems = rawMb ? rawMb : [];
    const inbox = vfs.existsSync(inboxPath)
      ? vfs.readFileSync(inboxPath, "utf-8")
      : mbItems.join("\n");
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
    vfs.writeFileSync(transcriptPath, 'call: default_api:edit_file {"file":"foo.ts"}\n', "utf-8");
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
    expect(getStrikeRecord("impl-traversal", scratchDir)?.active_violations[0]?.code).toBe(
      "PATH_TRAVERSAL_ATTACK",
    );
    monitor.stop();
  });

  it("triggers interjection when target path escapes worktree boundary", () => {
    const worktree = join(scratchDir, "worktree");
    vfs.mkdirSync(worktree, { recursive: true });
    writeTranscript([
      {
        tool_calls: [
          { name: "write_to_file", args: { TargetFile: join(scratchDir, "escape.ts") } },
        ],
      },
    ]);
    const monitor = makeMonitor("implementer", "impl-escape", { targetWorktree: worktree });
    monitor.pollNow();
    expect(getStrikeRecord("impl-escape", scratchDir)?.active_violations[0]?.code).toBe(
      "PATH_TRAVERSAL_ATTACK",
    );
    monitor.stop();
  });

  it("triggers interjection on filesystem mutation outside writeScope", () => {
    const worktree = join(scratchDir, "fs-worktree");
    vfs.mkdirSync(worktree, { recursive: true });
    const monitor = makeMonitor("implementer", "impl-fs", {
      targetWorktree: worktree,
      writeScope: ["src/"],
    });
    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);
    expect(session.getWatcherCallback !== undefined).toBe(true);

    vfs.writeFileSync(join(worktree, "config.json"), "{}", "utf-8");
    if (session.dispatchWatcherEvent) session.dispatchWatcherEvent("change", "config.json");

    expect(getStrikeRecord("impl-fs", scratchDir)?.active_violations[0]?.code).toBe(
      "OUT_OF_SCOPE_MUTATION",
    );
    monitor.stop();
  });

  it("handles burst of 10 transcript events incrementally", () => {
    const monitor = makeMonitor("implementer", "impl-burst");
    monitor.pollNow();
    appendTranscript(
      Array.from({ length: 10 }, (_, i) => ({
        step: i,
        tool_calls: [{ name: "view_file", args: { path: `src/f${i}.ts` } }],
      })),
    );
    monitor.pollNow();
    expect(getStrikeRecord("impl-burst", scratchDir)).toBeNull();
    monitor.stop();
  });

  it("handles partial, empty, and malformed lines without crashing", () => {
    const monitor = makeMonitor("coordinator", "coord-malformed");
    const prev = vfs.existsSync(transcriptPath) ? vfs.readFileSync(transcriptPath, "utf-8") : "";
    vfs.writeFileSync(transcriptPath, prev + "\n\n{broken\n", "utf-8");
    expect(() => monitor.pollNow()).not.toThrow();
    appendTranscript([{ tool_calls: [{ name: "run_command" }] }]);
    expect(() => monitor.pollNow()).not.toThrow();
    expect(getStrikeRecord("coord-malformed", scratchDir)).not.toBeNull();
    monitor.stop();
  });

  it("transitions agent status to quarantined in state.json", () => {
    const statePath = join(scratchDir, "state.json");
    vfs.writeFileSync(
      statePath,
      JSON.stringify({ agents: [{ id: "quarantine-me", role: "coordinator", status: "active" }] }),
      "utf-8",
    );
    writeTranscript([{ tool_calls: [{ name: "exec", args: { cmd: "id" } }] }]);
    const monitor = makeMonitor("coordinator", "quarantine-me");
    monitor.pollNow();
    const state = JSON.parse(vfs.readFileSync(statePath, "utf-8")) as {
      agents: { status: string }[];
    };
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
    expect(vfs.existsSync(file)).toBe(true);
    const desc = JSON.parse(vfs.readFileSync(file, "utf-8")) as { agentId: string }[];
    expect(desc[0]?.agentId).toBe("reg-agent");
    SentinelMonitorRegistry.unregister("reg-agent");
    expect(SentinelMonitorRegistry.get("reg-agent")).toBeUndefined();
    expect(SentinelMonitorRegistry.list().length).toBe(0);
  });

  it("discovers valid host transcripts and ignores invalid ones", () => {
    const logDir = join(scratchDir, ".system_generated", "logs");
    vfs.mkdirSync(logDir, { recursive: true });
    const transcript = join(logDir, "transcript.jsonl");
    vfs.writeFileSync(transcript, "{}\n", "utf-8");
    const dummy = join(logDir, "not-a-transcript.log");
    vfs.writeFileSync(dummy, "dummy\n", "utf-8");

    const disc = discoverActiveTranscripts(scratchDir);
    expect(disc).toContain(transcript);
    expect(disc).not.toContain(dummy);
    expect(disc.every((p) => p.endsWith("transcript.jsonl") && vfs.existsSync(p))).toBe(true);
  });

  it("reassembles fragmented stream across polling ticks before triggering strike", () => {
    const monitor = makeMonitor("coordinator", "coord-fragment");
    vfs.writeFileSync(transcriptPath, '{"tool_calls": [{"name": "run_', "utf-8");
    monitor.pollNow();
    expect(getStrikeRecord("coord-fragment", scratchDir)).toBeNull();

    const prev = vfs.readFileSync(transcriptPath, "utf-8");
    vfs.writeFileSync(
      transcriptPath,
      prev + 'command", "args": {"CommandLine": "whoami"}}]}\n',
      "utf-8",
    );
    monitor.pollNow();
    expect(getStrikeRecord("coord-fragment", scratchDir)?.active_violations[0]?.code).toBe(
      "SUPERVISOR_PROHIBITED_TOOL_EXECUTION",
    );
    monitor.stop();
  });

  it("triggers interjection on complex nested path traversal attack", () => {
    writeTranscript([
      {
        tool_calls: [
          { name: "write_to_file", args: { targetPath: "subdir/nested/../../../escape.ts" } },
        ],
      },
    ]);
    const monitor = makeMonitor("implementer", "impl-nested-traversal");
    monitor.pollNow();
    expect(getStrikeRecord("impl-nested-traversal", scratchDir)?.active_violations[0]?.code).toBe(
      "PATH_TRAVERSAL_ATTACK",
    );
    monitor.stop();
  });

  it("ignores file mutations in .git, .olt/locks, and declared writeScope in watcher", () => {
    const worktree = join(scratchDir, "fs-safe-worktree");
    vfs.mkdirSync(worktree, { recursive: true });
    const monitor = makeMonitor("implementer", "impl-safe-fs", {
      targetWorktree: worktree,
      writeScope: ["src/"],
    });
    monitor.start();
    expect(session.getWatcherCallback !== undefined).toBe(true);

    if (session.dispatchWatcherEvent) {
      session.dispatchWatcherEvent("change", ".git/HEAD");
      session.dispatchWatcherEvent("change", ".olt/locks/agent.lock");
      session.dispatchWatcherEvent("change", "src/nested/component.ts");
    }

    expect(getStrikeRecord("impl-safe-fs", scratchDir)).toBeNull();
    monitor.stop();
  });
});
