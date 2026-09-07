import { describe, it, expect, beforeEach, afterEach, spyOn } from "bun:test";
import * as os from "node:os";
import { join } from "node:path";
import {
  VirtualMemoryFS,
  createVirtualFSSession,
  type VirtualFSSession,
} from "../../../olt/scripts/src/testing/virtual-fs/index.ts";
import { discoverActiveTranscripts } from "../../../olt/scripts/src/mind/auditing/meta/timeline.ts";
import { SkillAuditorEngine } from "../../../olt/scripts/src/mind/auditing/cognitive/skill-auditor.ts";
import { SentinelMonitorRegistry } from "../../../olt/scripts/src/sentinel/monitor/registry.ts";
import * as mailbox from "../../../olt/scripts/src/communication/mailbox/index.ts";

describe("SkillAuditor Transcript Discovery & Live Monitor Interjection", () => {
  const TEST_ROOT = "/virtual/sentinel/auditor-discovery-test";
  const LOCAL_LOGS = join(TEST_ROOT, ".system_generated", "logs");
  let vfs: VirtualMemoryFS;
  let session: VirtualFSSession;
  let homedirSpy: ReturnType<typeof spyOn>;
  let dispatchSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    vfs = new VirtualMemoryFS();
    vfs.mkdirSync(LOCAL_LOGS, { recursive: true });
    session = createVirtualFSSession(vfs);
    homedirSpy = spyOn(os, "homedir").mockReturnValue("/virtual/mock-home");
    dispatchSpy = spyOn(mailbox, "dispatchPeerMessage").mockImplementation(() => {});
    SentinelMonitorRegistry.stopAll();
  });

  afterEach(() => {
    SentinelMonitorRegistry.stopAll();
    dispatchSpy.mockRestore();
    homedirSpy.mockRestore();
    session.cleanup();
  });

  it("should discover active transcript.jsonl and attach live monitors that trigger interjection", () => {
    const transcriptPath = join(LOCAL_LOGS, "transcript.jsonl");
    vfs.writeFileSync(
      transcriptPath,
      `{"name": "write_to_file", "parameters": {"TargetFile": "test.txt"}}\n`,
    );

    const transcripts = discoverActiveTranscripts(TEST_ROOT);
    expect(transcripts).toContain(transcriptPath);

    // This will attach the monitor
    SkillAuditorEngine.auditSkillCompliance(TEST_ROOT, {
      transcripts: [transcriptPath],
      capsuleRunRoot: TEST_ROOT,
    });

    const agentId = `skill-auditor-host-${transcriptPath}`;
    const monitor = SentinelMonitorRegistry.get(agentId);
    expect(monitor).toBeDefined();

    // Trigger the monitor parser to simulate realtime discovery
    if (monitor && monitor.onLineParsed) {
      monitor.onLineParsed(`[{"name": "write_to_file", "parameters": {"TargetFile": "foo.txt"}}]`);
    }

    expect(dispatchSpy).toHaveBeenCalled();
    const calls = dispatchSpy.mock.calls;
    const interjection = calls.find(
      (c) => c[0].payload?.action === "INTERJECT_HALT_DIRECT_EXECUTION",
    );
    expect(interjection).toBeDefined();
    if (!interjection) throw new Error("Expected interjection to be defined");
    const envelope = interjection[0];
    expect(envelope.messageType).toBe("DEFECT_ESCALATION");
    expect(envelope.recipientRoleOrId).toBe("coordinator");
    expect(envelope.payload.category).toBe("ROLE_BOUNDARY_DEVIATION");
    expect(envelope.payload.severity).toBe("CRITICAL");
    expect(envelope.payload.directive).toBe("HALT_DIRECT_EDITS_AND_DISPATCH_SUBAGENTS");
    expect(envelope.payload.observation).toContain("Direct file mutation");
  });

  it("handles corrupted, empty, and malformed transcript.jsonl gracefully without throwing", () => {
    const transcriptPath = join(LOCAL_LOGS, "transcript.jsonl");
    vfs.writeFileSync(transcriptPath, '\n\n{broken-json-not-valid\n{"tool": unclosed\n');

    const transcripts = discoverActiveTranscripts(TEST_ROOT);
    expect(transcripts).toContain(transcriptPath);

    expect(() => {
      SkillAuditorEngine.auditSkillCompliance(TEST_ROOT, {
        transcripts: [transcriptPath],
        capsuleRunRoot: TEST_ROOT,
      });
    }).not.toThrow();

    const agentId = `skill-auditor-host-${transcriptPath}`;
    const monitor = SentinelMonitorRegistry.get(agentId);
    expect(monitor).toBeDefined();

    // Verify feeding malformed chunk to onLineParsed does not crash
    expect(() => {
      monitor?.onLineParsed?.("malformed non-json stream fragment");
    }).not.toThrow();
  });

  it("attaches live monitor but does not trigger interjection on benign read-only operations", () => {
    const transcriptPath = join(LOCAL_LOGS, "transcript.jsonl");
    vfs.writeFileSync(
      transcriptPath,
      `[{"name": "view_file", "parameters": {"AbsolutePath": "src/index.ts"}}]\n`,
    );

    SkillAuditorEngine.auditSkillCompliance(TEST_ROOT, {
      transcripts: [transcriptPath],
      capsuleRunRoot: TEST_ROOT,
    });

    const agentId = `skill-auditor-host-${transcriptPath}`;
    const monitor = SentinelMonitorRegistry.get(agentId);
    expect(monitor).toBeDefined();

    // Simulate benign read / inspect events
    monitor?.onLineParsed?.(`[{"name": "list_dir", "parameters": {"DirectoryPath": "src"}}]`);
    monitor?.onLineParsed?.(`[{"name": "grep_search", "parameters": {"Query": "test"}}]`);

    expect(dispatchSpy).not.toHaveBeenCalled();
  });

  it("triggers targeted interjection on mixed batch containing benign and unauthorized calls", () => {
    const transcriptPath = join(LOCAL_LOGS, "transcript.jsonl");
    vfs.writeFileSync(transcriptPath, "");

    SkillAuditorEngine.auditSkillCompliance(TEST_ROOT, {
      transcripts: [transcriptPath],
      capsuleRunRoot: TEST_ROOT,
    });

    const agentId = `skill-auditor-host-${transcriptPath}`;
    const monitor = SentinelMonitorRegistry.get(agentId);
    expect(monitor).toBeDefined();

    // Dispatch mixed line: 1 read tool, 1 unauthorized write tool
    monitor?.onLineParsed?.(
      JSON.stringify([
        { name: "view_file", parameters: { AbsolutePath: "src/app.ts" } },
        { name: "write_to_file", parameters: { TargetFile: "unauthorized.ts" } },
      ]),
    );

    expect(dispatchSpy).toHaveBeenCalled();
    const calls = dispatchSpy.mock.calls;
    const interjection = calls.find(
      (c) => c[0].payload?.action === "INTERJECT_HALT_DIRECT_EXECUTION",
    );
    expect(interjection).toBeDefined();
    if (!interjection) throw new Error("Expected interjection to be defined");
    const envelope = interjection[0];
    expect(envelope.messageType).toBe("DEFECT_ESCALATION");
    expect(envelope.recipientRoleOrId).toBe("coordinator");
    expect(envelope.payload.category).toBe("ROLE_BOUNDARY_DEVIATION");
    expect(envelope.payload.directive).toBe("HALT_DIRECT_EDITS_AND_DISPATCH_SUBAGENTS");
    expect(envelope.payload.observation).toContain("Direct file mutation (write_to_file)");
  });
});
