import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { discoverActiveTranscripts } from "../../../olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts";
import {
  LiveStrategyMonitorImpl,
  SentinelMonitorRegistry,
} from "../../../olt/scripts/src/sentinel/monitor/index.ts";
import {
  clearInMemoryStrikes,
  getStrikeRecord,
  setInMemoryStrikeMode,
} from "../../../olt/scripts/src/sentinel/index.ts";

describe("LiveStrategyMonitor & SentinelMonitorRegistry", () => {
  const scratchDir = join(process.cwd(), ".olt", "scratch-monitor-test");

  beforeEach(() => {
    setInMemoryStrikeMode(true);
    clearInMemoryStrikes();
    if (existsSync(scratchDir)) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
    mkdirSync(scratchDir, { recursive: true });
  });

  afterEach(() => {
    SentinelMonitorRegistry.stopAll();
    setInMemoryStrikeMode(false);
    clearInMemoryStrikes();
    if (existsSync(scratchDir)) {
      rmSync(scratchDir, { recursive: true, force: true });
    }
  });

  it("registers, lists, and unregisters monitors with descriptor sync", () => {
    const transcriptPath = join(scratchDir, "transcript.jsonl");
    writeFileSync(transcriptPath, "", "utf-8");

    const monitor = SentinelMonitorRegistry.register({
      agentId: "test-coord-1",
      role: "coordinator",
      transcriptPath,
      repoRoot: scratchDir,
      autoStart: false,
    });

    expect(SentinelMonitorRegistry.get("test-coord-1")).toBe(monitor);
    expect(SentinelMonitorRegistry.list().length).toBe(1);

    const monitorsFile = join(scratchDir, ".olt", "sentinel-monitors.json");
    expect(existsSync(monitorsFile)).toBe(true);

    const descriptors = JSON.parse(readFileSync(monitorsFile, "utf-8")) as readonly {
      agentId: string;
    }[];
    expect(descriptors.length).toBe(1);
    expect(descriptors[0]?.agentId).toBe("test-coord-1");

    SentinelMonitorRegistry.unregister("test-coord-1");
    expect(SentinelMonitorRegistry.get("test-coord-1")).toBeUndefined();
    expect(SentinelMonitorRegistry.list().length).toBe(0);
  });

  it("triggers instant interjection when supervisor invokes prohibited execution tool", () => {
    const transcriptPath = join(scratchDir, "transcript.jsonl");
    writeFileSync(transcriptPath, "", "utf-8");

    const statePath = join(scratchDir, "state.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        schema: "harness.state",
        agents: [{ id: "coord-rogue", role: "coordinator", status: "active" }],
      }),
      "utf-8",
    );

    const monitor = new LiveStrategyMonitorImpl({
      agentId: "coord-rogue",
      role: "coordinator",
      transcriptPath,
      repoRoot: scratchDir,
      parentSupervisor: "mind",
      autoStart: false,
    });

    monitor.pollNow();
    expect(monitor.isMonitoring()).toBe(false);

    writeFileSync(
      transcriptPath,
      JSON.stringify({
        step_index: 1,
        tool_calls: [{ name: "run_command", args: { CommandLine: "ls" } }],
      }) + "\n",
      "utf-8",
    );

    monitor.pollNow();

    const strike = getStrikeRecord("coord-rogue", scratchDir);
    expect(strike).not.toBeNull();
    expect(strike?.strike_count).toBeGreaterThan(0);
    expect(strike?.active_violations[0]?.code).toBe("SUPERVISOR_PROHIBITED_TOOL_EXECUTION");

    const updatedState = JSON.parse(readFileSync(statePath, "utf-8")) as {
      agents: { id: string; status: string }[];
    };
    expect(updatedState.agents[0]?.status).toBe("quarantined");

    const defectsFile = join(scratchDir, ".olt", "defects.jsonl");
    expect(existsSync(defectsFile)).toBe(true);
    const defectContent = readFileSync(defectsFile, "utf-8");
    expect(defectContent).toContain("SUPERVISOR_PROHIBITED_TOOL_EXECUTION");
    expect(defectContent).toContain("coord-rogue");

    monitor.stop();
  });

  it("permits implementer to invoke execution and write tools without interjection", () => {
    const transcriptPath = join(scratchDir, "transcript.jsonl");
    writeFileSync(
      transcriptPath,
      JSON.stringify({
        step_index: 1,
        tool_calls: [{ name: "write_to_file", args: { TargetFile: "foo.ts" } }],
      }) + "\n",
      "utf-8",
    );

    const monitor = new LiveStrategyMonitorImpl({
      agentId: "impl-valid",
      role: "implementer",
      transcriptPath,
      repoRoot: scratchDir,
      autoStart: false,
    });

    monitor.pollNow();

    const strike = getStrikeRecord("impl-valid", scratchDir);
    expect(strike).toBeNull();
    monitor.stop();
  });

  it("triggers interjection on file mutation outside write scope", () => {
    const targetWorktree = join(scratchDir, "worktree");
    mkdirSync(targetWorktree, { recursive: true });
    const transcriptPath = join(scratchDir, "transcript.jsonl");
    writeFileSync(transcriptPath, "", "utf-8");

    const monitor = new LiveStrategyMonitorImpl({
      agentId: "impl-scope-breaker",
      role: "implementer",
      transcriptPath,
      targetWorktree,
      writeScope: ["src/allowed/"],
      repoRoot: scratchDir,
      autoStart: false,
    });

    monitor.start();
    expect(monitor.isMonitoring()).toBe(true);

    monitor.stop();
    expect(monitor.isMonitoring()).toBe(false);
  });

  it("discoverActiveTranscripts returns existing transcripts", () => {
    const localLogs = join(scratchDir, ".system_generated", "logs");
    mkdirSync(localLogs, { recursive: true });
    const transcriptFile = join(localLogs, "transcript.jsonl");
    writeFileSync(transcriptFile, "{}\n", "utf-8");

    const discovered = discoverActiveTranscripts(scratchDir);
    expect(discovered).toContain(transcriptFile);
  });
});
